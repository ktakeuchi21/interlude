import { prepareChirpPreview, activateChirp } from "@/lib/chirp-narration";
import { CHIRP_VOICES } from "@/lib/chirp-voices";
import { authorizeNarrationReplacement, narrationReplacementRequest } from "@/lib/narration-attempts";
import { requestLessonRefresh, refreshRequest } from "@/lib/lesson-refresh";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { authorize, protectWrite, apiError, getState, getLesson } from "@/lib/server";
import { saveNote, saveQuiz } from "@/lib/records";
import { boundedBytes, recoverGenerationLock } from "@/lib/jobs";
import { researchQuestion, questionResearchRequest } from "@/lib/question-research";
import { completeSupplement } from "@/lib/supplement-records";
import { prepareWeekly, chooseWeekly, saveWeeklyTopic } from "@/lib/weekly";
import { advanceWeeklyRefresh, savedWeeklyRefreshState, weeklyRefreshRequest } from "@/lib/weekly-refresh";
import { answerQuestion } from "@/lib/questions";
import { writeProgress } from "@/lib/progress";
import { activityMasks } from "@/lib/activity";
import { parseRange } from "@/lib/audio";
import { AppError } from "@/lib/errors";
import { courses, seedLessons, lessonKey } from "@/lib/content";
import { generateNarration, recoverNarration } from "@/lib/narration";
import { getVoiceDraft, transcribeVoice } from "@/lib/transcription";
import { MAX_VOICE_BYTES } from "@/lib/voice-audio";
import { captureSavedSource, getSourceCapture } from "@/lib/source-capture";
import { sourceSelectionSchema } from "@/lib/question-grounding";
import { researchTopic, getTopicResearch } from "@/lib/topic-research";
import { prepareLessonStage, getLessonPreparation, preparationRequest } from "@/lib/lesson-preparation";
import { releasePreparedLesson } from "@/lib/prepared-release";
import { recordCostReview, reviewCostRequest } from "@/lib/cost-review";
import { recoverSavedRequest } from "@/lib/request-recovery";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const keySchema = z.string().min(1).max(150).regex(/^[a-z0-9:-]+$/);
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: Context) {
  try {
    const { user, db } = await authorize();
    const { path } = await context.params;
    if (path.length !== (["audio", "chirp-audio"].includes(path[0]) ? 2 : 1)) throw new AppError("That page was not found.", 404);
    if (path[0] === "state") return Response.json(await getState(db, user.userId), { headers: noStore });
    if (path[0] === "weekly-refresh") {
      const runId = z.string().uuid().parse(new URL(request.url).searchParams.get("runId"));
      return Response.json({ refresh: await savedWeeklyRefreshState(db, user.userId, runId) }, { headers: noStore });
    }
    if (path[0] === "preparation") {
      const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
      return Response.json({ preparation: await getLessonPreparation(db, user.userId, id) }, { headers: noStore });
    }
    if (path[0] === "research") {
      const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
      return Response.json({ research: await getTopicResearch(db, user.userId, id) }, { headers: noStore });
    }
    if (path[0] === "source") {
      const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
      return Response.json({ capture: await getSourceCapture(db, user.userId, id) }, { headers: noStore });
    }
    if (path[0] === "transcript") {
      const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
      return Response.json({ draft: await getVoiceDraft(db, user.userId, id) }, { headers: noStore });
    }
    if (path[0] === "export") {
      const state = await getState(db, user.userId);
      return Response.json({ exportedAt: new Date().toISOString(), ...state }, { headers: { ...noStore, "Content-Disposition": 'attachment; filename="interlude-learning.json"' } });
    }
    if (["audio", "chirp-audio"].includes(path[0])) {
      const key = keySchema.parse(path[1]);
      const media = await db.prepare(path[0] === "audio" ? "SELECT * FROM media WHERE lesson_key=?" : "SELECT object_key,bytes,'audio/wav' AS content_type FROM chirp_audio WHERE id=? AND kind IN ('sample','pilot') AND object_key IS NOT NULL").bind(key).first<{ object_key: string; content_type: string; bytes: number }>();
      if (!media || !env.BUCKET) throw new AppError("Narration is not ready for this lesson.", 404);
      let range;
      try { range = parseRange(request.headers.get("range"), media.bytes); }
      catch { return new Response(null, { status: 416, headers: { ...noStore, "Content-Range": `bytes */${media.bytes}` } }); }
      const object = request.method === "HEAD" ? null : await env.BUCKET.get(media.object_key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
      if (request.method !== "HEAD" && !object) throw new AppError("This audio file is temporarily unavailable.", 503);
      const headers: Record<string, string> = { ...noStore, "Content-Type": media.content_type, "Accept-Ranges": "bytes", "Content-Length": String(range?.length ?? media.bytes), "X-Content-Type-Options": "nosniff" };
      if (range) headers["Content-Range"] = `bytes ${range.offset}-${range.end}/${media.bytes}`;
      return new Response(object?.body ?? null, { status: range ? 206 : 200, headers });
    }
    throw new AppError("That page was not found.", 404);
  } catch (error) { return apiError(error instanceof z.ZodError ? new AppError("Invalid request.") : error); }
}

export async function POST(request: Request, context: Context) {
  try {
    protectWrite(request);
    const { user, db } = await authorize();
    const { path } = await context.params;
    if (path.length !== 1) throw new AppError("That action was not found.", 404);
    if (path[0] === "transcribe") {
      const url = new URL(request.url);
      const data = z.object({ id: z.string().uuid(), key: keySchema, purpose: z.enum(["question", "reflection", "challenge"]) }).parse(Object.fromEntries(url.searchParams));
      if (request.headers.get("content-type") !== "audio/wav") throw new AppError("Use the app's voice recorder for spoken input.", 415);
      if (Number(request.headers.get("content-length") ?? 0) > MAX_VOICE_BYTES) throw new AppError("Keep the recording under 30 seconds.", 413);
      await getLesson(db, data.key);
      const bytes = await boundedBytes(new Response(request.body), MAX_VOICE_BYTES);
      const draft = await transcribeVoice(db, user.userId, { ...data, bytes }, { apiKey: env.OPENAI_API_KEY });
      return Response.json({ draft }, { headers: noStore });
    }
    if (Number(request.headers.get("content-length") ?? 0) > 20_000) throw new AppError("This request is too large.", 413);
    const raw = new TextDecoder().decode(await boundedBytes(new Response(request.body), 20_000));
    if (raw.length > 20_000) throw new AppError("This request is too large.", 413);
    const body: unknown = JSON.parse(raw);
    if (path[0] === "chirp-preview") {
      const data = z.object({ kind: z.enum(["sample", "pilot"]), voice: z.enum(CHIRP_VOICES), onlySaved: z.boolean().optional() }).strict().parse(body);
      await prepareChirpPreview(db, data.kind, data.voice, await getLesson(db, lessonKey(seedLessons[0])), { secret: env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON, bucket: env.BUCKET, onlySaved: data.onlySaved });
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (path[0] === "chirp-activate") {
      const { voice } = z.object({ voice: z.enum(CHIRP_VOICES) }).strict().parse(body);
      if (!env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON) throw new AppError("Google narration needs secure setup first.", 503);
      await activateChirp(db, voice);
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (path[0] === "advance-weekly-refresh") { const { runId } = weeklyRefreshRequest.parse(body); return Response.json({ refresh: await advanceWeeklyRefresh(db, user.userId, { apiKey: env.OPENAI_API_KEY, bucket: env.BUCKET, narrate: (db, lesson) => generateNarration(db, lessonKey(lesson)) }, "manual", runId) }, { headers: noStore }); }
    if (path[0] === "check-saved-request") return Response.json({ check: await recoverSavedRequest(db, user.userId, body) }, { headers: noStore });
    if (path[0] === "replace-narration") return Response.json({ replacement: await authorizeNarrationReplacement(db, user.userId, narrationReplacementRequest.parse(body), env.BUCKET) }, { headers: noStore });
    if (path[0] === "request-refresh") return Response.json({ item: await requestLessonRefresh(db, user.userId, refreshRequest.parse(body)) }, { headers: noStore });
    if (path[0] === "recover-narration") { const { key } = z.object({ key: keySchema }).strict().parse(body); await recoverNarration(db, key); return Response.json({ ok: true }, { headers: noStore }); }
    if (path[0] === "review-cost") return Response.json({ review: await recordCostReview(db, user.userId, reviewCostRequest.parse(body)) }, { headers: noStore });
    if (path[0] === "release-preparation") {
      const { id } = z.object({ id: z.string().uuid() }).strict().parse(body);
      return Response.json({ release: await releasePreparedLesson(db, user.userId, id) }, { headers: noStore });
    }
    if (path[0] === "preparation") {
      return Response.json({ preparation: await prepareLessonStage(db, user.userId, preparationRequest.parse(body), { apiKey: env.OPENAI_API_KEY }) }, { headers: noStore });
    }
    if (path[0] === "research-question") return Response.json(await researchQuestion(db, user.userId, questionResearchRequest.parse(body), { apiKey: env.OPENAI_API_KEY }), { headers: noStore });
    if (path[0] === "research") {
      const data = z.object({ id: z.string().uuid(), topicId: z.string().uuid() }).strict().parse(body);
      return Response.json({ research: await researchTopic(db, user.userId, data, { apiKey: env.OPENAI_API_KEY }) }, { headers: noStore });
    }
    if (path[0] === "source") {
      const data = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).strict().parse(body);
      return Response.json({ capture: await captureSavedSource(db, user.userId, data) }, { headers: noStore });
    }
    if (path[0] === "recover") {
      const data = z.object({ token: z.string().uuid() }).parse(body);
      await recoverGenerationLock(db, data.token);
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (path[0] === "question") {
      const data = z.object({ id: z.string().uuid(), key: keySchema, question: z.string().trim().min(1).max(2000), sourceCaptureIds: sourceSelectionSchema }).strict().parse(body);
      const lesson = await getLesson(db, data.key);
      const question = await answerQuestion(db, user.userId, lesson, data, { apiKey: env.OPENAI_API_KEY });
      return Response.json({ question }, { headers: noStore });
    }
    if (path[0] === "narrate") { const { key } = z.object({ key: keySchema }).parse(body); await generateNarration(db, key); return Response.json({ ok: true }, { headers: noStore }); }
    if (path[0] === "courses") {
      const data = z.object({ courses: z.array(z.object({ id: z.string(), active: z.boolean() })).length(courses.length) }).parse(body);
      if (new Set(data.courses.map(c => c.id)).size !== courses.length || data.courses.some(c => !courses.some(known => known.id === c.id))) throw new AppError("Choose from your existing courses.");
      await db.prepare("INSERT INTO preferences(user_id,key,value,updated_at) VALUES(?,'courses',?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
        .bind(user.userId, JSON.stringify(data.courses), Date.now()).run();
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (path[0] === "library") {
      const data = z.object({ id: z.string().uuid(), kind: z.enum(["source", "topic"]), title: z.string().trim().min(3).max(200), url: z.string().url().max(2000).optional(), detail: z.string().trim().max(2000).default("") }).strict().parse(body);
      if ((data.kind === "source" && !data.url) || (data.url && (new URL(data.url).protocol !== "https:" || new URL(data.url).username || new URL(data.url).password))) throw new AppError("Use a public HTTPS source link without account credentials.");
      await db.prepare("INSERT OR IGNORE INTO library_items(id,user_id,kind,title,url,detail,status,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(data.id, user.userId, data.kind, data.title, data.url ?? null, data.detail, data.kind === "topic" ? "awaiting research" : "saved", Date.now()).run();
      const saved = await db.prepare("SELECT user_id,kind,title,url,detail FROM library_items WHERE id=?").bind(data.id).first<{ user_id: string; kind: string; title: string; url: string | null; detail: string }>();
      if (!saved || saved.user_id !== user.userId || saved.kind !== data.kind || saved.title !== data.title || saved.url !== (data.url ?? null) || saved.detail !== data.detail) throw new AppError("This saved item already has different information. Edit it before trying again.", 409);
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (path[0] === "progress") {
      const data = z.object({ key: keySchema, position: z.number().min(0).max(3600).optional(), section: z.number().int().min(0).max(100).optional(), completed: z.boolean(), observedAt: z.number().int() }).parse(body);
      const lesson = await getLesson(db, data.key);
      if (data.section !== undefined && data.section >= lesson.sections.length) throw new AppError("Reading section is invalid.");
      const progress = await writeProgress(db, user.userId, data);
      return Response.json({ progress }, { headers: noStore });
    }
    if (path[0] === "activity") {
      const data = z.object({ key: keySchema, start: z.number().int(), end: z.number().int(), mode: z.enum(["reading", "audio"]) }).parse(body);
      await getLesson(db, data.key);
      const now = Date.now();
      if (data.start >= data.end || data.end - data.start > 300_000 || data.start < now - 600_000 || data.end > now + 5000) throw new AppError("Learning interval is outside the allowed range.");
      const slots = activityMasks(data.start, data.end);
      if (slots.length) await db.batch(slots.map(slot => db.prepare(`INSERT INTO activity(user_id,minute,low,high) VALUES(?,?,?,?)
        ON CONFLICT(user_id,minute) DO UPDATE SET low=activity.low|excluded.low,high=activity.high|excluded.high`).bind(user.userId, slot.minute, slot.low, slot.high)));
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (path[0] === "notes") {
      const data = z.object({ id: z.string().uuid(), key: keySchema, kind: z.enum(["reflection", "challenge", "takeaway"]), text: z.string().trim().min(1).max(5000) }).parse(body);
      await getLesson(db, data.key);
      await saveNote(db, user.userId, data);
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (path[0] === "prepare-weekly") { z.object({}).strict().parse(body); return Response.json({ batch: await prepareWeekly(db, user.userId) }, { headers: noStore }); }
    if (path[0] === "choose-weekly") return Response.json({ choice: await chooseWeekly(db, user.userId, body) }, { headers: noStore });
    if (path[0] === "save-weekly-topic") return Response.json(await saveWeeklyTopic(db, user.userId, body), { headers: noStore });
    if (path[0] === "complete-supplement") return Response.json({ completion: await completeSupplement(db, user.userId, body) }, { headers: noStore });
    if (path[0] === "quiz") {
      const data = z.object({ id: z.string().uuid(), key: keySchema, answer: z.number().int().min(0).max(10) }).parse(body);
      const lesson = await getLesson(db, data.key);
      const result = await saveQuiz(db, user.userId, lesson, data);
      return Response.json(result, { headers: noStore });
    }
    throw new AppError("That action is not available yet.", 404);
  } catch (error) { return apiError(error instanceof z.ZodError || error instanceof SyntaxError ? new AppError("Please check the information and try again.") : error); }
}

export const HEAD = GET;
