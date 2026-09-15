import { AppError } from "./errors";
import { z } from "zod";
import { courses, lessonKey, type Lesson } from "./content";
import type { CoursePreference } from "./contracts";
import { partitionLessonVersions } from "./lesson-history";
import { learningWeek } from "./weekly-selection";
import { prepareWeekly, MAX_WEEKLY_BATCHES } from "./weekly";
import { requestLessonRefresh } from "./lesson-refresh";
import { getTopicResearch, researchTopic } from "./topic-research";
import { getLessonPreparation, nextPreparationStage, prepareLessonStage } from "./lesson-preparation";
import { releasePreparedLesson } from "./prepared-release";

// At most one existing AI-course lesson per UTC week; recheck a lesson no more
// often than every four weeks. An unchanged inspection stops before drafting.
export const REFRESH_INTERVAL = 28 * 86400000;
export type WeeklyRefresh = { week: string; origin: "manual" | "scheduled"; lesson_key: string | null; lesson_title: string | null; reason: string; topic_id: string; research_id: string; preparation_id: string; created_at: number };
export type RefreshStage = "request" | "research" | "inspect" | "draft" | "review" | "release" | "narration" | "complete" | "no_due_lesson" | "unchanged" | "needs_sources" | "needs_revision" | "held" | "superseded";
export type WeeklyRefreshState = { run: WeeklyRefresh; stage: RefreshStage; canAdvance: boolean; message: string; updatedLessonKey?: string };
export const refreshCanAdvance = (stage: RefreshStage) => ["request", "research", "inspect", "draft", "review", "release", "narration"].includes(stage);
type Services = { apiKey?: string; bucket?: R2Bucket; fetch?: typeof fetch; narrate?: (db: D1Database, lesson: Lesson) => Promise<void> };
export const weeklyRefreshRequest = z.object({ runId: z.string().uuid().optional() }).strict();
const reason = "Check for material changes in evidence, capabilities, or guidance. Keep useful evergreen teaching stable; an unchanged lesson needs no new draft or narration.";

async function requireOwner(db: D1Database, userId: string) {
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId) throw new AppError("Only the owner can manage content refresh.", 403);
}
export async function weeklyRefreshHistory(db: D1Database, userId: string) {
  await requireOwner(db, userId);
  return (await db.prepare("SELECT week,origin,lesson_key,lesson_title,reason,topic_id,research_id,preparation_id,created_at FROM weekly_refreshes WHERE user_id=? ORDER BY week DESC").bind(userId).all<WeeklyRefresh>()).results;
}

/** A continuation names a saved owner-bound run, never a new target or week. */
export async function savedWeeklyRefreshState(db: D1Database, userId: string, runId: string) {
  const id = z.string().uuid().parse(runId);
  const run = (await weeklyRefreshHistory(db, userId)).find(r => r.preparation_id === id);
  if (!run) throw new AppError("That saved weekly check was not found.", 404);
  return (await weeklyRefreshState(db, userId, run.week))!;
}

export function selectRefreshLesson(lessons: Lesson[], preferences: CoursePreference[], history: WeeklyRefresh[], now: number) {
  const active = preferences.filter(p => p.active && courses.some(c => c.id === p.id)).map(p => p.id);
  return lessons.flatMap(lesson => {
    if (!active.includes(lesson.courseId) || !lesson.sources.length) return [];
    const inspected = lesson.sources.map(s => Date.parse(`${s.inspected}T00:00:00Z`));
    if (inspected.some(n => !Number.isFinite(n) || n > now)) return [];
    const lastCheck = Math.max(...inspected, ...history.filter(r => r.lesson_key === lessonKey(lesson)).map(r => r.created_at));
    return now - lastCheck >= REFRESH_INTERVAL ? [{ lesson, lastCheck }] : [];
  }).sort((a, b) => a.lastCheck - b.lastCheck || active.indexOf(a.lesson.courseId) - active.indexOf(b.lesson.courseId) || a.lesson.order - b.lesson.order || lessonKey(a.lesson).localeCompare(lessonKey(b.lesson)))[0]?.lesson ?? null;
}

async function ensureWeeklyRefresh(db: D1Database, userId: string, origin: WeeklyRefresh["origin"]) {
  await requireOwner(db, userId);
  const now = Date.now(), week = learningWeek(now);
  // Suggestions are useful even while paid research is unavailable. Their own
  // immutable owner/week record makes duplicate deliveries harmless.
  await prepareWeekly(db, userId, now, origin);
  const history = await weeklyRefreshHistory(db, userId), existing = history.find(r => r.week === week);
  if (existing) return existing;
  const [rows, prefs] = await Promise.all([
    db.prepare("SELECT content FROM lesson_versions WHERE status='ready' ORDER BY lesson_id,version").all<{ content: string }>(),
    db.prepare("SELECT value FROM preferences WHERE user_id=? AND key='courses'").bind(userId).first<{ value: string }>(),
  ]);
  const { lessons } = partitionLessonVersions(rows.results.map(r => JSON.parse(r.content) as Lesson));
  const selected = selectRefreshLesson(lessons, prefs ? JSON.parse(prefs.value) : courses.map(c => ({ id: c.id, active: true })), history, now);
  await db.prepare(`INSERT INTO weekly_refreshes(user_id,week,origin,lesson_key,lesson_title,reason,topic_id,research_id,preparation_id,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM weekly_refreshes WHERE user_id=?)<? ON CONFLICT(user_id,week) DO NOTHING`)
    .bind(userId, week, origin, selected ? lessonKey(selected) : null, selected?.title ?? null,
      selected ? "This active AI-course lesson has not been checked for at least four weeks. Inspect current evidence before changing its teaching." : "No active AI-course lesson is due. Existing teaching and narration stay available.",
      crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), now, userId, MAX_WEEKLY_BATCHES).run();
  const saved = (await weeklyRefreshHistory(db, userId)).find(r => r.week === week);
  if (!saved) throw new AppError("The retained refresh history is full. Existing learning remains available.", 429);
  return saved;
}

/** Read only: infer progress from the actual immutable results, never from a
 * success flag that could survive a failed write or a lost provider response. */
export async function weeklyRefreshState(db: D1Database, userId: string, week: string): Promise<WeeklyRefreshState | null> {
  const run = (await weeklyRefreshHistory(db, userId)).find(r => r.week === week);
  if (!run) return null;
  const state = (stage: RefreshStage, message: string, updatedLessonKey?: string): WeeklyRefreshState => ({ run, stage, canAdvance: refreshCanAdvance(stage), message, ...(updatedLessonKey ? { updatedLessonKey } : {}) });
  if (!run.lesson_key) return state("no_due_lesson", run.reason);
  const original = await db.prepare("SELECT lesson_id FROM lesson_versions WHERE key=? AND status='ready'").bind(run.lesson_key).first<{ lesson_id: string }>();
  if (!original) return state("superseded", "The original lesson is unavailable. This check stays saved for inspection.");
  const current = await db.prepare("SELECT key FROM lesson_versions WHERE lesson_id=? AND status='ready' ORDER BY version DESC LIMIT 1").bind(original.lesson_id).first<{ key: string }>();
  const released = await db.prepare("SELECT key FROM lesson_versions WHERE status='ready' AND json_extract(release_info,'$.review.preparationId')=?").bind(run.preparation_id).first<{ key: string }>();
  if (released) {
    if (current?.key !== released.key) return state("complete", "This check saved an update. A newer version is now available; no older narration will be generated.", released.key);
    const media = await db.prepare("SELECT lesson_key FROM media WHERE lesson_key=?").bind(released.key).first();
    return media ? state("complete", "The checked update and its narration are saved. Earlier learning history is preserved.", released.key)
      : state("narration", "The checked update is saved. Its narration still needs preparation.", released.key);
  }
  if (current?.key !== run.lesson_key) return state("superseded", "A newer lesson version exists. This check will not replace it.");
  if (!await db.prepare("SELECT id FROM library_items WHERE id=? AND user_id=?").bind(run.topic_id, userId).first()) return state("request", "Ready to save this check’s update request.");
  const researchExists = await db.prepare("SELECT id FROM topic_research WHERE id=? AND user_id=?").bind(run.research_id, userId).first();
  if (!researchExists) return state("research", "Find and retrieve up to two current source pages.");
  const research = await getTopicResearch(db, userId, run.research_id);
  if (!research.search) {
    const held = await db.prepare("SELECT id FROM spending WHERE id=?").bind(`research:${run.research_id}`).first();
    return held ? state("held", "The search was interrupted. Check its saved output and cost in Settings; this weekly job will not resend it.") : state("research", "Source research is not complete yet.");
  }
  if (research.search.candidates.length !== 2) return state("needs_sources", "Research did not provide two pages. Saved evidence remains available; no lesson was drafted.");
  const captures = await Promise.all(research.search.candidates.map(c => db.prepare("SELECT status FROM source_captures WHERE id=? AND user_id=?").bind(c.captureId, userId).first<{ status: string }>()));
  if (captures.some(c => !c)) return state("research", "Retrieve the remaining pages from the saved search without another search charge.");
  if (captures.some(c => c!.status === "retrieving")) return state("held", "A source retrieval was interrupted. Check the saved source and recover any expired work in Settings.");
  if (captures.some(c => c!.status !== "retrieved")) return state("needs_sources", "A selected page could not be read. No new teaching was published.");
  const preparationExists = await db.prepare("SELECT id FROM lesson_preparations WHERE id=? AND user_id=?").bind(run.preparation_id, userId).first();
  if (!preparationExists) return state("inspect", "Inspect the current pages against the original lesson before deciding whether it needs an update.");
  const preparation = await getLessonPreparation(db, userId, run.preparation_id);
  const next = nextPreparationStage(preparation);
  if (next) {
    const held = await db.prepare("SELECT id FROM spending WHERE id=?").bind(`lesson:${run.preparation_id}:${next}`).first();
    return held ? state("held", "A paid preparation step has no saved result. Check its output and cost in Settings; the weekly job will not repeat it.") : state(next, next === "draft" ? "A supported material change was found. Prepare an updated draft." : next === "review" ? "Check the draft against the original lesson and current evidence." : "Inspect the retained sources.");
  }
  if (preparation.inspection?.value.update?.decision === "unchanged") return state("unchanged", "No material change was identified. The original lesson and narration stay unchanged.");
  if (!preparation.inspection?.value.sufficient || preparation.inspection.value.update?.decision !== "update" || preparation.review?.value.decision === "needs_sources") return state("needs_sources", "The checks need more evidence. Existing learning remains available.");
  if (preparation.review?.value.decision !== "ready") return state("needs_revision", "The draft did not pass its teaching checks. It remains outside the learning library.");
  return state("release", "The automated source and teaching checks passed. Save the next version with its change summary.");
}

/** One bounded step per invocation. Start in the server's current week, then
 * pin subsequent calls to the returned preparation_id, including across week
 * boundaries. A missing continuation never creates a replacement run. */
export async function advanceWeeklyRefresh(db: D1Database, userId: string, services: Services = {}, origin: WeeklyRefresh["origin"] = "manual", runId?: string) {
  const current = runId !== undefined ? await savedWeeklyRefreshState(db, userId, runId)
    : (await weeklyRefreshState(db, userId, (await ensureWeeklyRefresh(db, userId, origin)).week))!;
  const run = current.run;
  if (!refreshCanAdvance(current.stage)) return current;
  if (current.stage !== "narration") await requestLessonRefresh(db, userId, { id: run.topic_id, key: run.lesson_key!, reason });
  if (current.stage === "research") await researchTopic(db, userId, { id: run.research_id, topicId: run.topic_id }, services);
  else if (["inspect", "draft", "review"].includes(current.stage)) {
    // Reconcile the saved search before starting another paid stage.
    const research = await researchTopic(db, userId, { id: run.research_id, topicId: run.topic_id }, services);
    await prepareLessonStage(db, userId, { id: run.preparation_id, topicId: run.topic_id, sourceCaptureIds: research.search!.candidates.map(c => c.captureId), stage: current.stage as "inspect" | "draft" | "review" }, services);
  } else if (current.stage === "release") await releasePreparedLesson(db, userId, run.preparation_id);
  else if (current.stage === "narration") {
    const row = await db.prepare("SELECT content FROM lesson_versions WHERE key=? AND status='ready'").bind(current.updatedLessonKey!).first<{ content: string }>();
    if (!row) throw new AppError("The updated lesson is unavailable.", 409);
    if (!services.narrate) throw new AppError("Narration setup is pending. The lesson is saved and ready to read.", 503);
    await services.narrate(db, JSON.parse(row.content) as Lesson);
  }
  return (await weeklyRefreshState(db, userId, run.week))!;
}
