import { z } from "zod";
import { courses, lessonKey, narrationText, type Lesson } from "./content";
import type { LessonRelease, LessonReviewReceipt } from "./contracts";
import { AppError } from "./errors";
import { capturedMaterial } from "./source-capture";

const text = (max: number) => z.string().trim().min(1).max(max);
const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const url = z.string().url().max(2000).refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
});
const lessonSchema = z.object({
  id: identifier, version: z.number().int().min(1).max(10000), courseId: identifier,
  order: z.number().int().positive(), title: text(180), objective: text(1000), minutes: z.number().min(4).max(6),
  sections: z.array(z.object({ title: text(180), paragraphs: z.array(text(5000)).min(1).max(8), sources: z.array(identifier).max(4) }).strict()).min(2).max(10),
  takeaway: text(1000), reflection: text(1000), challenge: text(1500),
  quiz: z.object({ question: text(1000), options: z.array(text(700)).min(2).max(5), answer: z.number().int().nonnegative(), explanation: text(1500) }).strict(),
  sources: z.array(z.object({ id: identifier, title: text(500), publisher: text(200), url, published: day.nullable(), inspected: day, supports: text(2000) }).strict()).min(2).max(4),
  review: text(2000),
}).strict();
const receiptSchema = z.object({
  method: z.enum(["build-editorial", "automated"]), checkedAt: z.number().int().positive(), contentHash: digest, summary: text(4000),
  preparationId: z.string().uuid().optional(),
  sourceChecks: z.array(z.object({ id: identifier, url, inspected: day, materialHash: digest, snapshotId: z.string().uuid() }).strict()).min(2).max(4),
}).strict();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function lessonContentHash(lesson: Lesson) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(lesson)));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}

type ReleaseInfo = Omit<LessonRelease, "lesson_key" | "createdAt">;
export type VersionRow = { key: string; content: string; release_info: string | null; created_at: number };
export function releaseFromRow(row: VersionRow): LessonRelease {
  const info: ReleaseInfo = row.release_info ? JSON.parse(row.release_info) : { previousKey: null, summary: "Initial lesson release.", review: null };
  return { ...info, lesson_key: row.key, createdAt: row.created_at };
}

/**
 * Internal final step of a source-reviewed pipeline; never accepts a browser's
 * claim that a draft was reviewed. The receipt binds the upstream review to the
 * exact content and inspected-source snapshots. These structural checks alone
 * do not establish factual accuracy or constitute expert review.
 */
export async function appendReviewedLessonVersion(db: D1Database, candidate: Lesson, input: {
  userId: string; previousKey: string | null; summary: string; review: LessonReviewReceipt;
}, now = Date.now()) {
  const parsed = lessonSchema.safeParse(candidate), checked = receiptSchema.safeParse(input.review), summary = text(2000).safeParse(input.summary);
  if (!parsed.success || !checked.success || !summary.success) throw new AppError("The lesson and its review need complete, valid details before release.", 422);
  const lesson = parsed.data, review = checked.data;
  const course = courses.find(c => c.id === lesson.courseId), script = narrationText(lesson), sourceIds = new Set(lesson.sources.map(s => s.id));
  const fitsLibrary = course ? lesson.order <= course.lessons.length : lesson.courseId === "standalone" && lesson.order === 1;
  if (!fitsLibrary || script.split(/\s+/).length < 600 || script.split(/\s+/).length > 800 || script.length > 8000 || lesson.quiz.answer >= lesson.quiz.options.length) throw new AppError("The lesson does not fit its course, five-minute teaching format, or recall question.", 422);
  if (sourceIds.size !== lesson.sources.length || new Set(lesson.sources.map(s => s.url)).size !== lesson.sources.length || new Set(review.sourceChecks.map(s => s.id)).size !== lesson.sources.length || review.sourceChecks.length !== lesson.sources.length) throw new AppError("The source record contains duplicate or missing checks.", 422);
  if (review.checkedAt > now || review.contentHash !== await lessonContentHash(lesson)) throw new AppError("The review no longer matches this exact lesson. Review the changed draft before releasing it.", 422);
  const checkedDay = new Date(review.checkedAt).toISOString().slice(0, 10);
  for (const source of lesson.sources) {
    const check = review.sourceChecks.find(s => s.id === source.id);
    if (!check || check.url !== source.url || check.inspected !== source.inspected || source.inspected > checkedDay || (source.published && source.published > source.inspected) || !lesson.sections.some(section => section.sources.includes(source.id))) throw new AppError("The lesson's citations do not match its inspected source records.", 422);
    const captured = await db.prepare("SELECT user_id FROM source_captures WHERE id=? AND user_id=? AND status='retrieved'").bind(check.snapshotId, input.userId).first<{ user_id: string }>();
    if (!captured) throw new AppError("The reviewed source copy is missing. Retrieve and inspect the material before release.", 422);
    const snapshot = await capturedMaterial(db, input.userId, check.snapshotId);
    if (snapshot.hash !== check.materialHash || snapshot.finalUrl !== check.url || snapshot.retrievedAt > review.checkedAt || new Date(snapshot.retrievedAt).toISOString().slice(0, 10) > source.inspected) throw new AppError("The review does not match the retained source material and retrieval date.", 422);
  }
  if (lesson.sections.some(section => section.sources.some(id => !sourceIds.has(id)))) throw new AppError("A lesson section refers to an unknown source.", 422);
  const key = lessonKey(lesson), content = canonical(lesson), info: ReleaseInfo = { previousKey: input.previousKey, summary: summary.data, review };
  const releaseInfo = canonical(info);
  function reuse(existing: VersionRow) {
    if (canonical(JSON.parse(existing.content)) !== content || !existing.release_info || canonical(JSON.parse(existing.release_info)) !== releaseInfo) throw new AppError("That lesson version has already been released with different content or review details.", 409);
    return releaseFromRow(existing);
  }
  const existing = await db.prepare("SELECT key,content,release_info,created_at FROM lesson_versions WHERE key=?").bind(key).first<VersionRow>();
  if (existing) return reuse(existing);
  const prior = await db.prepare("SELECT key,content,release_info,created_at FROM lesson_versions WHERE lesson_id=? AND status='ready' ORDER BY version DESC LIMIT 1").bind(lesson.id).first<VersionRow>();
  if (prior?.key === key) return reuse(prior);
  const previous = prior ? JSON.parse(prior.content) as Lesson : null;
  if ((prior?.key ?? null) !== input.previousKey || lesson.version !== (previous?.version ?? 0) + 1) throw new AppError("A newer lesson version exists or the revision sequence changed. Review against the current version.", 409);
  if (previous && (previous.courseId !== lesson.courseId || previous.order !== lesson.order)) throw new AppError("A revision must keep the lesson in its original course and position.", 422);
  // The expected predecessor and course slot are checked again inside the one
  // atomic INSERT, so two reviewers cannot release conflicting successors.
  await db.prepare(`INSERT OR IGNORE INTO lesson_versions(key,lesson_id,version,course_id,content,status,release_info,created_at)
    SELECT ?,?,?,?,?,'ready',?,?
    WHERE COALESCE((SELECT key FROM lesson_versions WHERE lesson_id=? AND status='ready' ORDER BY version DESC LIMIT 1),'')=?
      AND (?='standalone' OR NOT EXISTS(SELECT 1 FROM lesson_versions WHERE course_id=? AND json_extract(content,'$.order')=? AND lesson_id<>? AND status='ready'))`)
    .bind(key, lesson.id, lesson.version, lesson.courseId, content, releaseInfo, now, lesson.id, input.previousKey ?? "", lesson.courseId, lesson.courseId, lesson.order, lesson.id).run();
  const saved = await db.prepare("SELECT key,content,release_info,created_at FROM lesson_versions WHERE key=?").bind(key).first<VersionRow>();
  if (!saved || saved.content !== content || saved.release_info !== releaseInfo) throw new AppError("The lesson changed during review or its course position is already occupied. Nothing was replaced.", 409);
  return releaseFromRow(saved);
}
