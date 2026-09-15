import { z } from "zod";
import type { Lesson } from "./content";
import type { LessonReviewReceipt, SourceMaterial } from "./contracts";
import { AppError } from "./errors";
import { appendReviewedLessonVersion } from "./lesson-release";
import { materialHash } from "./source-text";
import { MAX_SOURCE_COPIES } from "./source-capture";
import { MAX_WEEKLY_BATCHES } from "./weekly";
import { learningWeek, type WeeklyBatch } from "./weekly-selection";

/** Trusted, reviewed build artifacts. There is deliberately no HTTP import endpoint. */
export type PlanPublication = {
  ownerId: string; week: string; preparedAt: number; summary: string;
  checks: { lessonKey: string; outcome: "unchanged" | "updated" | "needs_sources"; checkedAt: number; summary: string }[];
  batch: WeeklyBatch;
  release?: { lesson: Lesson; previousKey: string; summary: string; review: LessonReviewReceipt;
    sources: { snapshotId: string; material: SourceMaterial & { text: string } }[] };
};
export type PlanDelivery = { week: string; preparedAt: number; summary: string; checks?: PlanPublication["checks"]; status: "saved" | "needs_attention"; error?: string; updatedLessonKey?: string };
const item = z.object({ id: z.string().uuid(), identity: z.string().min(1).max(200), kind: z.enum(["lesson", "review", "library", "topic"]), title: z.string().min(1).max(200), reason: z.string().min(1).max(1000), lessonKey: z.string().max(150).optional(), libraryItemId: z.string().uuid().optional(), topicId: z.string().uuid().optional(), courseId: z.string().max(100).optional() }).strict();
const batchSchema = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), origin: z.literal("scheduled"), items: z.array(item).max(3), created_at: z.number().int().positive() }).strict();

export async function deliverPlanPublication(db: D1Database, userId: string, publication: PlanPublication, now = Date.now()): Promise<PlanDelivery> {
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId || publication.ownerId !== userId) throw new AppError("This publication belongs to a different owner.", 403);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(publication)));
  const fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
  const delivered = await db.prepare("SELECT fingerprint,result FROM plan_deliveries WHERE user_id=? AND week=?").bind(userId, publication.week).first<{ fingerprint: string; result: string }>();
  if (delivered) {
    if (delivered.fingerprint !== fingerprint) throw new AppError("This weekly publication was already delivered with different content.", 409);
    if (delivered.result) return JSON.parse(delivered.result) as PlanDelivery;
  }
  const batch = batchSchema.parse(publication.batch);
  if (publication.preparedAt > now || publication.preparedAt !== batch.created_at || learningWeek(publication.preparedAt) !== publication.week || batch.week !== publication.week || publication.summary.length > 4000 || JSON.stringify(batch.items).length > 12000) throw new AppError("The weekly publication has inconsistent dates or exceeds its bounds.", 422);
  if (new Set(batch.items.map(i => i.id)).size !== batch.items.length || new Set(batch.items.map(i => i.identity)).size !== batch.items.length) throw new AppError("The weekly publication repeats a suggestion.", 422);
  await db.prepare("INSERT OR IGNORE INTO plan_deliveries(user_id,week,fingerprint,result,created_at) SELECT ?,?,?,'',? WHERE (SELECT COUNT(*) FROM plan_deliveries WHERE user_id=?)<?").bind(userId, publication.week, fingerprint, now, userId, MAX_WEEKLY_BATCHES).run();
  const claim = await db.prepare("SELECT fingerprint FROM plan_deliveries WHERE user_id=? AND week=?").bind(userId, publication.week).first<{ fingerprint: string }>();
  if (!claim) throw new AppError("The retained publication history is full.", 429);
  if (claim.fingerprint !== fingerprint) throw new AppError("A different publication already owns this week. Existing learning was preserved.", 409);
  let updatedLessonKey: string | undefined;
  if (publication.release) {
    const release = publication.release;
    if (release.review.method !== "build-editorial" || release.review.checkedAt > publication.preparedAt || release.sources.length < 2 || release.sources.length > 4 || !publication.checks.some(c => c.lessonKey === release.previousKey && c.outcome === "updated")) throw new AppError("The publication needs a matching editorial update review.", 422);
    // Validate every source before writing any copy. Review still checks exact
    // lesson hash, predecessor, citations and snapshot dates before release.
    for (const source of release.sources) {
      z.string().uuid().parse(source.snapshotId);
      const m = source.material, bytes = new TextEncoder().encode(m.text).length;
      if (!m.text.trim() || bytes > 120000 || m.bytes !== bytes || m.retrievedAt > release.review.checkedAt || !Number.isFinite(m.retrievedAt) || await materialHash(m, m.finalUrl) !== m.hash) throw new AppError("The editorial source copy failed its fingerprint or size check.", 422);
      if (!release.review.sourceChecks.some(c => c.snapshotId === source.snapshotId && c.materialHash === m.hash && c.url === m.finalUrl)) throw new AppError("The editorial source does not match its review.", 422);
      const existing = await db.prepare("SELECT user_id,result,material FROM source_captures WHERE id=?").bind(source.snapshotId).first<{ user_id: string; result: string; material: string }>();
      if (existing && (existing.user_id !== userId || existing.material !== m.text || JSON.parse(existing.result).hash !== m.hash)) throw new AppError("A different saved source already uses this identifier.", 409);
    }
    for (const source of release.sources) {
      const { text, ...metadata } = source.material;
      await db.prepare("INSERT OR IGNORE INTO source_captures(id,user_id,library_item_id,requested_url,status,result,material,created_at,finished_at) SELECT ?,?,?,?,'retrieved',?,?,?,? WHERE (SELECT COUNT(*) FROM source_captures)<?")
        .bind(source.snapshotId, userId, `plan:${publication.week}`, metadata.finalUrl, JSON.stringify(metadata), text, metadata.retrievedAt, metadata.retrievedAt, MAX_SOURCE_COPIES).run();
    }
    const saved = await appendReviewedLessonVersion(db, release.lesson, { userId, previousKey: release.previousKey, summary: release.summary, review: release.review }, publication.preparedAt);
    updatedLessonKey = saved.lesson_key;
  }
  // Existing manual or scheduled sets and dismissals are immutable. The first
  // published set for a week wins even if the owner's progress changes later.
  await db.prepare("INSERT OR IGNORE INTO weekly_batches(user_id,week,origin,items,created_at) SELECT ?,?,'scheduled',?,? WHERE (SELECT COUNT(*) FROM weekly_batches WHERE user_id=?)<?")
    .bind(userId, batch.week, JSON.stringify(batch.items), batch.created_at, userId, MAX_WEEKLY_BATCHES).run();
  const saved = await db.prepare("SELECT week FROM weekly_batches WHERE user_id=? AND week=?").bind(userId, batch.week).first();
  if (!saved) throw new AppError("The retained weekly history is full.", 429);
  const result: PlanDelivery = { week: publication.week, preparedAt: publication.preparedAt, summary: publication.summary, checks: publication.checks, status: "saved", ...(updatedLessonKey ? { updatedLessonKey } : {}) };
  await db.prepare("UPDATE plan_deliveries SET result=? WHERE user_id=? AND week=? AND fingerprint=? AND result=''").bind(JSON.stringify(result), userId, publication.week, fingerprint).run();
  const committed = await db.prepare("SELECT fingerprint FROM plan_deliveries WHERE user_id=? AND week=?").bind(userId, publication.week).first<{ fingerprint: string }>();
  if (committed?.fingerprint !== fingerprint) throw new AppError("Another publication was delivered for this week. Existing learning was preserved.", 409);
  return result;
}

export async function deliverPlanPublications(db: D1Database, userId: string, publications: PlanPublication[], now = Date.now()): Promise<PlanDelivery[]> {
  if (publications.length > 8) throw new AppError("Only the eight latest deliveries belong in the build; older history remains saved.", 422);
  const deliveries: PlanDelivery[] = [];
  for (const publication of publications) {
    if (publication.preparedAt > now) continue;
    try { deliveries.push(await deliverPlanPublication(db, userId, publication, now)); }
    catch (e) { deliveries.push({ week: publication.week, preparedAt: publication.preparedAt, summary: publication.summary, status: "needs_attention", error: e instanceof AppError ? e.message : "This weekly publication needs checking in Codex." }); }
  }
  const history = await db.prepare("SELECT result FROM plan_deliveries WHERE user_id=? AND result<>'' ORDER BY week DESC LIMIT 260").bind(userId).all<{ result: string }>();
  const combined = new Map(history.results.map(row => { const result = JSON.parse(row.result) as PlanDelivery; return [result.week, result]; }));
  for (const delivery of deliveries) combined.set(delivery.week, delivery);
  return [...combined.values()].sort((a, b) => b.week.localeCompare(a.week));
}
