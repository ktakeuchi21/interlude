import { chirpSummary } from "./chirp-usage";
import type { NarrationReplacement } from "./contracts";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { courses, seedLessons, lessonKey, type Lesson } from "./content";
import type { AppState, Note, Progress, LibraryItem, CoursePreference, CostReview, GenerationState } from "./contracts";
import { preparationFromRow, type PreparationRow, MONTHLY_PREPARATIONS, MAX_PREPARATIONS } from "./lesson-preparation";
import { publicSpend, type AccountedSpend } from "./cost-review";
import { questionResearchFromRow, type QuestionResearchRow } from "./question-research";
import { questionFromRow } from "./questions";
import { researchFromRow, type ResearchRow, MONTHLY_RESEARCH_RUNS, MAX_RESEARCH_RUNS } from "./topic-research";
import { voiceFromRow, type VoiceRow } from "./transcription";
import { AppError } from "./errors";
import { budgetSummary } from "./budget";
import { STORAGE_LIMIT } from "./storage";
import { bitCount } from "./activity";
import { partitionLessonVersions } from "./lesson-history";
import { releaseFromRow, type VersionRow } from "./lesson-release";
import { sourceCaptureFromRow, MAX_SOURCE_COPIES, MONTHLY_SOURCE_RETRIEVALS, type SourceCaptureRow } from "./source-capture";
import { weeklyHistory } from "./weekly";
import { weeklyRefreshHistory, weeklyRefreshState } from "./weekly-refresh";
import { learningWeek } from "./weekly-selection";
import publications from "./plan-publications.json";
import { deliverPlanPublications, type PlanPublication } from "./plan-publications";

export function database() { if (!env.DB) throw new AppError("Your learning library is temporarily unavailable. Please try again.", 503); return env.DB; }
export async function authorize() {
  const user = await getChatGPTUser();
  if (!user) throw new AppError("Sign in to access your learning space.", 401);
  const db = database();
  // The Sites dispatcher restricts first access to the registered owner.
  // Persist that identity too, so later access-policy changes cannot add app users.
  await db.prepare("INSERT OR IGNORE INTO owner(id,user_id,created_at) VALUES(1,?,?)").bind(user.userId, Date.now()).run();
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== user.userId) throw new AppError("This learning space is private to its owner.", 403);
  return { user, db };
}
export function protectWrite(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("This request must come from your learning app.", 403);
}
export async function seedContent(db: D1Database) {
  await db.batch(seedLessons.map(lesson => db.prepare("INSERT OR IGNORE INTO lesson_versions(key,lesson_id,version,course_id,content,status,created_at) VALUES(?,?,?,?,?,'ready',?)")
    .bind(lessonKey(lesson), lesson.id, lesson.version, lesson.courseId, JSON.stringify(lesson), Date.now())));
}
export async function getLesson(db: D1Database, key: string) {
  const row = await db.prepare("SELECT content FROM lesson_versions WHERE key=? AND status='ready'").bind(key).first<{ content: string }>();
  if (!row) throw new AppError("That lesson is not ready yet.", 404);
  return JSON.parse(row.content) as Lesson;
}
export async function getState(db: D1Database, userId: string): Promise<AppState> {
  await seedContent(db);
  const planDeliveries = await deliverPlanPublications(db, userId, publications as PlanPublication[]);
  const [lessonRows, progress, notes, media, activity, budget, events, preferences, library, storage, questions, spending, generation, voiceDrafts, sourceCopies, research, preparations, costReviews, narrationReplacements, questionResearch, weekly, refreshHistory, refreshCurrent, chirp] = await Promise.all([
    db.prepare("SELECT key,content,release_info,created_at FROM lesson_versions WHERE status='ready' ORDER BY course_id,lesson_id,version").all<VersionRow>(),
    db.prepare("SELECT * FROM progress WHERE user_id=?").bind(userId).all<Progress>(),
    db.prepare("SELECT * FROM notes WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<Note>(),
    db.prepare("SELECT lesson_key,duration FROM media").all<{ lesson_key: string; duration: number | null }>(),
    db.prepare("SELECT minute,low,high FROM activity WHERE user_id=? AND minute>=? ORDER BY minute").bind(userId, Math.floor(Date.now() / 1000) - 366 * 86400).all<{ minute: number; low: number; high: number }>(),
    budgetSummary(db),
    db.prepare("SELECT id,kind,payload,created_at FROM events WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<{ id: string; kind: string; payload: string; created_at: number }>(),
    db.prepare("SELECT value FROM preferences WHERE user_id=? AND key='courses'").bind(userId).first<{ value: string }>(),
    db.prepare("SELECT * FROM library_items WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<LibraryItem>(),
    db.prepare("SELECT COALESCE(SUM(bytes),0) AS bytes FROM storage_allocations").first<{ bytes: number }>(),
    db.prepare("SELECT * FROM questions WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<{ id: string; user_id: string; lesson_key: string; question: string; answer: string | null; created_at: number }>(),
    db.prepare("SELECT * FROM accounted_spending ORDER BY created_at DESC").all<AccountedSpend>(),
    db.prepare("SELECT job_id,token,expires_at FROM generation_lock WHERE id=1").first<NonNullable<GenerationState>>(),
    db.prepare("SELECT * FROM transcriptions WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<VoiceRow>(),
    db.prepare("SELECT id,user_id,library_item_id,requested_url,status,result,error,created_at,finished_at FROM source_captures WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<SourceCaptureRow>(),
    db.prepare("SELECT * FROM topic_research WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<ResearchRow>(),
    db.prepare("SELECT * FROM lesson_preparations WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<PreparationRow>(),
    db.prepare("SELECT id,spending_id,revision,decision,amount,evidence,created_at FROM spend_reviews WHERE user_id=? ORDER BY created_at DESC,revision DESC").bind(userId).all<CostReview>(),
    db.prepare("SELECT id,root_id,operation_id,parent_id,review_id,lesson_key,part,attempt,max_cost,created_at FROM narration_replacements WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<NarrationReplacement>(),
    db.prepare("SELECT * FROM question_research WHERE user_id=? ORDER BY created_at DESC").bind(userId).all<QuestionResearchRow>(),
    weeklyHistory(db, userId), weeklyRefreshHistory(db, userId), weeklyRefreshState(db, userId, learningWeek(Date.now())), chirpSummary(db, Boolean(env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON)),
  ]);
  const coursePreferences: CoursePreference[] = preferences ? JSON.parse(preferences.value) : courses.map(c => ({ id: c.id, active: true }));
  const monthStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  return { planDeliveries, chirp, weeklyRefresh: { history: refreshHistory, current: refreshCurrent }, weekly, questionResearch: questionResearch.results.map(questionResearchFromRow), narrationReplacements: narrationReplacements.results, costReviews: costReviews.results, lessonPreparations: preparations.results.map(preparationFromRow), preparationAllowance: { retained: preparations.results.length, limit: MAX_PREPARATIONS, thisMonth: preparations.results.filter(p => p.created_at >= monthStart).length, monthlyLimit: MONTHLY_PREPARATIONS }, topicResearch: research.results.map(researchFromRow), researchAllowance: { retained: research.results.length, limit: MAX_RESEARCH_RUNS, thisMonth: research.results.filter(r => r.created_at >= monthStart).length, monthlyLimit: MONTHLY_RESEARCH_RUNS }, sourceCaptures: sourceCopies.results.map(sourceCaptureFromRow), sourceAllowance: { retained: sourceCopies.results.length, limit: MAX_SOURCE_COPIES, thisMonth: sourceCopies.results.filter(s => s.created_at >= monthStart).length, monthlyLimit: MONTHLY_SOURCE_RETRIEVALS }, storage: { limit: STORAGE_LIMIT, committed: storage?.bytes ?? 0 }, asOf: Date.now(), courses, coursePreferences, events: events.results.map(e => ({ ...e, payload: JSON.parse(e.payload) })), libraryItems: library.results, ...partitionLessonVersions(lessonRows.results.map(r => JSON.parse(r.content) as Lesson).sort((a, b) => courses.findIndex(c => c.id === a.courseId) - courses.findIndex(c => c.id === b.courseId) || a.order - b.order || b.version - a.version)), releases: lessonRows.results.map(releaseFromRow), progress: progress.results, notes: notes.results, questions: questions.results.map(questionFromRow), voiceDrafts: voiceDrafts.results.map(voiceFromRow), spending: await Promise.all(spending.results.map(publicSpend)), generation, media: media.results, activity: activity.results.map(a => ({ minute: a.minute, seconds: bitCount(a.low) + bitCount(a.high) })), budget, aiConfigured: Boolean(env.OPENAI_API_KEY) };
}
export function apiError(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  console.error("Learning request failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: "Something interrupted this request. Your saved work is safe. Please try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
