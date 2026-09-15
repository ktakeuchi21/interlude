import { z } from "zod";
import { narrationText, lessonKey, type Lesson } from "./content";
import { splitNarration } from "./audio";
import { AppError } from "./errors";
import { withGenerationLock } from "./jobs";
import { textFingerprint } from "./narration-records";
import type { AccountedSpend } from "./cost-review";
import type { NarrationReplacement } from "./contracts";

export const MAX_NARRATION_REPLACEMENTS = 2;
export const narrationReplacementRequest = z.object({ id: z.string().uuid(), spendingId: z.string().min(1).max(200), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/), reviewId: z.string().uuid(), confirmedNewCharge: z.literal(true) }).strict();
type ReplacementRow = NarrationReplacement & { user_id: string; snapshot: string; input_sha256: string };
export function publicReplacement(row: ReplacementRow): NarrationReplacement {
  return { id: row.id, root_id: row.root_id, operation_id: row.operation_id, parent_id: row.parent_id, review_id: row.review_id, lesson_key: row.lesson_key, part: row.part, attempt: row.attempt, max_cost: row.max_cost, created_at: row.created_at };
}
export async function narrationPlan(lesson: Lesson) {
  const key = lessonKey(lesson), script = narrationText(lesson);
  if (script.length > 8000) throw new AppError("This lesson needs to be shortened before narration.");
  return Promise.all(splitNarration(script).map(async (text, index) => ({ text, index, root: `tts:${key}:alloy:${index}`, key: `narration/${key}/tts-1-alloy/part-${index}.pcm`, reservation: new TextEncoder().encode(text).length * 15, fingerprint: await textFingerprint(text) })));
}
export type NarrationPart = Awaited<ReturnType<typeof narrationPlan>>[number];
export async function narrationAttempts(db: D1Database, part: NarrationPart) {
  const rows = (await db.prepare("SELECT * FROM narration_replacements WHERE root_id=? ORDER BY attempt").bind(part.root).all<ReplacementRow>()).results;
  for (const row of rows) if (row.input_sha256 !== part.fingerprint || row.max_cost !== part.reservation) throw new AppError("The narration input or price changed. Its replacement needs inspection before another request.", 409);
  return [{ operation: part.root, key: part.key, replacementId: null as string | null }, ...rows.map(row => ({ operation: row.operation_id, key: part.key.replace(/\.pcm$/, `-${row.id}.pcm`), replacementId: row.id }))];
}

/** Records permission for one new request. It does not call AI or clear old costs. */
export async function authorizeNarrationReplacement(db: D1Database, userId: string, raw: z.input<typeof narrationReplacementRequest>, bucket?: Pick<R2Bucket, "head">) {
  const data = narrationReplacementRequest.parse(raw);
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId) throw new AppError("Only the owner can allow a narration replacement.", 403);
  const existing = async () => {
    const row = await db.prepare("SELECT * FROM narration_replacements WHERE id=?").bind(data.id).first<ReplacementRow>();
    if (!row) return null;
    if (row.user_id !== userId || row.parent_id !== data.spendingId || row.review_id !== data.reviewId || await textFingerprint(row.snapshot) !== data.expectedFingerprint) throw new AppError("This replacement ID already has different details. Refresh usage before trying again.", 409);
    return publicReplacement(row);
  };
  const saved = await existing(); if (saved) return saved;
  if (!bucket) throw new AppError("Audio storage must be available to check for a saved segment before allowing a replacement.", 503);
  return withGenerationLock(db, `allow-narration:${data.id}`, async claim => {
    const saved = await existing(); if (saved) return saved;
    const parent = await db.prepare("SELECT * FROM accounted_spending WHERE id=?").bind(data.spendingId).first<AccountedSpend>();
    if (!parent) throw new AppError("That narration request was not found.", 404);
    const predecessor = await db.prepare("SELECT * FROM narration_replacements WHERE operation_id=?").bind(parent.id).first<ReplacementRow>();
    const root = predecessor?.root_id ?? parent.id, match = /^tts:(.+):alloy:(\d+)$/.exec(root);
    if (!match || parent.kind !== "narration" || parent.status === "released") throw new AppError("This request is not a replaceable narration segment.", 409);
    const key = match[1], lessonRow = await db.prepare("SELECT content FROM lesson_versions WHERE key=? AND status='ready'").bind(key).first<{ content: string }>();
    if (!lessonRow) throw new AppError("This narration's original lesson is unavailable.", 409);
    if (await db.prepare("SELECT lesson_key FROM media WHERE lesson_key=?").bind(key).first()) throw new AppError("This lesson already has saved narration. Open it before requesting a replacement.", 409);
    const part = (await narrationPlan(JSON.parse(lessonRow.content) as Lesson)).find(p => p.root === root);
    if (!part || parent.reserved !== part.reservation) throw new AppError("This segment's original input and cost need inspection.", 409);
    const attempts = await narrationAttempts(db, part), last = attempts.at(-1)!;
    if (last.operation !== parent.id) throw new AppError("A replacement is already allowed for this request. Reopen the lesson to check it.", 409);
    if (attempts.length > MAX_NARRATION_REPLACEMENTS) throw new AppError("This segment has reached its two-replacement limit. Inspect the cause before further work.", 409);
    if (await textFingerprint(parent.snapshot) !== data.expectedFingerprint || parent.review_id !== data.reviewId || !parent.review_current || parent.needs_review) throw new AppError("Check this request's current cost and outcome before allowing a replacement.", 409);
    for (const attempt of attempts) if (await bucket.head(attempt.key)) throw new AppError("A saved segment is available. Reopen the lesson and check its saved narration first.", 409);
    await claim.assertActive();
    const operation = `replacement:${data.id}`, now = Date.now(), attempt = attempts.length;
    const inserted = await db.prepare(`INSERT OR IGNORE INTO narration_replacements(id,user_id,root_id,operation_id,parent_id,review_id,snapshot,lesson_key,part,attempt,input_sha256,max_cost,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? FROM accounted_spending WHERE id=? AND snapshot=? AND review_id=? AND review_current=1 AND needs_review=0
      AND NOT EXISTS(SELECT id FROM accounted_spending WHERE needs_review=1)
      AND (SELECT COUNT(*) FROM narration_replacements)<2000`)
      .bind(data.id, userId, root, operation, parent.id, data.reviewId, parent.snapshot, key, part.index, attempt, part.fingerprint, part.reservation, now, parent.id, parent.snapshot, data.reviewId).run();
    if (inserted.meta.changes !== 1) throw new AppError("The request changed, another cost needs review, or replacement history is full. Refresh usage before trying again.", 409);
    return (await existing())!;
  });
}
