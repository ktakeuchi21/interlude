import { GOOGLE_PROJECT_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL } from "../lib/google-project";
import { test } from "node:test";
import { api } from "../lib/client";
import { deliverPlanPublication, deliverPlanPublications, type PlanPublication } from "../lib/plan-publications";
import { googleAccessToken, splitChirpText, chirpPcm, SYNTHESIS_URL } from "../lib/google-tts";
import { prepareChirpLesson, prepareChirpPreview, activateChirp } from "../lib/chirp-narration";
import { reserveChirp, chirpSummary } from "../lib/chirp-usage";
import { CHIRP_WINDOW } from "../lib/chirp-voices";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { activityMasks, bitCount } from "../lib/activity";
import { parseRange, waveHeader, splitNarration } from "../lib/audio";
import { reserveSpend, settleSpend, uncertainSpend, budgetSummary, MONTHLY_LIMIT } from "../lib/budget";
import { writeProgress } from "../lib/progress";
import { mergeProgress } from "../lib/progress-state";
import { selectHomeLesson } from "../lib/next-lesson";
import { encodeVoiceWav, validateVoiceWav, VOICE_SAMPLE_RATE, MAX_VOICE_BYTES } from "../lib/voice-audio";
import { transcribeVoice, getVoiceDraft, TRANSCRIPTION_RESERVATION } from "../lib/transcription";
import { requestMicrophone, microphoneMessage } from "../lib/voice-recording";
import { appendReviewedLessonVersion, lessonContentHash, releaseFromRow, type VersionRow } from "../lib/lesson-release";
import { partitionLessonVersions, completedLessonIds, completedVersions, findLessonVersion, hasUnreadUpdate } from "../lib/lesson-history";
import type { LessonReviewReceipt, Progress } from "../lib/contracts";
import { captureSavedSource, capturedMaterial, getSourceCapture, MONTHLY_SOURCE_RETRIEVALS, MAX_SOURCE_COPIES } from "../lib/source-capture";
import { sourceUrl, extractSource, materialHash, MAX_SOURCE_BYTES, MAX_SOURCE_RESPONSE } from "../lib/source-text";
import { overviewView, savedInterestAnchor } from "../lib/navigation";
import { prepareLessonStage, getLessonPreparation, nextPreparationStage, PREPARATION_LIMITS, preparationReservation, type PreparationStage } from "../lib/lesson-preparation";
import { reviewUnits, type LessonDraft, type PreparationReview, type SourceInspection } from "../lib/preparation-content";
import { releasePreparedLesson } from "../lib/prepared-release";
import { recordCostReview, publicSpend, type AccountedSpend } from "../lib/cost-review";
import { dollarAmount } from "../lib/money";
import { authorizeNarrationReplacement, narrationPlan, narrationAttempts } from "../lib/narration-attempts";
import { prepareNarration } from "../lib/narration-generation";
import { requestLessonRefresh, validateRefreshContext } from "../lib/lesson-refresh";
import { REFRESH_LIMITS } from "../lib/lesson-preparation";
import { completeSupplement } from "../lib/supplement-records";
import { lessonSupplements, supplements } from "../lib/supplements";
import { mountEmbed } from "../lib/embed-players";
import { claimMediaFocus, MEDIA_FOCUS_EVENT } from "../lib/media-focus";
import { prepareWeekly, chooseWeekly, saveWeeklyTopic, weeklyHistory, MAX_WEEKLY_BATCHES } from "../lib/weekly";
import { learningWeek, selectWeekly, type WeeklyContext } from "../lib/weekly-selection";
import { recoverSavedRequest } from "../lib/request-recovery";
import { advanceWeeklyRefresh, savedWeeklyRefreshState, weeklyRefreshHistory, weeklyRefreshState, selectRefreshLesson, REFRESH_INTERVAL } from "../lib/weekly-refresh";

test("a pinned weekly refresh crosses a week boundary through release and audio without creating another run", async t => {
  let now = Date.UTC(2026, 9, 18, 23, 59, 59); t.mock.method(Date, "now", () => now);
  const f = await refreshPreparationFixture(), storage = narrationBucketFixture(); let searches = 0, audio = 0;
  const services = { ...storage, apiKey: "EXPLICIT_FIXTURE_KEY", narrate: (db: D1Database, lesson: typeof firstLesson) => prepareNarration(db, lesson, { ...storage, apiKey: "EXPLICIT_FIXTURE_KEY", fetch: (async () => { audio++; return new Response(new Uint8Array(48000)); }) as typeof fetch }), fetch: (async (url, init) => {
    if (url === "https://api.openai.com/v1/audio/speech") { audio++; return new Response(new Uint8Array(48000)); }
    if (url !== "https://api.openai.com/v1/responses") return new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } });
    if (JSON.parse(String(init?.body)).tools) { searches++; return searchFixture(); }
    return f.services.fetch(url, init);
  }) as typeof fetch };
  try {
    const first = await advanceWeeklyRefresh(f.db, "owner", services, "scheduled"), id = first.run.preparation_id;
    assert.equal(first.run.week, "2026-10-12");
    await advanceWeeklyRefresh(f.db, "owner", services, "scheduled", id);
    const searchCost = f.sql.prepare("SELECT * FROM spending WHERE id=?").get(`research:${first.run.research_id}`);
    now += 2000; assert.equal(learningWeek(now), "2026-10-19");
    assert.equal((await savedWeeklyRefreshState(f.db, "owner", id)).stage, "inspect");
    const stages = [];
    for (let i = 0; i < 5; i++) stages.push((await advanceWeeklyRefresh(f.db, "owner", services, "scheduled", id)).stage);
    assert.deepEqual(stages, ["draft", "review", "release", "narration", "complete"]);
    assert.equal(searches, 1); assert.equal(f.packets.length, 3); assert.ok(audio > 0);
    assert.deepEqual(f.sql.prepare("SELECT * FROM spending WHERE id=?").get(`research:${first.run.research_id}`), searchCost);
    assert.deepEqual(await weeklyRefreshHistory(f.db, "owner"), [first.run]);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM weekly_batches").get()?.n, 1);
    assert.equal(await weeklyRefreshState(f.db, "owner", "2026-10-19"), null);
    const before = f.sql.prepare("SELECT * FROM spending ORDER BY id").all();
    await advanceWeeklyRefresh(f.db, "owner", {}, "manual", id);
    assert.deepEqual(f.sql.prepare("SELECT * FROM spending ORDER BY id").all(), before);
    assert.equal((await savedWeeklyRefreshState(f.db, "owner", id)).run.origin, "scheduled");
  } finally { f.sql.close(); }
});

test("saved-run continuation is owner-bound, never falls back to a new week, and keeps old uncertainty held", async t => {
  let now = Date.UTC(2026, 9, 18); t.mock.method(Date, "now", () => now);
  const { db, sql } = supplementFixture(); let calls = 0;
  const services = { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: async () => { calls++; throw new Error("EXPLICIT lost prior-week search"); } };
  try {
    const first = await advanceWeeklyRefresh(db, "owner"), id = first.run.preparation_id;
    await assert.rejects(advanceWeeklyRefresh(db, "owner", services, "manual", id)); assert.equal(calls, 1);
    const before = sql.prepare("SELECT * FROM spending ORDER BY id").all(); now += 8 * 86400000;
    const checked = await savedWeeklyRefreshState(db, "owner", id); assert.equal(checked.stage, "held");
    assert.deepEqual(await advanceWeeklyRefresh(db, "owner", services, "manual", id), checked);
    assert.equal(calls, 1); assert.deepEqual(sql.prepare("SELECT * FROM spending ORDER BY id").all(), before);
    await assert.rejects(savedWeeklyRefreshState(db, "foreign", id), /Only the owner/);
    await assert.rejects(advanceWeeklyRefresh(db, "foreign", services, "manual", id), /Only the owner/);
    const missing = crypto.randomUUID();
    await assert.rejects(savedWeeklyRefreshState(db, "owner", missing), /not found/);
    await assert.rejects(advanceWeeklyRefresh(db, "owner", services, "manual", missing), /not found/);
    await assert.rejects(advanceWeeklyRefresh(db, "owner", services, "manual", ""));
    assert.deepEqual(await weeklyRefreshHistory(db, "owner"), [first.run]);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM weekly_batches").get()?.n, 1);
    assert.deepEqual(sql.prepare("SELECT * FROM spending ORDER BY id").all(), before);
  } finally { sql.close(); }
});

test("weekly refresh selects due current AI lessons conservatively and fixes one immutable identity per week", async t => {
  const now = Date.UTC(2026, 9, 12); t.mock.method(Date, "now", () => now);
  const { db, sql } = supplementFixture();
  try {
    const active = courses.map(c => ({ id: c.id, active: true }));
    assert.equal(selectRefreshLesson([firstLesson], active, [], Date.UTC(2026, 8, 14)), null);
    assert.equal(selectRefreshLesson([firstLesson], active.map(c => ({ ...c, active: false })), [], now), null);
    const [one, two] = await Promise.all([advanceWeeklyRefresh(db, "owner"), advanceWeeklyRefresh(db, "owner")]);
    assert.deepEqual(one.run, two.run); assert.equal(one.run.lesson_key, lessonKey(firstLesson)); assert.equal(one.stage, "research");
    assert.equal(one.run.origin, "manual"); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM weekly_refreshes").get()?.n, 1);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM weekly_batches").get()?.n, 1);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 0);
    assert.equal(selectRefreshLesson([firstLesson], active, [one.run], now + REFRESH_INTERVAL - 1), null);
    assert.equal(selectRefreshLesson([firstLesson], active, [one.run], now + REFRESH_INTERVAL)?.id, firstLesson.id);
    assert.throws(() => sql.prepare("UPDATE weekly_refreshes SET research_id=?").run(crypto.randomUUID()), /original target/);
    await assert.rejects(advanceWeeklyRefresh(db, "foreign"), /Only the owner/);
    await assert.rejects(weeklyRefreshState(db, "foreign", one.run.week), /Only the owner/);
  } finally { sql.close(); }
});

test("one weekly refresh carries real helpers through research, reviewed revision and reused narration without rewriting old learning", async t => {
  t.mock.method(Date, "now", () => Date.UTC(2026, 9, 12));
  const f = await refreshPreparationFixture(), storage = narrationBucketFixture(); let searches = 0, pages = 0, audio = 0;
  const services = { ...storage, apiKey: "EXPLICIT_FIXTURE_KEY", narrate: (db: D1Database, lesson: typeof firstLesson) => prepareNarration(db, lesson, { ...storage, apiKey: "EXPLICIT_FIXTURE_KEY", fetch: (async () => { audio++; return new Response(new Uint8Array(48000)); }) as typeof fetch }), fetch: (async (url, init) => {
    if (url === "https://api.openai.com/v1/audio/speech") { audio++; return new Response(new Uint8Array(48000)); }
    if (url !== "https://api.openai.com/v1/responses") { pages++; return new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } }); }
    if (JSON.parse(String(init?.body)).tools) { searches++; return searchFixture(); }
    return f.services.fetch(url, init);
  }) as typeof fetch };
  try {
    await writeProgress(f.db, "owner", { key: f.key, position: 80, section: 2, completed: true, observedAt: Date.now() });
    f.sql.prepare("INSERT INTO notes(id,user_id,lesson_key,kind,text,created_at) VALUES('weekly-original-note','owner',?,'reflection','EXPLICIT ORIGINAL NOTE',?)").run(f.key, Date.now());
    f.sql.prepare("INSERT INTO media(lesson_key,object_key,content_type,bytes,duration,created_at) VALUES(?,'EXPLICIT_ORIGINAL_AUDIO_FIXTURE','audio/wav',48,1,?)").run(f.key, Date.now());
    const original = f.sql.prepare("SELECT * FROM lesson_versions WHERE key=?").get(f.key);
    const records = ["progress", "notes", "events", "activity"].map(table => ({ table, rows: f.sql.prepare(`SELECT * FROM ${table}`).all() }));
    const stages = [];
    for (let i = 0; i < 7; i++) stages.push((await advanceWeeklyRefresh(f.db, "owner", services, "scheduled")).stage);
    assert.deepEqual(stages, ["research", "inspect", "draft", "review", "release", "narration", "complete"]);
    const complete = await advanceWeeklyRefresh(f.db, "owner", services, "scheduled");
    assert.equal(complete.run.origin, "scheduled"); assert.equal(complete.updatedLessonKey, `${firstLesson.id}:v2`);
    assert.equal(searches, 1); assert.equal(pages, 2); assert.equal(f.packets.length, 3); assert.ok(audio > 0);
    const calls = { searches, pages, preparations: f.packets.length, audio }, spending = f.sql.prepare("SELECT * FROM spending ORDER BY id").all();
    assert.deepEqual(await advanceWeeklyRefresh(f.db, "owner", {}), complete);
    assert.deepEqual({ searches, pages, preparations: f.packets.length, audio }, calls);
    assert.deepEqual(f.sql.prepare("SELECT * FROM spending ORDER BY id").all(), spending);
    assert.deepEqual(f.sql.prepare("SELECT * FROM lesson_versions WHERE key=?").get(f.key), original);
    for (const record of records) assert.deepEqual(f.sql.prepare(`SELECT * FROM ${record.table}`).all(), record.rows);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 2);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM media").get()?.n, 2);
    assert.ok((await budgetSummary(f.db)).committed > 0);
  } finally { f.sql.close(); }
});

test("weekly refresh leaves unchanged or unsupported teaching intact and never advances an uncertain paid stage", async t => {
  t.mock.method(Date, "now", () => Date.UTC(2026, 9, 12));
  for (const mode of ["unchanged", "empty_search", "lost_search", "lost_inspect", "lost_draft", "lost_review"] as const) {
    const f = await refreshPreparationFixture(); let calls = 0;
    const services = { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: (async (url, init) => {
      if (url !== "https://api.openai.com/v1/responses") return new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } });
      calls++; const body = JSON.parse(String(init?.body));
      if (body.tools) { if (mode === "lost_search") throw new Error("EXPLICIT lost weekly search"); return searchFixture(mode === "empty_search" ? { urls: [] } : {}); }
      const stage = body.text.format.name.replace("lesson_", "");
      if (mode === `lost_${stage}`) throw new Error("EXPLICIT interrupted weekly stage");
      if (mode === "unchanged") return preparationResponse({ ...f.inspection, update: { decision: "unchanged", summary: "EXPLICIT FIXTURE: no material change.", changes: [] } });
      return f.services.fetch(url, init);
    }) as typeof fetch };
    try {
      for (let i = 0; i < 6; i++) {
        try { if (!(await advanceWeeklyRefresh(f.db, "owner", services)).canAdvance) break; }
        catch { break; }
      }
      const history = await weeklyRefreshHistory(f.db, "owner"), before = f.sql.prepare("SELECT * FROM spending ORDER BY id").all(), callsBefore = calls;
      const stopped = await advanceWeeklyRefresh(f.db, "owner", services);
      assert.equal(stopped.stage, mode === "unchanged" ? "unchanged" : mode === "empty_search" ? "needs_sources" : "held", mode);
      assert.equal(calls, callsBefore); assert.deepEqual(await weeklyRefreshHistory(f.db, "owner"), history);
      assert.deepEqual(f.sql.prepare("SELECT * FROM spending ORDER BY id").all(), before);
      assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 1);
      assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM media").get()?.n, 0);
      if (mode === "unchanged") assert.equal(calls, 2, "unchanged costs one search and one inspection only");
    } finally { f.sql.close(); }
  }
});

test("weekly delivery preserves missing setup and full-budget stops, and an unrelated newer version stops stale work", async t => {
  t.mock.method(Date, "now", () => Date.UTC(2026, 9, 12));
  const f = await readyRefreshFixture(); let calls = 0;
  const services = { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: (async () => { calls++; return searchFixture(); }) as typeof fetch };
  try {
    const first = await advanceWeeklyRefresh(f.db, "owner");
    await assert.rejects(advanceWeeklyRefresh(f.db, "owner", { fetch: services.fetch }), /secure AI setup/);
    assert.equal(calls, 0);
    await reserveSpend(f.db, "weekly-full-budget", "fixture", MONTHLY_LIMIT - (await budgetSummary(f.db)).committed, "EXPLICIT full budget");
    await assert.rejects(advanceWeeklyRefresh(f.db, "owner", services)); assert.equal(calls, 0);
    assert.equal((await weeklyRefreshHistory(f.db, "owner"))[0].research_id, first.run.research_id);
    await releasePreparedLesson(f.db, "owner", f.data.id);
    const stale = await advanceWeeklyRefresh(f.db, "owner", services); assert.equal(stale.stage, "superseded"); assert.equal(calls, 0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 2);
  } finally { f.sql.close(); }
});

test("no-due weekly checks are free and bounded, including duplicate trigger deliveries", async t => {
  let now = Date.UTC(2026, 8, 14); t.mock.method(Date, "now", () => now);
  const { db, sql } = supplementFixture();
  try {
    const original = sql.prepare("SELECT * FROM lesson_versions").all();
    const one = await advanceWeeklyRefresh(db, "owner", {}, "scheduled");
    assert.equal(one.stage, "no_due_lesson"); assert.equal(one.canAdvance, false);
    assert.deepEqual(await advanceWeeklyRefresh(db, "owner", {}, "scheduled"), one);
    assert.deepEqual(sql.prepare("SELECT * FROM lesson_versions").all(), original);
    assert.equal((await budgetSummary(db)).committed, 0); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()?.n, 0);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n, 0);
    for (let i = 1; i < MAX_WEEKLY_BATCHES; i++) sql.prepare("INSERT INTO weekly_refreshes(user_id,week,origin,reason,topic_id,research_id,preparation_id,created_at) VALUES('owner',?,'manual','EXPLICIT retention fixture',?,?,?,1)").run(`EXPLICIT-${i}`, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID());
    now += 7 * 86400000;
    await assert.rejects(advanceWeeklyRefresh(db, "owner"), /retained refresh history is full/);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM weekly_refreshes").get()?.n, MAX_WEEKLY_BATCHES);
    assert.equal((await budgetSummary(db)).committed, 0);
  } finally { sql.close(); }
});

test("free saved-output checks restore exact original accounting for questions, voice, research and every preparation stage", async t => {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("A saved-output check must never reach the network"); });
  for (const kind of ["question", "transcribe", "research", "lesson"] as const) {
    const f = kind === "lesson" ? await readyPreparationFixture() : supplementFixture(), { db, sql } = f;
    if (kind === "lesson") sql.prepare("INSERT INTO owner(id,user_id,created_at) VALUES(1,'owner',?)").run(Date.now());
    try {
      const id = crypto.randomUUID();
      if (kind === "question") await answerQuestion(db, "owner", firstLesson, { id, question: "EXPLICIT recovery fixture question" }, { apiKey: "fixture", fetch: async () => answerFixture() });
      if (kind === "transcribe") await transcribeVoice(db, "owner", { id, key: lessonKey(firstLesson), purpose: "reflection", bytes: voiceFixture() }, { apiKey: "fixture", fetch: async () => Response.json({ text: "EXPLICIT recovery transcript fixture", duration: 2 }) });
      if (kind === "research") await researchTopic(db, "owner", { id, topicId: await saveTopicFixture(db) }, { apiKey: "fixture", fetch: async () => searchFixture({ urls: [] }) });
      const original = sql.prepare("SELECT * FROM spending ORDER BY id").all();
      const tables = ["questions", "transcriptions", "topic_research", "source_captures", "lesson_preparations", "lesson_versions", "notes", "progress", "events", "activity", "library_items", "spend_reviews"];
      const before = tables.map(table => sql.prepare(`SELECT * FROM ${table}`).all());
      sql.prepare("UPDATE spending SET status='uncertain',charged=NULL,result=NULL").run();
      for (const request of original) {
        const checked = await recoverSavedRequest(db, "owner", { spendingId: request.id }); assert.equal(checked.available, true); assert.match(checked.href, /^\/\?/);
        assert.deepEqual(await recoverSavedRequest(db, "owner", { spendingId: request.id }), checked);
      }
      const withoutTime = (rows: typeof original) => rows.map(row => ({ ...row, updated_at: 0 }));
      assert.deepEqual(withoutTime(sql.prepare("SELECT * FROM spending ORDER BY id").all()), withoutTime(original));
      for (const [i, table] of tables.entries()) assert.deepEqual(sql.prepare(`SELECT * FROM ${table}`).all(), before[i], table);
      assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM generation_lock").get()?.n, 0);
    } finally { sql.close(); }
  }
  assert.equal(network.mock.callCount(), 0);
});
test("missing saved output stays held and checks never resend an uncertain request", async t => {
  const { db, sql } = supplementFixture(), id = crypto.randomUUID(), data = { id, question: "EXPLICIT interrupted question fixture" }; let calls = 0;
  const services = { apiKey: "fixture", fetch: async () => { calls++; throw new Error("EXPLICIT lost response fixture"); } };
  try {
    await assert.rejects(answerQuestion(db, "owner", firstLesson, data, services));
    const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Recovery must not fetch"); });
    const before = sql.prepare("SELECT * FROM spending").all();
    const check = await recoverSavedRequest(db, "owner", { spendingId: `question:${id}` }); assert.equal(check.available, false);
    assert.deepEqual(sql.prepare("SELECT * FROM spending").all(), before);
    await assert.rejects(answerQuestion(db, "owner", firstLesson, data, services), /already started/); assert.equal(calls, 1); assert.equal(network.mock.callCount(), 0);
    assert.equal(sql.prepare("SELECT answer FROM questions").get()?.answer, null);
  } finally { sql.close(); }
});
test("saved-output recovery enforces owner and original request identity without accepting browser evidence", async () => {
  const { db, sql } = supplementFixture(), id = crypto.randomUUID(), spendingId = `question:${id}`;
  try {
    await answerQuestion(db, "owner", firstLesson, { id, question: "EXPLICIT ownership fixture" }, { apiKey: "fixture", fetch: async () => answerFixture() });
    const before = sql.prepare("SELECT * FROM spending").all();
    await assert.rejects(recoverSavedRequest(db, "foreign", { spendingId }), /Only the owner/);
    for (const extra of [{ userId: "foreign" }, { cost: 0 }, { answer: {} }, { apiKey: "forged" }, { retry: true }]) await assert.rejects(recoverSavedRequest(db, "owner", { spendingId, ...extra }));
    await assert.rejects(recoverSavedRequest(db, "owner", { spendingId: `research:${id}` }), /not found/);
    sql.prepare("UPDATE questions SET user_id='foreign' WHERE id=?").run(id);
    await assert.rejects(recoverSavedRequest(db, "owner", { spendingId }), /not found/);
    assert.deepEqual(sql.prepare("SELECT * FROM spending").all(), before);
    sql.prepare("UPDATE spending SET kind='topic research' WHERE id=?").run(spendingId);
    await assert.rejects(recoverSavedRequest(db, "owner", { spendingId }), /identity needs inspection/);
  } finally { sql.close(); }
});
test("free recovery respects a running preparation and permits repeat checks after its release", async () => {
  const { db, sql } = supplementFixture(), id = crypto.randomUUID(), spendingId = `question:${id}`;
  try {
    await answerQuestion(db, "owner", firstLesson, { id, question: "EXPLICIT concurrency fixture" }, { apiKey: "fixture", fetch: async () => answerFixture() });
    const before = sql.prepare("SELECT * FROM spending").all();
    await withGenerationLock(db, "EXPLICIT running generation", async () => { await assert.rejects(recoverSavedRequest(db, "owner", { spendingId }), /Another preparation/); });
    const results = await Promise.allSettled([recoverSavedRequest(db, "owner", { spendingId }), recoverSavedRequest(db, "owner", { spendingId })]);
    assert.ok(results.some(r => r.status === "fulfilled"));
    for (const r of results) if (r.status === "rejected") assert.match(r.reason.message, /Another preparation/);
    assert.equal((await recoverSavedRequest(db, "owner", { spendingId })).available, true); assert.deepEqual(sql.prepare("SELECT * FROM spending").all(), before);
  } finally { sql.close(); }
});
test("saved-output checks can repair ordinary saved results during a spending pause without clearing anomalous costs", async () => {
  const { db, sql } = supplementFixture(), id = crypto.randomUUID(), spendingId = `question:${id}`;
  try {
    await answerQuestion(db, "owner", firstLesson, { id, question: "EXPLICIT cost-pause fixture" }, { apiKey: "fixture", fetch: async () => answerFixture() });
    await reserveSpend(db, "EXPLICIT anomalous usage", "fixture", 100, "EXPLICIT fixture"); sql.prepare("UPDATE spending SET status='cost_review',charged=200 WHERE id='EXPLICIT anomalous usage'").run();
    sql.prepare("UPDATE spending SET status='uncertain',charged=NULL,result=NULL WHERE id=?").run(spendingId);
    assert.equal((await recoverSavedRequest(db, "owner", { spendingId })).available, true); assert.equal((await budgetSummary(db)).paused, true);
    sql.prepare("UPDATE spending SET status='cost_review' WHERE id=?").run(spendingId); const before = sql.prepare("SELECT * FROM spending").all();
    await assert.rejects(recoverSavedRequest(db, "owner", { spendingId }), /review before settlement/);
    assert.deepEqual(sql.prepare("SELECT * FROM spending").all(), before); assert.equal((await budgetSummary(db)).paused, true);
  } finally { sql.close(); }
});

test("weekly sets are private, immutable, bounded and identical after concurrent generation or changed interests", async () => {
  const { db, sql } = supplementFixture(), now = Date.parse("2026-09-13T21:00:00Z");
  try {
    await assert.rejects(prepareWeekly(db, "other", now), /Only the owner/);
    const before = Object.fromEntries(["lesson_versions", "progress", "notes", "activity", "spending", "media", "events"].map(t => [t, sql.prepare(`SELECT * FROM ${t}`).all()]));
    const batches = await Promise.all(Array.from({ length: 6 }, () => prepareWeekly(db, "owner", now)));
    for (const b of batches) assert.deepEqual(b, batches[0]); assert.ok(batches[0].items.length > 0 && batches[0].items.length <= 3);
    assert.equal(batches[0].week, "2026-09-07"); assert.equal(batches[0].origin, "manual");
    sql.prepare("INSERT INTO preferences(user_id,key,value,updated_at) VALUES('owner','courses','[]',?)").run(now);
    assert.deepEqual(await prepareWeekly(db, "owner", now + 1000), batches[0]);
    assert.throws(() => sql.prepare("UPDATE weekly_batches SET items='[]'").run(), /cannot be changed/);
    for (const [t, rows] of Object.entries(before)) assert.deepEqual(sql.prepare(`SELECT * FROM ${t}`).all(), rows, t);
    assert.equal((await weeklyHistory(db, "owner")).batches.length, 1);
  } finally { sql.close(); }
});
test("weekly selection respects course order, actual completed versions, due recall and saved interests", () => {
  const now = Date.parse("2026-09-13T21:00:00Z"), old = now - 9 * 86400000;
  const context: WeeklyContext = { lessons: pilotLessons, archivedLessons: [], progress: [{ lesson_key: lessonKey(firstLesson), position: 0, section: 4, completed: 1, revision: 1, observed_at: old }],
    coursePreferences: [{ id: "ai-product", active: true }, { id: "ai-development", active: false }, { id: "ai-healthcare", active: false }], events: [],
    libraryItems: [{ id: crypto.randomUUID(), kind: "source", title: "EXPLICIT WEEKLY SOURCE FIXTURE", url: "https://pair.withgoogle.com/chapter/user-needs/", detail: "test only", status: "saved", created_at: now }] };
  let items = selectWeekly(context, [], [], now);
  assert.equal(items[0].lessonKey, lessonKey(pilotLessons[1])); assert.equal(items[1].kind, "review"); assert.equal(items[1].lessonKey, lessonKey(firstLesson)); assert.equal(items.length, 3);
  assert.ok(items.every(i => !i.courseId || i.courseId === "ai-product"));
  context.events.push({ id: crypto.randomUUID(), kind: "quiz", payload: { key: lessonKey(firstLesson), correct: true }, created_at: now });
  items = selectWeekly(context, [], [], now); assert.ok(items.every(i => i.kind !== "review"));
  context.events[0].payload.correct = false; context.events[0].created_at = now - 2 * 86400000;
  assert.match(selectWeekly(context, [], [], now).find(i => i.kind === "review")!.reason, /missed the answer/);
  const updated = { ...firstLesson, version: 2 }; context.lessons = [updated, pilotLessons[1]]; context.archivedLessons = [firstLesson];
  items = selectWeekly(context, [], [], now); assert.equal(items[0].lessonKey, lessonKey(updated)); assert.match(items[0].reason, /earlier completion/); assert.ok(items.every(i => i.kind !== "review"), "Avoid recommending two versions of the same concept together");
  context.coursePreferences[0].active = false; items = selectWeekly(context, [], [], now); assert.ok(items.every(i => i.kind === "library"));
});
test("weekly dismissal is retry-safe, reversible and rejects an outdated conflicting device choice", async () => {
  const { db, sql } = supplementFixture();
  try {
    const batch = await prepareWeekly(db, "owner"), itemId = batch.items[0].id, input = { week: batch.week, itemId, dismissed: true, revision: 0 };
    const records = await Promise.all([chooseWeekly(db, "owner", input), chooseWeekly(db, "owner", input)]); assert.deepEqual(records[0], records[1]); assert.equal(records[0].revision, 1);
    const restored = await chooseWeekly(db, "owner", { ...input, dismissed: false, revision: 1 }); assert.equal(restored.revision, 2); assert.equal(restored.dismissed, 0);
    await assert.rejects(chooseWeekly(db, "owner", input), /another device/);
    assert.deepEqual(await chooseWeekly(db, "owner", { ...input, dismissed: false, revision: 1 }), restored);
    await assert.rejects(chooseWeekly(db, "other", { ...input, revision: 2 }), /Only the owner/);
    await assert.rejects(chooseWeekly(db, "owner", { ...input, itemId: crypto.randomUUID() }), /not found/);
    await assert.rejects(chooseWeekly(db, "owner", { ...input, title: "forged" }));
  } finally { sql.close(); }
});
test("selecting a proposed weekly topic saves its exact research request once without creating teaching or charges", async () => {
  const { db, sql } = supplementFixture();
  try {
    const batch = await prepareWeekly(db, "owner"), item = batch.items.find(i => i.kind === "topic")!, input = { week: batch.week, itemId: item.id };
    const count = sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n;
    const results = await Promise.all([saveWeeklyTopic(db, "owner", input), saveWeeklyTopic(db, "owner", input)]); assert.deepEqual(results[0], results[1]); assert.equal(results[0].itemId, item.topicId);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()?.n, 1); const saved = sql.prepare("SELECT title,status FROM library_items").get(); assert.equal(saved?.title, item.title); assert.equal(saved?.status, "awaiting research");
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, count); assert.equal((await budgetSummary(db)).committed, 0);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM topic_research").get()?.n, 0);
    await assert.rejects(saveWeeklyTopic(db, "other", input), /Only the owner/); await assert.rejects(saveWeeklyTopic(db, "owner", { ...input, title: "forged" }));
    await assert.rejects(saveWeeklyTopic(db, "owner", { ...input, itemId: batch.items.find(i => i.kind === "lesson")!.id }), /already points/);
  } finally { sql.close(); }
});
test("weekly boundaries, empty choices, repeat avoidance and retention limits preserve existing sets", async () => {
  assert.equal(learningWeek(Date.parse("2027-01-03T23:59:59Z")), "2026-12-28"); assert.equal(learningWeek(Date.parse("2027-01-04T00:00:00Z")), "2027-01-04");
  const { db, sql } = supplementFixture(), now = Date.parse("2026-09-13T21:00:00Z");
  try {
    const first = await prepareWeekly(db, "owner", now), item = first.items[0]; await chooseWeekly(db, "owner", { week: first.week, itemId: item.id, dismissed: true, revision: 0 });
    const next = await prepareWeekly(db, "owner", now + 7 * 86400000); assert.notEqual(next.week, first.week); assert.ok(!next.items.some(i => i.identity === item.identity));
    for (let n = 0; n < MAX_WEEKLY_BATCHES - 2; n++) sql.prepare("INSERT INTO weekly_batches(user_id,week,origin,items,created_at) VALUES('owner',?,'manual','[]',?)").run(`EXPLICIT RETENTION FIXTURE ${n}`, now);
    assert.deepEqual(await prepareWeekly(db, "owner", now), first); await assert.rejects(prepareWeekly(db, "owner", now + 14 * 86400000), /history is full/);
    const empty = selectWeekly({ lessons: [], archivedLessons: [], progress: [], events: [], coursePreferences: [], libraryItems: [] }, [], [], now); assert.deepEqual(empty, []);
  } finally { sql.close(); }
});

function supplementFixture(status = "ready") {
  const f = database();
  f.sql.prepare("INSERT INTO owner(id,user_id,created_at) VALUES(1,'owner',?)").run(Date.now());
  for (const l of pilotLessons) f.sql.prepare("INSERT INTO lesson_versions(key,lesson_id,version,course_id,content,status,created_at) VALUES(?,?,?,?,?,?,?)").run(lessonKey(l), l.id, l.version, l.courseId, JSON.stringify(l), status, Date.now());
  return f;
}
test("manual supplement completion survives concurrent device retries without lesson credit, minutes or charges", async () => {
  const { db, sql } = supplementFixture();
  try {
    const unaffected = ["lesson_versions", "progress", "activity", "notes", "spending", "media"], before = unaffected.map(t => sql.prepare(`SELECT * FROM ${t}`).all());
    const item = supplements[0], input = { key: item.lessonKeys[0], supplementId: item.id };
    const saved = await Promise.all(Array.from({ length: 8 }, () => completeSupplement(db, "owner", input)));
    assert.ok(saved.every(s => s.id === saved[0].id)); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n, 1);
    assert.equal(saved[0].method, "manual"); assert.equal(saved[0].sourceUrl, item.sourceUrl); assert.equal(saved[0].completed, true);
    const row = sql.prepare("SELECT * FROM events").get(); await completeSupplement(db, "owner", input); assert.deepEqual(sql.prepare("SELECT * FROM events").get(), row);
    for (const [i, t] of unaffected.entries()) assert.deepEqual(sql.prepare(`SELECT * FROM ${t}`).all(), before[i], t);
    const podcast = supplements[1]; await completeSupplement(db, "owner", { key: podcast.lessonKeys[0], supplementId: podcast.id });
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n, 2);
  } finally { sql.close(); }
});
test("supplements enforce owner, exact lesson version and server-selected metadata", async () => {
  const { db, sql } = supplementFixture();
  try {
    const item = supplements[0], input = { key: item.lessonKeys[0], supplementId: item.id };
    await assert.rejects(completeSupplement(db, "other", input), /Only the owner/);
    await assert.rejects(completeSupplement(db, "owner", { ...input, key: "what-models-can-do:v2" }), /unavailable/);
    await assert.rejects(completeSupplement(db, "owner", { ...input, supplementId: supplements[1].id }), /not attached/);
    for (const extra of [{ completed: true }, { minutes: 20 }, { provider: "forged" }, { sourceUrl: "https://forged.test/" }, { userId: "other" }]) await assert.rejects(completeSupplement(db, "owner", { ...input, ...extra }));
    assert.deepEqual(lessonSupplements("what-models-can-do:v2"), []);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n, 0);
    const draft = supplementFixture("draft");
    try { await assert.rejects(completeSupplement(draft.db, "owner", input), /unavailable/); } finally { draft.sql.close(); }
  } finally { sql.close(); }
});

/** Explicit SDK/DOM fixtures test our adapter, never real playback or device behavior. */
function browserFixture(values: Record<string, unknown>) {
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return () => { for (const [key, old] of Object.entries(previous)) { if (old) Object.defineProperty(globalThis, key, old); else Reflect.deleteProperty(globalThis, key); } };
}
function embedCallbacks() {
  const states: string[] = [], errors: string[] = [], durations: number[] = [];
  return { states, errors, durations, callbacks: { ready: () => states.push("ready"), playing: () => states.push("playing"), paused: () => states.push("paused"), ended: () => states.push("ended"), buffering: () => states.push("buffering"), error: (s: string) => errors.push(s), duration: (n: number) => durations.push(n) } };
}
test("YouTube adapter handles playback state, rejects a different video and ignores callbacks after closing", async () => {
  const item = supplements[0], record = embedCallbacks(); let pauses = 0, destroyed = 0, videoId = item.mediaId, options: Record<string, unknown> = {};
  const frame = { title: "" };
  class Player {
    constructor(_el: HTMLElement, supplied: Record<string, unknown>) { options = supplied; }
    pauseVideo() { pauses++; } destroy() { destroyed++; } getDuration() { return 478; } getVideoUrl() { return `https://www.youtube.com/watch?v=${videoId}`; } getIframe() { return frame; }
  }
  const restore = browserFixture({ window: { YT: { Player } }, location: { origin: "https://explicit-fixture.test" } });
  const controller = mountEmbed({} as HTMLElement, item, record.callbacks);
  try {
    await Promise.resolve(); const events = options.events as { onReady(): void; onStateChange(e: { data: number }): void; onError(): void };
    assert.deepEqual(options.playerVars, { autoplay: 0, playsinline: 1, rel: 0, origin: "https://explicit-fixture.test" });
    events.onReady(); for (const data of [3, 1, 2, 1, 0]) events.onStateChange({ data });
    assert.deepEqual(record.states, ["ready", "buffering", "playing", "paused", "playing", "ended"]); assert.equal(frame.title, item.title); assert.ok(record.durations.every(n => n === 478));
    videoId = "different-fixture-video"; events.onStateChange({ data: 1 }); assert.equal(pauses, 1); assert.match(record.errors[0], /another video/);
    controller.pause(); assert.equal(pauses, 2); controller.destroy(); assert.equal(destroyed, 1);
    const count = record.states.length; events.onStateChange({ data: 1 }); events.onReady(); events.onError(); assert.equal(record.states.length, count); assert.equal(record.errors.length, 1);
  } finally { controller.destroy(); restore(); }
});
test("Spotify adapter cleans up late initialization and reports pause, buffering and resumed playback", async () => {
  const item = supplements[1], record = embedCallbacks(), handlers: Record<string, (e: { data: Record<string, unknown> }) => void> = {};
  let destroyed = 0, pauses = 0;
  const player = { pause() { pauses++; }, destroy() { destroyed++; }, addListener(name: string, handler: (e: { data: Record<string, unknown> }) => void) { handlers[name] = handler; } };
  let created: ((p: typeof player) => void) | undefined;
  const api = { createController(_el: HTMLElement, opts: Record<string, unknown>, callback: (p: typeof player) => void) { assert.equal(opts.uri, `spotify:episode:${item.mediaId}`); created = callback; } };
  const restore = browserFixture({ window: { interludeSpotifyAPI: Promise.resolve(api) } });
  const controller = mountEmbed({} as HTMLElement, item, record.callbacks);
  try {
    await Promise.resolve(); created!(player); handlers.ready({ data: {} });
    for (const [isPaused, isBuffering] of [[false, false], [false, false], [true, false], [false, true], [false, false]]) handlers.playback_update({ data: { playingURI: `spotify:episode:${item.mediaId}`, isPaused, isBuffering, duration: 1346000 } });
    assert.deepEqual(record.states, ["ready", "playing", "paused", "buffering", "playing"]); assert.ok(record.durations.every(n => n === 1346));
    handlers.playback_update({ data: { playingURI: "spotify:episode:unexpected", isPaused: false } }); assert.equal(pauses, 1); assert.match(record.errors[0], /another episode/);
    controller.pause(); controller.destroy(); const count = record.states.length; handlers.ready({ data: {} }); assert.equal(record.states.length, count);
    const late = mountEmbed({} as HTMLElement, item, record.callbacks); await Promise.resolve(); late.destroy(); created!(player); assert.equal(destroyed, 2); assert.equal(pauses, 2);
  } finally { controller.destroy(); restore(); }
});
test("media focus pauses other local media and notifies embedded players without starting anything", () => {
  const paused: number[] = [], a = { pause: () => paused.push(1) }, b = { pause: () => paused.push(2) }, window = new EventTarget(), events: string[] = [];
  window.addEventListener(MEDIA_FOCUS_EVENT, e => events.push((e as CustomEvent<string>).detail));
  const restore = browserFixture({ window, document: { querySelectorAll: () => [a, b] } });
  try { claimMediaFocus("lesson", a as unknown as HTMLMediaElement); assert.deepEqual(paused, [2]); claimMediaFocus("voice"); assert.deepEqual(paused, [2, 1, 2]); assert.deepEqual(events, ["lesson", "voice"]); }
  finally { restore(); }
});
test("an unavailable embed SDK reports failure without becoming ready or leaving its loading timer alive", async () => {
  const record = embedCallbacks(); let removed = 0;
  const script = { remove() { removed++; }, onerror: () => {}, src: "", async: false };
  const restore = browserFixture({ window: {}, document: { createElement: () => script, head: { appendChild: () => queueMicrotask(() => script.onerror()) } } });
  const controller = mountEmbed({} as HTMLElement, supplements[0], record.callbacks);
  try { await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(record.states, []); assert.equal(record.errors.length, 1); assert.match(record.errors[0], /could not load/); assert.equal(removed, 1); }
  finally { controller.destroy(); restore(); }
});
import { checkInspection, checkDraft, checkReview, type PreparationInputs } from "../lib/preparation-content";

async function refreshPreparationFixture() {
  const f = await preparationFixture(), key = lessonKey(firstLesson);
  f.sql.prepare("INSERT INTO owner(id,user_id,created_at) VALUES(1,'owner',?)").run(Date.now());
  f.sql.prepare("INSERT INTO lesson_versions(key,lesson_id,version,course_id,content,status,created_at) VALUES(?,?,?,?,?,'ready',?)").run(key, firstLesson.id, firstLesson.version, firstLesson.courseId, JSON.stringify(firstLesson), Date.now());
  const request = { id: crypto.randomUUID(), key, reason: "EXPLICIT UPDATE FIXTURE: check a synthetic material change." };
  const item = await requestLessonRefresh(f.db, "owner", request), sourceCaptureIds: string[] = [];
  for (const oldId of f.data.sourceCaptureIds) {
    const old = f.sql.prepare("SELECT library_item_id FROM source_captures WHERE id=?").get(oldId)!;
    const id = crypto.randomUUID(); await captureSavedSource(f.db, "owner", { id, itemId: String(old.library_item_id) }, { fetch: async () => new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } }) }); sourceCaptureIds.push(id);
  }
  const draft = preparationDraftFixture(); draft.sections.at(-1)!.paragraphs.push("This added sentence is an explicit test fixture for a proposed update, not new researched teaching.");
  const inspection: SourceInspection = { ...inspectionFixture(), update: { decision: "update", summary: "EXPLICIT UPDATE FIXTURE: a simulated material change needs checking.", changes: [{ priorQuote: firstLesson.sections[1].paragraphs[0].split(" ").slice(0, 12).join(" "), reason: "Explicit fixture comparison, not a real source assessment.", support: [{ sourceId: "source-1", claimIndex: 0 }] }] } };
  const review: PreparationReview = { ...preparationReviewFixture(draft), updateCheck: { materialChange: true, objectivePreserved: true, changesSupported: true, summary: "EXPLICIT UPDATE FIXTURE: adds a test illustration while retaining the original learning objective." } };
  const packets: { stage: PreparationStage; bytes: number; packet: Record<string, unknown> }[] = [];
  const services = { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: (async (_url, init) => {
    const body = JSON.parse(String(init?.body)), stage = body.text.format.name.replace("lesson_", "") as PreparationStage;
    const packet = JSON.parse(body.input[0].content); packets.push({ stage, bytes: new TextEncoder().encode(String(init?.body)).length, packet });
    assert.equal(body.max_output_tokens, REFRESH_LIMITS[stage].tokens); assert.equal(body.service_tier, "default");
    assert.equal(packet.originalLesson.id, firstLesson.id); assert.equal(packet.originalLesson.version, 1);
    return preparationResponse(stage === "inspect" ? inspection : stage === "draft" ? draft : review);
  }) as typeof fetch };
  return { ...f, key, request, item, data: { id: crypto.randomUUID(), topicId: item.id, sourceCaptureIds }, draft, inspection, review, packets, services };
}
async function readyRefreshFixture() {
  const f = await refreshPreparationFixture();
  for (const stage of ["inspect", "draft", "review"] as const) await prepareLessonStage(f.db, "owner", { ...f.data, stage }, f.services);
  return f;
}

test("an owner can save an immutable update request without changing teaching or paying for AI", async () => {
  const f = await refreshPreparationFixture(), before = f.sql.prepare("SELECT * FROM lesson_versions").all();
  assert.deepEqual(await requestLessonRefresh(f.db, "owner", f.request), f.item);
  assert.equal(f.item.refresh_of, f.key); assert.equal(f.item.refresh_hash, await lessonContentHash(firstLesson));
  assert.deepEqual(f.sql.prepare("SELECT * FROM lesson_versions").all(), before); assert.equal((await budgetSummary(f.db)).committed, 0);
  assert.throws(() => f.sql.prepare("UPDATE library_items SET refresh_of='different:v1' WHERE id=?").run(f.item.id), /cannot be changed/);
  assert.throws(() => f.sql.prepare("UPDATE library_items SET detail='different' WHERE id=?").run(f.item.id), /cannot be changed/);
  await assert.rejects(requestLessonRefresh(f.db, "other", f.request), /Only the owner/);
  await assert.rejects(requestLessonRefresh(f.db, "owner", { ...f.request, reason: "different" }), /different details/);
  await assert.rejects(prepareLessonStage(f.db, "owner", { ...f.data, stage: "inspect" }, {}), /secure AI setup/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM lesson_preparations").get()?.n, 0);
});

test("a material update passes bounded independent checks and releases the next version while preserving old learning", async () => {
  const f = await readyRefreshFixture();
  await writeProgress(f.db, "owner", { key: f.key, position: 80, section: 2, completed: true, observedAt: Date.now() });
  f.sql.prepare("INSERT INTO notes(id,user_id,lesson_key,kind,text,created_at) VALUES('update-note','owner',?,'reflection','EXPLICIT ORIGINAL NOTE',?)").run(f.key, Date.now());
  f.sql.prepare("INSERT INTO media(lesson_key,object_key,content_type,bytes,duration,created_at) VALUES(?,'EXPLICIT_ORIGINAL_AUDIO_FIXTURE','audio/wav',48,1,?)").run(f.key, Date.now());
  const before = Object.fromEntries(["progress", "notes", "media", "events", "activity", "spending"].map(t => [t, f.sql.prepare(`SELECT * FROM ${t}`).all()]));
  const [first, repeated] = await Promise.all([releasePreparedLesson(f.db, "owner", f.data.id), releasePreparedLesson(f.db, "owner", f.data.id)]);
  assert.deepEqual(repeated, first); assert.deepEqual(await releasePreparedLesson(f.db, "owner", f.data.id), first);
  assert.equal(first.lesson_key, `${firstLesson.id}:v2`); assert.equal(first.previousKey, f.key); assert.equal(first.summary, f.review.updateCheck!.summary);
  const lessons = f.sql.prepare("SELECT content FROM lesson_versions").all().map(r => JSON.parse(String(r.content)) as Lesson), current = lessons.find(l => l.version === 2)!;
  assert.equal(current.id, firstLesson.id); assert.equal(current.courseId, firstLesson.courseId); assert.equal(current.order, firstLesson.order); assert.equal(current.objective, firstLesson.objective);
  assert.equal(current.sections.at(-1)!.paragraphs.at(-1), f.draft.sections.at(-1)!.paragraphs.at(-1));
  assert.deepEqual(lessons.find(l => l.version === 1), firstLesson);
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(f.sql.prepare(`SELECT * FROM ${table}`).all(), rows, `${table} retains original history`);
  assert.equal(f.packets.length, 3); for (const packet of f.packets) assert.ok(packet.bytes <= REFRESH_LIMITS[packet.stage].bytes);
  const saved = await getLessonPreparation(f.db, "owner", f.data.id); assert.equal(saved.refresh?.key, f.key); assert.equal(Object.hasOwn(saved.refresh!, "lesson"), false);
});

test("unchanged or insufficient update evidence stops before drafting and never creates a revision", async () => {
  for (const decision of ["unchanged", "needs_sources"] as const) {
    const f = await refreshPreparationFixture(); let calls = 0;
    const value = { ...f.inspection, sufficient: decision === "unchanged", update: { decision, summary: "EXPLICIT FIXTURE: no supported material change established.", changes: [] } };
    const saved = await prepareLessonStage(f.db, "owner", { ...f.data, stage: "inspect" }, { apiKey: "fixture", fetch: async () => { calls++; return preparationResponse(value); } });
    assert.equal(nextPreparationStage(saved), null); assert.equal(saved.draft, null); assert.equal(saved.review, null);
    await assert.rejects(prepareLessonStage(f.db, "owner", { ...f.data, stage: "draft" }, { apiKey: "fixture", fetch: async () => { calls++; throw new Error("Must not draft"); } }), /preceding source or teaching checks/);
    await assert.rejects(releasePreparedLesson(f.db, "owner", f.data.id), /Finish the source/);
    assert.equal(calls, 1); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 1); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 1);
  }
});

test("update checks require original passages, inspected support, unchanged objectives and substantive teaching changes", async () => {
  const f = await refreshPreparationFixture();
  await prepareLessonStage(f.db, "owner", { ...f.data, stage: "inspect" }, f.services);
  const inputs: PreparationInputs = JSON.parse(String(f.sql.prepare("SELECT inputs FROM lesson_preparations WHERE id=?").get(f.data.id)?.inputs));
  for (const update of [undefined, { ...f.inspection.update!, changes: [] }, { ...f.inspection.update!, changes: [{ ...f.inspection.update!.changes[0], priorQuote: "Words never present in the original lesson" }] }, { ...f.inspection.update!, changes: [{ ...f.inspection.update!.changes[0], support: [{ sourceId: "source-1", claimIndex: 2 }] }] }]) assert.throws(() => checkInspection({ ...f.inspection, update }, inputs));
  assert.throws(() => checkDraft(preparationDraftFixture(), f.data.id, inputs, f.inspection, Date.now()), /did not change the teaching/);
  assert.throws(() => checkDraft({ ...f.draft, objective: "A different objective" }, f.data.id, inputs, f.inspection, Date.now()), /original learning objective/);
  assert.throws(() => checkReview({ ...f.review, updateCheck: undefined }, f.draft, inputs), /independent check/);
  assert.throws(() => checkReview({ ...f.review, updateCheck: { ...f.review.updateCheck!, changesSupported: false } }, f.draft, inputs), /independent check/);
  await assert.rejects(validateRefreshContext(f.db, { ...inputs.refresh!, lesson: { ...firstLesson, takeaway: "forged original teaching" } }, false), /retained original teaching/);
});

test("a newer released version stops stale update work and conflicting releases never replace each other", async () => {
  const f = await readyRefreshFixture(), secondId = crypto.randomUUID();
  for (const stage of ["inspect", "draft", "review"] as const) await prepareLessonStage(f.db, "owner", { ...f.data, id: secondId, stage }, f.services);
  const results = await Promise.allSettled([f.data.id, secondId].map(id => releasePreparedLesson(f.db, "owner", id)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 2);
  await assert.rejects(requestLessonRefresh(f.db, "owner", { ...f.request, id: crypto.randomUUID() }), /newer lesson version/);
  const calls = f.packets.length;
  await assert.rejects(prepareLessonStage(f.db, "owner", { ...f.data, id: crypto.randomUUID(), stage: "inspect" }, f.services), /newer lesson version/);
  assert.equal(f.packets.length, calls);
  assert.deepEqual(await requestLessonRefresh(f.db, "owner", f.request), f.item, "Lost request response still recovers its original topic after a newer version is published");
});

test("refresh source freshness and request limits are enforced before any provider call", async () => {
  const f = await refreshPreparationFixture();
  const oldTopic = crypto.randomUUID();
  // Explicit future fixture timestamp makes these copies unambiguously stale.
  f.sql.prepare("INSERT INTO library_items(id,user_id,kind,title,detail,status,created_at,refresh_of,refresh_hash) VALUES(?,'owner','topic','TEST stale refresh','Explicit timestamp fixture','awaiting research',?,?,?)").run(oldTopic, Date.now() + 10000, f.key, await lessonContentHash(firstLesson));
  let calls = 0;
  await assert.rejects(prepareLessonStage(f.db, "owner", { ...f.data, id: crypto.randomUUID(), topicId: oldTopic, stage: "inspect" }, { apiKey: "fixture", fetch: async () => { calls++; throw new Error("No request allowed"); } }), /Retrieve source copies after/);
  assert.equal(calls, 0); assert.equal((await budgetSummary(f.db)).committed, 0);
  await reserveSpend(f.db, "refresh-cap-fixture", "fixture", MONTHLY_LIMIT, "EXPLICIT BUDGET FIXTURE");
  await assert.rejects(prepareLessonStage(f.db, "owner", { ...f.data, stage: "inspect" }, { apiKey: "fixture", fetch: async () => { calls++; throw new Error("No request allowed"); } }), /allowance is used/);
  assert.equal(calls, 0);
});

function narrationBucketFixture() {
  // Explicit in-memory transport/storage fixture, never production narration.
  const objects = new Map<string, { bytes: Uint8Array; customMetadata: Record<string, string> }>();
  let rejectAssembly = false;
  const bucket = {
    async head(key: string) { const saved = objects.get(key); return saved ? { key, size: saved.bytes.length, customMetadata: saved.customMetadata } : null; },
    async get(key: string) { const saved = objects.get(key); return saved ? { key, size: saved.bytes.length, body: new Response(saved.bytes as Uint8Array<ArrayBuffer>).body } : null; },
    async put(key: string, value: Uint8Array | ReadableStream, options?: { customMetadata?: Record<string, string> }) {
      const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(await new Response(value).arrayBuffer());
      if (rejectAssembly && key.endsWith("lesson.wav")) return null;
      objects.set(key, { bytes, customMetadata: options?.customMetadata ?? {} });
      return { key, size: bytes.length, customMetadata: options?.customMetadata ?? {} };
    },
  } as unknown as R2Bucket;
  return { bucket, objects, rejectAssembly(value: boolean) { rejectAssembly = value; }, fixedLengthStream: () => new TransformStream() };
}
async function narrationReplacementFixture() {
  const { db, sql } = database(), storage = narrationBucketFixture(), key = lessonKey(firstLesson);
  sql.prepare("INSERT INTO owner(id,user_id,created_at) VALUES(1,'owner',?)").run(Date.now());
  sql.prepare("INSERT INTO lesson_versions(key,lesson_id,version,course_id,content,status,created_at) VALUES(?,?,?,?,?,'ready',?)").run(key, firstLesson.id, firstLesson.version, firstLesson.courseId, JSON.stringify(firstLesson), Date.now());
  const plan = await narrationPlan(firstLesson);
  async function review(operation: string, decision: "confirmed" | "keep_reserved" = "keep_reserved") {
    const spend = await publicSpend((await db.prepare("SELECT * FROM accounted_spending WHERE id=?").bind(operation).first<AccountedSpend>())!);
    const saved = await recordCostReview(db, "owner", { id: crypto.randomUUID(), spendingId: operation, expectedFingerprint: spend.fingerprint, previousReviewId: spend.reviewId, decision,
      amount: decision === "confirmed" ? 0 : null, confirmedFinalOutcome: decision === "confirmed", evidence: "EXPLICIT REPLACEMENT FIXTURE: no real provider request or invoice exists." });
    return { id: crypto.randomUUID(), spendingId: operation, expectedFingerprint: spend.fingerprint, reviewId: saved.id, confirmedNewCharge: true as const };
  }
  async function failedRoot() { await reserveSpend(db, plan[0].root, "narration", plan[0].reservation, "EXPLICIT REPLACEMENT FIXTURE"); await uncertainSpend(db, plan[0].root); return review(plan[0].root); }
  return { db, sql, key, plan, review, failedRoot, ...storage };
}

test("narration replacement permission is immutable, idempotent and makes no paid request", async () => {
  const f = await narrationReplacementFixture(), input = await f.failedRoot();
  const original = f.sql.prepare("SELECT * FROM spending").all(), budget = await budgetSummary(f.db);
  const allowed = await authorizeNarrationReplacement(f.db, "owner", input, f.bucket);
  assert.deepEqual(await authorizeNarrationReplacement(f.db, "owner", input), allowed, "Lost permission response recovers even without storage");
  assert.deepEqual(f.sql.prepare("SELECT * FROM spending").all(), original); assert.deepEqual(await budgetSummary(f.db), budget);
  assert.equal(allowed.attempt, 1); assert.equal(allowed.max_cost, f.plan[0].reservation); assert.equal(f.objects.size, 0);
  assert.equal(Object.hasOwn(allowed, "snapshot"), false); assert.equal(Object.hasOwn(allowed, "input_sha256"), false);
  assert.throws(() => f.sql.prepare("UPDATE narration_replacements SET max_cost=1 WHERE id=?").run(allowed.id), /cannot be changed/);
  await assert.rejects(authorizeNarrationReplacement(f.db, "owner", { ...input, reviewId: crypto.randomUUID() }, f.bucket), /different details/);
  await assert.rejects(authorizeNarrationReplacement(f.db, "other", input, f.bucket), /Only the owner/);
  await assert.rejects(authorizeNarrationReplacement(f.db, "owner", { ...input, id: crypto.randomUUID() }, f.bucket), /already allowed/);
});

test("missing narration replaces only an explicitly approved segment and preserves every charge", async () => {
  const f = await narrationReplacementFixture(); let calls = 0;
  const failed = { apiKey: "EXPLICIT_FIXTURE_KEY", ...f, fetch: async () => { calls++; throw new Error("Synthetic lost response"); } };
  await assert.rejects(prepareNarration(f.db, firstLesson, failed), /Synthetic lost response/);
  assert.equal(calls, 1);
  await assert.rejects(prepareNarration(f.db, firstLesson, failed), /already started/); assert.equal(calls, 1);
  const original = f.sql.prepare("SELECT * FROM spending WHERE id=?").get(f.plan[0].root);
  const allowed = await authorizeNarrationReplacement(f.db, "owner", await f.review(f.plan[0].root), f.bucket);
  const sent: string[] = [];
  const success = { apiKey: "EXPLICIT_FIXTURE_KEY", ...f, fetch: async (_url: unknown, init?: RequestInit) => {
    calls++; sent.push(JSON.parse(init!.body as string).input); return new Response(new Uint8Array(48), { headers: { "x-request-id": "EXPLICIT_PCM_FIXTURE" } });
  } };
  await prepareNarration(f.db, firstLesson, success);
  assert.deepEqual(sent, f.plan.map(p => p.text)); assert.equal(calls, f.plan.length + 1);
  assert.deepEqual(f.sql.prepare("SELECT * FROM spending WHERE id=?").get(f.plan[0].root), original);
  assert.equal(f.sql.prepare("SELECT status FROM spending WHERE id=?").get(allowed.operation_id)?.status, "complete");
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM media").get()?.n, 1);
  assert.ok(f.objects.has(f.plan[0].key.replace(/\.pcm$/, `-${allowed.id}.pcm`))); assert.equal(f.objects.has(f.plan[0].key), false);
  const wav = f.objects.get(`narration/${f.key}/lesson.wav`)!.bytes;
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF"); assert.equal(wav.length, 44 + f.plan.length * 48);
  assert.equal((await budgetSummary(f.db)).committed, f.plan.reduce((n, p) => n + p.reservation, f.plan[0].reservation));
  const bytes = f.sql.prepare("SELECT SUM(bytes) AS n FROM storage_allocations").get()?.n;
  assert.equal(bytes, 16_000_000 + wav.length + f.plan.length * 48, "Missing original storage remains reserved; replacement and other stored segments count separately");
  await prepareNarration(f.db, firstLesson, { ...f, fetch: async () => { throw new Error("Must not call AI"); } });
  assert.equal(calls, f.plan.length + 1);
});

test("narration assembly can recover saved segments without a key and never records a failed final upload", async () => {
  const f = await narrationReplacementFixture(); let calls = 0; f.rejectAssembly(true);
  await assert.rejects(prepareNarration(f.db, firstLesson, { ...f, onlySaved: true, apiKey: "EXPLICIT_FIXTURE_KEY", fetch: async () => { throw new Error("Free recovery must not send a request even when a key exists"); } }), /still missing/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM storage_allocations").get()?.n, 0);
  await assert.rejects(prepareNarration(f.db, firstLesson, { ...f, apiKey: "EXPLICIT_FIXTURE_KEY", fetch: async () => { calls++; return new Response(new Uint8Array(64)); } }), /assembled narration could not be saved/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM media").get()?.n, 0);
  f.rejectAssembly(false);
  await prepareNarration(f.db, firstLesson, { ...f, fetch: async () => { throw new Error("No new request allowed"); } });
  assert.equal(calls, f.plan.length); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM media").get()?.n, 1);
});

test("replacement attempts are bounded and never bypass current cost checks or atomic spending limits", async () => {
  const f = await narrationReplacementFixture(), input = await f.failedRoot();
  const first = await authorizeNarrationReplacement(f.db, "owner", input, f.bucket);
  await assert.rejects(reserveSpend(f.db, first.operation_id, "narration", first.max_cost, "fixture"), /saved permission/);
  await assert.rejects(reserveSpend(f.db, first.operation_id, "narration", first.max_cost + 1, "fixture", null, first.id), /current cost check/);
  f.sql.prepare("UPDATE spending SET updated_at=updated_at+1 WHERE id=?").run(input.spendingId);
  await assert.rejects(reserveSpend(f.db, first.operation_id, "narration", first.max_cost, "fixture", null, first.id), /current cost check/);
  await f.review(input.spendingId);
  const total = (await budgetSummary(f.db)).committed;
  await reserveSpend(f.db, "explicit-budget-fixture", "fixture", MONTHLY_LIMIT - total - first.max_cost + 1, "EXPLICIT FIXTURE");
  await assert.rejects(reserveSpend(f.db, first.operation_id, "narration", first.max_cost, "fixture", null, first.id), /allowance is used/);
  f.sql.prepare("DELETE FROM spending WHERE id='explicit-budget-fixture'").run();
  await reserveSpend(f.db, first.operation_id, "narration", first.max_cost, "fixture", null, first.id); await uncertainSpend(f.db, first.operation_id);
  await assert.rejects(reserveSpend(f.db, first.operation_id, "narration", first.max_cost, "fixture", null, first.id), /already started/);
  const second = await authorizeNarrationReplacement(f.db, "owner", await f.review(first.operation_id), f.bucket);
  await reserveSpend(f.db, second.operation_id, "narration", second.max_cost, "fixture", null, second.id); await uncertainSpend(f.db, second.operation_id);
  await assert.rejects(authorizeNarrationReplacement(f.db, "owner", await f.review(second.operation_id), f.bucket), /two-replacement limit/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM narration_replacements").get()?.n, 2);
  assert.equal((await budgetSummary(f.db)).committed, f.plan[0].reservation * 3);
});

test("narration replacement rejects saved audio, stale evidence, concurrent permission and active claims", async () => {
  const f = await narrationReplacementFixture(), input = await f.failedRoot();
  await assert.rejects(authorizeNarrationReplacement(f.db, "owner", { ...input, expectedFingerprint: "0".repeat(64) }, f.bucket), /current cost/);
  await assert.rejects(authorizeNarrationReplacement(f.db, "owner", { ...input, confirmedNewCharge: false } as unknown as typeof input, f.bucket));
  await assert.rejects(authorizeNarrationReplacement(f.db, "owner", input), /storage must be available/);
  f.objects.set(f.plan[0].key, { bytes: new Uint8Array(64), customMetadata: {} });
  await assert.rejects(authorizeNarrationReplacement(f.db, "owner", input, f.bucket), /saved segment is available/); f.objects.clear();
  for (const expires of [Date.now() + 10000, Date.now() - 10000]) {
    f.sql.prepare("INSERT INTO generation_lock(id,job_id,created_at,token,expires_at) VALUES(1,'fixture',?,'fixture',?)").run(Date.now(), expires);
    await assert.rejects(authorizeNarrationReplacement(f.db, "owner", input, f.bucket), /Another preparation/);
    f.sql.prepare("DELETE FROM generation_lock").run();
  }
  const outcomes = await Promise.allSettled([input, { ...input, id: crypto.randomUUID() }].map(data => authorizeNarrationReplacement(f.db, "owner", data, f.bucket)));
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  const changed = { ...f.plan[0], fingerprint: "changed" };
  await assert.rejects(narrationAttempts(f.db, changed), /input or price changed/);
});

test("a saved original segment wins over an unused replacement permission without a new charge", async () => {
  const f = await narrationReplacementFixture(), input = await f.failedRoot();
  const allowed = await authorizeNarrationReplacement(f.db, "owner", input, f.bucket);
  // Explicit recovery fixture: a previously missing original write becomes visible.
  for (const part of f.plan) {
    if (part !== f.plan[0]) await reserveSpend(f.db, part.root, "narration", part.reservation, "EXPLICIT FIXTURE");
    f.objects.set(part.key, { bytes: new Uint8Array(64), customMetadata: { operation: part.root, inputSha256: part.fingerprint, reservedMicrodollars: String(part.reservation), providerRequest: "unavailable" } });
  }
  await prepareNarration(f.db, firstLesson, { ...f, fetch: async () => { throw new Error("No paid request"); } });
  assert.equal(f.sql.prepare("SELECT id FROM spending WHERE id=?").get(allowed.operation_id), undefined);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM media").get()?.n, 1);
  assert.equal((await budgetSummary(f.db)).committed, f.plan.reduce((n, p) => n + p.reservation, 0));
});

async function costReviewFixture(status = "uncertain") {
  const { db, sql } = database(), operation = `question:${crypto.randomUUID()}`;
  sql.prepare("INSERT INTO owner(id,user_id,created_at) VALUES(1,'owner',?)").run(Date.now());
  await reserveSpend(db, operation, "EXPLICIT COST FIXTURE", 50_000, "Synthetic request; no actual provider charge.");
  sql.prepare("UPDATE spending SET status=? WHERE id=?").run(status, operation);
  const spend = await publicSpend((await db.prepare("SELECT * FROM accounted_spending WHERE id=?").bind(operation).first<AccountedSpend>())!);
  const input = { id: crypto.randomUUID(), spendingId: operation, expectedFingerprint: spend.fingerprint, previousReviewId: null as string | null,
    decision: "confirmed" as const, amount: 70_000, evidence: "EXPLICIT TEST EVIDENCE: synthetic final-charge reference, not an invoice.", confirmedFinalOutcome: true };
  return { db, sql, operation, input };
}

test("owner cost evidence is immutable and changes budget accounting without rewriting provider results", async () => {
  const { db, sql, operation, input } = await costReviewFixture(), original = sql.prepare("SELECT * FROM spending WHERE id=?").get(operation);
  const review = await recordCostReview(db, "owner", input);
  assert.deepEqual(await recordCostReview(db, "owner", input), review);
  assert.equal((await budgetSummary(db)).committed, 70_000); assert.deepEqual(sql.prepare("SELECT * FROM spending WHERE id=?").get(operation), original);
  assert.throws(() => sql.prepare("UPDATE spend_reviews SET amount=0 WHERE id=?").run(review.id), /cannot be changed/);
  await assert.rejects(recordCostReview(db, "owner", { ...input, amount: 80_000 }), /different details/);
  const correction = await recordCostReview(db, "owner", { ...input, id: crypto.randomUUID(), previousReviewId: review.id, amount: 10_000 });
  assert.equal(correction.revision, 2); assert.equal((await budgetSummary(db)).committed, 10_000, "An explicit current final cost reconciles the amount while preserving the original ledger");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spend_reviews").get()?.n, 2);
  await assert.rejects(reserveSpend(db, operation, "retry", 50_000, "Fixture"), /already started/);
});

test("cost review clears only the exact flagged state and a later change restores the paid-work pause", async () => {
  const { db, sql, operation, input } = await costReviewFixture("cost_review");
  assert.equal((await budgetSummary(db)).paused, true);
  const held = await recordCostReview(db, "owner", { ...input, decision: "keep_reserved", amount: null, confirmedFinalOutcome: false });
  assert.equal((await budgetSummary(db)).paused, true);
  await recordCostReview(db, "owner", { ...input, id: crypto.randomUUID(), previousReviewId: held.id });
  assert.equal((await budgetSummary(db)).paused, false);
  await reserveSpend(db, "after-reviewed-flag", "fixture", 100, "Fixture");
  sql.prepare("UPDATE spending SET charged=90000,updated_at=updated_at+1 WHERE id=?").run(operation);
  assert.equal((await budgetSummary(db)).paused, true); assert.equal((await budgetSummary(db)).committed, 90_100);
  await assert.rejects(reserveSpend(db, "after-changed-flag", "fixture", 100, "Fixture"), /paused/);
  await assert.rejects(recordCostReview(db, "owner", { ...input, id: crypto.randomUUID() }), /changed/);
});

test("reviewed charges participate in the same atomic monthly budget and preserve earlier months", async () => {
  const { db, sql, operation, input } = await costReviewFixture();
  await recordCostReview(db, "owner", { ...input, amount: MONTHLY_LIMIT - 100 });
  const attempts = await Promise.allSettled(["one", "two"].map(id => reserveSpend(db, id, "fixture", 75, "Fixture")));
  assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1); assert.equal((await budgetSummary(db)).committed, MONTHLY_LIMIT - 25);
  sql.prepare("UPDATE spending SET month='2020-01' WHERE id=?").run(operation);
  assert.equal((await budgetSummary(db)).committed, 75);
  assert.equal(sql.prepare("SELECT effective FROM accounted_spending WHERE id=?").get(operation)?.effective, MONTHLY_LIMIT - 100);
});

test("cost checks enforce owner access, explicit final confirmation and serialized corrections", async () => {
  const { db, sql, input } = await costReviewFixture();
  await assert.rejects(recordCostReview(db, "other", input), /Only the owner/);
  for (const invalid of [{ amount: -1 }, { amount: 0.1 }, { amount: null }, { confirmedFinalOutcome: false }, { evidence: "too short" }]) await assert.rejects(recordCostReview(db, "owner", { ...input, ...invalid }));
  const results = await Promise.allSettled([input, { ...input, id: crypto.randomUUID(), amount: 90_000 }].map(data => recordCostReview(db, "owner", data)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spend_reviews").get()?.n, 1);
  await assert.rejects(recordCostReview(db, "owner", { ...input, id: crypto.randomUUID() }), /changed/);
});

test("an active or expired unrecovered job blocks cost editing, and an accounting race cannot save a stale check", async () => {
  const { db, sql, operation, input } = await costReviewFixture();
  for (const expires of [Date.now() + 10000, Date.now() - 10000]) {
    sql.prepare("INSERT INTO generation_lock(id,job_id,created_at,token,expires_at) VALUES(1,'fixture-job',?,'fixture-token',?)").run(Date.now(), expires);
    await assert.rejects(recordCostReview(db, "owner", input), /Another preparation/);
    sql.prepare("DELETE FROM generation_lock WHERE id=1").run();
  }
  let changed = false;
  const racing = { ...db, prepare(query: string) {
    if (query.startsWith("INSERT OR IGNORE INTO spend_reviews") && !changed) { changed = true; sql.prepare("UPDATE spending SET updated_at=updated_at+1 WHERE id=?").run(operation); }
    return db.prepare(query);
  } } as D1Database;
  await assert.rejects(recordCostReview(racing, "owner", input), /changed during/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spend_reviews").get()?.n, 0);
});

test("a settled request remains retry-safe after a cost check, and decimal entry does not round silently", async () => {
  const { db, operation } = await costReviewFixture();
  await settleSpend(db, operation, 25_000, "fixture-provider", "fixture-result");
  const spend = await publicSpend((await db.prepare("SELECT * FROM accounted_spending WHERE id=?").bind(operation).first<AccountedSpend>())!);
  await recordCostReview(db, "owner", { id: crypto.randomUUID(), spendingId: operation, expectedFingerprint: spend.fingerprint, previousReviewId: null, decision: "confirmed", amount: 30_000, confirmedFinalOutcome: true, evidence: "EXPLICIT TEST EVIDENCE for one settled request." });
  await settleSpend(db, operation, 25_000, "fixture-provider", "fixture-result");
  assert.equal((await budgetSummary(db)).committed, 30_000);
  assert.equal(dollarAmount("0.000001"), 1); assert.equal(dollarAmount("0.012345"), 12_345); assert.equal(dollarAmount("100.000000"), 100_000_000);
  for (const invalid of ["1e2", "-1", "0.0000001", "100.000001", "", "1,20", "01.5"]) assert.equal(dollarAmount(invalid), null);
});

test("a confirmed zero charge frees only its budget hold; contradictory later accounting pauses new work", async () => {
  const { db, sql, operation, input } = await costReviewFixture();
  await recordCostReview(db, "owner", { ...input, amount: 0 });
  assert.equal((await budgetSummary(db)).committed, 0);
  assert.equal(sql.prepare("SELECT status FROM spending WHERE id=?").get(operation)?.status, "uncertain");
  await assert.rejects(reserveSpend(db, operation, "same operation", 10, "Fixture"), /already started/);
  await reserveSpend(db, "independent-operation", "fixture", 100, "Fixture");
  await settleSpend(db, operation, 25_000, "late-fixture", "late-result");
  const changed = await budgetSummary(db); assert.equal(changed.committed, 25_100); assert.equal(changed.paused, true);
  await assert.rejects(reserveSpend(db, "after-contradiction", "fixture", 10, "Fixture"), /paused/);
  const spend = await publicSpend((await db.prepare("SELECT * FROM accounted_spending WHERE id=?").bind(operation).first<AccountedSpend>())!);
  assert.equal(spend.reviewCurrent, false);
  await recordCostReview(db, "owner", { ...input, id: crypto.randomUUID(), expectedFingerprint: spend.fingerprint, previousReviewId: spend.reviewId, amount: 30_000 });
  assert.equal((await budgetSummary(db)).paused, false); assert.equal((await budgetSummary(db)).committed, 30_100);
});

function preparationDraftFixture(): LessonDraft {
  return { title: firstLesson.title, objective: firstLesson.objective, takeaway: firstLesson.takeaway, reflection: firstLesson.reflection, challenge: firstLesson.challenge, quiz: structuredClone(firstLesson.quiz),
    sections: firstLesson.sections.map((section, index) => ({ ...structuredClone(section), sources: [index % 2 ? "source-2" : "source-1"] })),
  };
}
const inspectionFixture = (): SourceInspection => ({ sufficient: true, reason: "EXPLICIT PROVIDER FIXTURE: tests persistence, not semantic quality.", sources: (["source-1", "source-2"] as const).map(id => ({ id, usable: true, summary: "Fixture source assessment.", limitations: "Not a real model inspection.", claims: [{ claim: "Fixture claim; not semantic proof.", quote: "A learning product should retain the evidence behind each explanation" }] })) });
function preparationReviewFixture(draft = preparationDraftFixture()): PreparationReview {
  return { decision: "ready", summary: "EXPLICIT PROVIDER FIXTURE: not a real source or expert review.", checks: reviewUnits(draft).map(unit => ({ unit, acceptable: true, sourceIds: ["source-1", "source-2"], reason: "Fixture check result." })),
    quality: { sourceSupport: true, coherent: true, audioFriendly: true, quizCorrect: true, practical: true, attribution: true, healthcareBoundaries: true },
  };
}
async function preparationFixture() {
  const { db, sql } = database(), topicId = crypto.randomUUID(), sourceCaptureIds: string[] = [];
  await db.prepare("INSERT INTO library_items(id,user_id,kind,title,detail,created_at) VALUES(?,'owner','topic','TEST preparation topic','Explicit test fixture',?)").bind(topicId, Date.now()).run();
  for (const url of ["https://pair.withgoogle.com/chapter/user-needs/", "https://www.fda.gov/test-preparation"]) {
    const id = crypto.randomUUID(), itemId = await saveSourceFixture(db, url);
    await captureSavedSource(db, "owner", { id, itemId }, { fetch: (async () => new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } })) as typeof fetch }); sourceCaptureIds.push(id);
  }
  return { db, sql, data: { id: crypto.randomUUID(), topicId, sourceCaptureIds } };
}
function preparationResponse(value: unknown, usage: { input_tokens: number; output_tokens: number } | null = { input_tokens: 100, output_tokens: 100 }) {
  return Response.json({ id: "EXPLICIT_PREPARATION_FIXTURE", status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }, { headers: { "x-request-id": "EXPLICIT_PREPARATION_FIXTURE" } });
}
const preparationValue = (stage: PreparationStage) => stage === "inspect" ? inspectionFixture() : stage === "draft" ? preparationDraftFixture() : preparationReviewFixture();

async function readyPreparationFixture() {
  const fixture = await preparationFixture(); let calls = 0;
  const services = { apiKey: "fixture", fetch: (async (_url, init) => {
    calls++; const stage = JSON.parse(String(init?.body)).text.format.name.replace("lesson_", "") as PreparationStage;
    return preparationResponse(preparationValue(stage));
  }) as typeof fetch };
  for (const stage of ["inspect", "draft", "review"] as const) await prepareLessonStage(fixture.db, "owner", { ...fixture.data, stage }, services);
  return { ...fixture, services, calls: () => calls };
}

test("checked preparations release once with server-bound evidence and no new payment or learning activity", async () => {
  const { db, sql, data, calls } = await readyPreparationFixture(), before = await budgetSummary(db);
  const [first, concurrent] = await Promise.all([releasePreparedLesson(db, "owner", data.id), releasePreparedLesson(db, "owner", data.id)]);
  assert.deepEqual(concurrent, first); assert.deepEqual(await releasePreparedLesson(db, "owner", data.id), first);
  assert.equal(first.lesson_key, `topic-${data.id}:v1`); assert.equal(first.review?.preparationId, data.id); assert.equal(first.review?.method, "automated");
  const row = sql.prepare("SELECT content FROM lesson_versions WHERE key=?").get(first.lesson_key)!;
  const lesson: Lesson = JSON.parse(String(row.content)); assert.equal(lesson.courseId, "standalone");
  assert.equal(first.review?.contentHash, await lessonContentHash(lesson));
  assert.deepEqual(first.review?.sourceChecks.map(s => s.snapshotId), [...data.sourceCaptureIds].sort());
  for (const check of first.review!.sourceChecks) assert.equal(check.materialHash, (await capturedMaterial(db, "owner", check.snapshotId)).hash);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 1);
  for (const table of ["progress", "activity", "notes", "events", "media", "storage_allocations"]) assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
  assert.equal(calls(), 3); assert.deepEqual(await budgetSummary(db), before);
  assert.throws(() => sql.prepare("UPDATE lesson_versions SET release_info='{}' WHERE key=?").run(first.lesson_key), /cannot be changed/);
});

test("release rejects unfinished or failed teaching checks and another owner's preparation", async () => {
  for (const stop of ["inspect", "draft", "revise", "needs_sources"] as const) {
    const { db, sql, data } = await preparationFixture();
    const services = { apiKey: "fixture", fetch: (async (_url, init) => {
      const stage = JSON.parse(String(init?.body)).text.format.name.replace("lesson_", "") as PreparationStage;
      return preparationResponse(stage === "review" ? { ...preparationReviewFixture(), decision: stop } : preparationValue(stage));
    }) as typeof fetch };
    for (const stage of ["inspect", "draft", "review"] as const) {
      await prepareLessonStage(db, "owner", { ...data, stage }, services); if (stage === stop) break;
    }
    await assert.rejects(releasePreparedLesson(db, "owner", data.id), /Finish the source|unresolved review/);
    await assert.rejects(releasePreparedLesson(db, "another-owner", data.id), /not found/);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 0);
  }
});

test("release rechecks owned source copies and refuses a preparation copied to a different owner", async () => {
  const { db, sql, data } = await readyPreparationFixture();
  const copiedId = crypto.randomUUID();
  sql.prepare(`INSERT INTO lesson_preparations(id,user_id,topic_id,inputs,inspection,draft,review,created_at,updated_at)
    SELECT ?,'another-owner',topic_id,inputs,inspection,draft,review,created_at,updated_at FROM lesson_preparations WHERE id=?`).run(copiedId, data.id);
  await assert.rejects(releasePreparedLesson(db, "another-owner", copiedId), /readable source copy is required/);
  sql.prepare("DELETE FROM source_captures WHERE id=?").run(data.sourceCaptureIds[0]);
  await assert.rejects(releasePreparedLesson(db, "owner", data.id), /readable source copy is required/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 0);
});

test("release cannot bypass missing or flagged accounting and recovers a saved review settlement", async () => {
  for (const status of ["missing", "cost_review", "released", "uncertain"] as const) {
    const { db, sql, data, calls } = await readyPreparationFixture(), id = `lesson:${data.id}:review`;
    if (status === "missing") sql.prepare("DELETE FROM spending WHERE id=?").run(id);
    else sql.prepare("UPDATE spending SET status=? WHERE id=?").run(status, id);
    if (status === "uncertain") {
      await releasePreparedLesson(db, "owner", data.id);
      assert.equal(sql.prepare("SELECT status FROM spending WHERE id=?").get(id)?.status, "complete");
    } else {
      await assert.rejects(releasePreparedLesson(db, "owner", data.id), /cost needs/);
      assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 0);
    }
    assert.equal(calls(), 3);
  }
});

test("a lost release response recovers the same saved version, even with new paid work paused", async () => {
  const { db, sql, data, calls } = await readyPreparationFixture(); let interrupted = false;
  const stopped = { ...db, prepare(query: string) {
    if (!interrupted && query.startsWith("SELECT key,content,release_info,created_at FROM lesson_versions WHERE key=") && sql.prepare("SELECT key FROM lesson_versions LIMIT 1").get()) {
      interrupted = true; throw new Error("Fixture worker stop after atomic lesson insert");
    }
    return db.prepare(query);
  } } as D1Database;
  await assert.rejects(releasePreparedLesson(stopped, "owner", data.id), /Fixture worker stop/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 1);
  await reserveSpend(db, "unrelated-cost-fixture", "fixture", 100, "Test fixture");
  sql.prepare("UPDATE spending SET status='cost_review' WHERE id='unrelated-cost-fixture'").run();
  const before = await budgetSummary(db); assert.equal(before.paused, true);
  const release = await releasePreparedLesson(db, "owner", data.id);
  assert.equal(release.lesson_key, `topic-${data.id}:v1`); assert.deepEqual(await budgetSummary(db), before); assert.equal(calls(), 3);
});

test("multiple standalone lessons coexist and their later revisions keep original learning history", async () => {
  const { db, sql, data, services } = await readyPreparationFixture(), first = await releasePreparedLesson(db, "owner", data.id);
  const anotherId = crypto.randomUUID();
  for (const stage of ["inspect", "draft", "review"] as const) await prepareLessonStage(db, "owner", { ...data, id: anotherId, stage }, services);
  await releasePreparedLesson(db, "owner", anotherId);
  await writeProgress(db, "owner", { key: first.lesson_key, position: 50, section: 1, completed: true, observedAt: Date.now() });
  const original: Lesson = JSON.parse(String(sql.prepare("SELECT content FROM lesson_versions WHERE key=?").get(first.lesson_key)?.content));
  const revised = { ...original, version: 2, takeaway: `${original.takeaway} TEST revision.` };
  await releaseFixture(db, revised, first.lesson_key, Date.now());
  assert.deepEqual(await releasePreparedLesson(db, "owner", data.id), first);
  const rows = sql.prepare("SELECT content FROM lesson_versions").all(), progress = sql.prepare("SELECT * FROM progress").all() as Progress[];
  const library = { ...partitionLessonVersions(rows.map(r => JSON.parse(String(r.content)) as Lesson)), progress };
  assert.equal(library.lessons.length, 2); assert.equal(library.archivedLessons.length, 1); assert.equal(completedLessonIds(library).size, 1);
  assert.equal(findLessonVersion(library, first.lesson_key)?.version, 1); assert.equal(hasUnreadUpdate(revised, library), true);
});

test("lesson preparation preserves three bounded paid stages, exact source copies and separate draft visibility", async () => {
  const { db, sql, data } = await preparationFixture(); let calls = 0;
  const services = { apiKey: "fixture", fetch: (async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)), stage = body.text.format.name.replace("lesson_", "") as PreparationStage;
    const packet = JSON.parse(body.input[0].content);
    assert.equal(body.store, false); assert.equal(body.service_tier, "default"); assert.equal(body.tools, undefined);
    assert.equal(body.max_output_tokens, PREPARATION_LIMITS[stage].tokens);
    assert.ok(new TextEncoder().encode(String(init?.body)).length <= PREPARATION_LIMITS[stage].bytes);
    assert.ok(packet.sources.every((s: { text: string }) => s.text.includes("TEST SOURCE FIXTURE")));
    assert.equal(sql.prepare("SELECT status FROM spending WHERE id=?").get(`lesson:${data.id}:${stage}`)?.status, "reserved");
    return preparationResponse(preparationValue(stage));
  }) as typeof fetch };
  for (const stage of ["inspect", "draft", "review"] as const) {
    const saved = await prepareLessonStage(db, "owner", { ...data, stage }, services);
    const repeated = await prepareLessonStage(db, "owner", { ...data, stage, sourceCaptureIds: [...data.sourceCaptureIds].reverse() }, {});
    assert.deepEqual(repeated, saved);
  }
  const result = await getLessonPreparation(db, "owner", data.id);
  assert.equal(calls, 3); assert.equal(nextPreparationStage(result), null); assert.equal(result.review?.value.decision, "ready");
  assert.ok(result.sources.every(s => !Object.hasOwn(s, "context"))); assert.equal(Object.hasOwn(result, "inputs"), false);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 0, "A reviewed draft is not released by this preparation step");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending WHERE status='complete'").get()?.n, 3);
  assert.throws(() => sql.prepare("UPDATE lesson_preparations SET inputs='{}' WHERE id=?").run(data.id), /cannot be changed/);
  assert.throws(() => sql.prepare("UPDATE lesson_preparations SET draft=NULL WHERE id=?").run(data.id), /cannot be changed/);
  await assert.rejects(getLessonPreparation(db, "other", data.id), /not found/);
  await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: "inspect", sourceCaptureIds: [crypto.randomUUID(), data.sourceCaptureIds[0]] }, services), /different topic or source/);
});

test("lesson preparations with insufficient or fabricated source evidence cannot advance to drafting", async () => {
  for (const mode of ["insufficient", "invented_quote", "duplicate_source", "empty_claims"] as const) {
    const { db, sql, data } = await preparationFixture(); let calls = 0;
    const inspection = inspectionFixture();
    if (mode === "insufficient") { inspection.sufficient = false; inspection.sources[0].usable = false; inspection.sources[0].claims = []; }
    if (mode === "invented_quote") inspection.sources[0].claims[0].quote = "This quotation does not exist anywhere in the source packet.";
    if (mode === "duplicate_source") inspection.sources[1].id = "source-1";
    if (mode === "empty_claims") inspection.sources[0].claims = [];
    const services = { apiKey: "fixture", fetch: (async () => { calls++; return preparationResponse(inspection); }) as typeof fetch };
    if (mode === "insufficient") { const p = await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services); assert.equal(nextPreparationStage(p), null); }
    else await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services));
    await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: "draft" }, services), /preceding source or teaching checks/);
    await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services);
    assert.equal(calls, 1); assert.equal(sql.prepare("SELECT draft FROM lesson_preparations WHERE id=?").get(data.id)?.draft, null);
  }
});

test("a short lesson, invalid quiz or contradictory reviewer cannot pass preparation checks", async () => {
  for (const mode of ["short", "quiz", "missing_unit", "contradictory_ready", "revise"] as const) {
    const { db, data } = await preparationFixture(); let calls = 0;
    const draft = preparationDraftFixture(), review = preparationReviewFixture();
    if (mode === "short") draft.sections = draft.sections.map(s => ({ ...s, paragraphs: ["Too short to teach the objective."] }));
    if (mode === "quiz") draft.quiz.answer = 100;
    if (mode === "missing_unit") review.checks.pop();
    if (mode === "contradictory_ready") review.quality.sourceSupport = false;
    if (mode === "revise") { review.decision = "revise"; review.checks[0].acceptable = false; }
    const services = { apiKey: "fixture", fetch: (async (_url, init) => { calls++; const stage = JSON.parse(String(init?.body)).text.format.name; return preparationResponse(stage === "lesson_inspect" ? inspectionFixture() : stage === "lesson_draft" ? draft : review); }) as typeof fetch };
    await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services);
    if (mode === "short" || mode === "quiz") await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: "draft" }, services));
    else {
      await prepareLessonStage(db, "owner", { ...data, stage: "draft" }, services);
      if (mode === "revise") { const p = await prepareLessonStage(db, "owner", { ...data, stage: "review" }, services); assert.equal(p.review?.value.decision, "revise"); }
      else await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: "review" }, services));
    }
    const failingStage = mode === "short" || mode === "quiz" ? "draft" : "review";
    await prepareLessonStage(db, "owner", { ...data, stage: failingStage }, services);
    assert.equal(calls, failingStage === "draft" ? 2 : 3);
  }
});

test("a saved preparation recovers interrupted settlement without sending another paid request", async () => {
  const { db, sql, data } = await preparationFixture(); let failOnce = true, calls = 0;
  const interrupted = { ...db, prepare(query: string) {
    if (query.startsWith("UPDATE spending SET status='complete'") && failOnce) { failOnce = false; throw new Error("Fixture worker failure after saved inspection"); }
    return db.prepare(query);
  } } as D1Database;
  const services = { apiKey: "fixture", fetch: (async () => { calls++; return preparationResponse(inspectionFixture()); }) as typeof fetch };
  await assert.rejects(prepareLessonStage(interrupted, "owner", { ...data, stage: "inspect" }, services));
  assert.equal(sql.prepare("SELECT status FROM spending WHERE id=?").get(`lesson:${data.id}:inspect`)?.status, "uncertain");
  const recovered = await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, {});
  assert.ok(recovered.inspection); assert.equal(calls, 1);
  assert.equal(sql.prepare("SELECT status FROM spending WHERE id=?").get(`lesson:${data.id}:inspect`)?.status, "complete");
});

test("preparation rejects missing setup, foreign sources, duplicate pages and exhausted quotas before payment", async () => {
  for (const mode of ["setup", "foreign", "duplicate", "same_page", "budget", "monthly", "retained"] as const) {
    const { db, sql, data } = await preparationFixture(); let calls = 0;
    const services = { apiKey: mode === "setup" ? undefined : "fixture", fetch: (async () => { calls++; return preparationResponse(inspectionFixture()); }) as typeof fetch };
    if (mode === "foreign" || mode === "same_page") {
      const copy = crypto.randomUUID();
      sql.prepare("INSERT INTO source_captures(id,user_id,library_item_id,requested_url,status,result,material,error,created_at,finished_at) SELECT ?,?,library_item_id,requested_url,status,result,material,error,created_at,finished_at FROM source_captures WHERE id=?").run(copy, mode === "foreign" ? "other" : "owner", data.sourceCaptureIds[0]);
      data.sourceCaptureIds[1] = copy;
    }
    if (mode === "duplicate") data.sourceCaptureIds[1] = data.sourceCaptureIds[0];
    if (mode === "budget") await reserveSpend(db, "full-fixture", "fixture", MONTHLY_LIMIT, "Fixture allowance exhaustion");
    if (mode === "monthly" || mode === "retained") {
      const count = mode === "monthly" ? 30 : 200, created = mode === "monthly" ? Date.now() : 1;
      for (let i = 0; i < count; i++) sql.prepare("INSERT INTO lesson_preparations(id,user_id,topic_id,inputs,created_at,updated_at) VALUES(?,'owner',?,'{}',?,?)").run(crypto.randomUUID(), data.topicId, created, created);
    }
    await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services));
    assert.equal(calls, 0); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending WHERE id LIKE 'lesson:%'").get()?.n, 0);
  }
});

test("concurrent preparation attempts own one paid stage and retain the same saved result", async () => {
  const { db, data } = await preparationFixture(); let calls = 0;
  const started = Promise.withResolvers<void>(), response = Promise.withResolvers<Response>();
  const services = { apiKey: "fixture", fetch: (async () => { calls++; started.resolve(); return response.promise; }) as typeof fetch };
  const first = prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services);
  await started.promise;
  const competing = await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services);
  assert.equal(competing.inspection, null); assert.equal(calls, 1);
  response.resolve(preparationResponse(inspectionFixture()));
  const saved = await first, repeated = await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services);
  assert.deepEqual(saved, repeated); assert.equal(calls, 1);
});

test("uncertain preparation calls are held and unusual usage pauses all paid work", async () => {
  for (const mode of ["lost", "usage", "missing_usage"] as const) {
    const { db, sql, data } = await preparationFixture(); let calls = 0;
    const services = { apiKey: "fixture", fetch: (async () => { calls++; if (mode === "lost") throw new Error("Fixture lost response"); return preparationResponse(inspectionFixture(), mode === "usage" ? { input_tokens: 999_999, output_tokens: 100 } : null); }) as typeof fetch };
    if (mode === "missing_usage") await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services);
    else await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services));
    await prepareLessonStage(db, "owner", { ...data, stage: "inspect" }, services); assert.equal(calls, 1);
    const spending = sql.prepare("SELECT status,charged,reserved FROM spending WHERE id=?").get(`lesson:${data.id}:inspect`)!;
    assert.equal(spending.status, mode === "usage" ? "cost_review" : mode === "lost" ? "uncertain" : "complete");
    if (mode === "missing_usage") assert.equal(spending.charged, spending.reserved);
    if (mode === "usage") await assert.rejects(reserveSpend(db, "other-fixture", "other", 10, "Fixture"), /paused/);
  }
  assert.equal(preparationReservation("inspect", 40_000) + preparationReservation("draft", 52_000) + preparationReservation("review", 62_000), 82_197);
});
test("a deliberate fresh preparation preserves interrupted stages and costs and cannot bypass the budget", async () => {
  for (const interruptedStage of ["inspect", "draft", "review"] as const) {
    const { db, sql, data } = await preparationFixture(); let calls = 0;
    const services = { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: (async (_url, init) => {
      calls++; const stage = JSON.parse(String(init?.body)).text.format.name.replace("lesson_", "") as PreparationStage;
      return preparationResponse(preparationValue(stage));
    }) as typeof fetch };
    try {
      for (const stage of ["inspect", "draft", "review"] as const) {
        if (stage === interruptedStage) break;
        await prepareLessonStage(db, "owner", { ...data, stage }, services);
      }
      await assert.rejects(prepareLessonStage(db, "owner", { ...data, stage: interruptedStage }, {
        apiKey: "EXPLICIT_FIXTURE_KEY", fetch: async () => { calls++; throw new Error("EXPLICIT interrupted preparation fixture"); },
      }));
      const original = await getLessonPreparation(db, "owner", data.id);
      const oldCosts = sql.prepare("SELECT * FROM spending ORDER BY id").all();
      const held = oldCosts.find(row => row.id === `lesson:${data.id}:${interruptedStage}`)!;
      assert.equal(held.status, "uncertain");
      const before = await budgetSummary(db), callsBefore = calls;
      await prepareLessonStage(db, "owner", { ...data, stage: interruptedStage }, services);
      assert.equal(calls, callsBefore, "the interrupted ID is never resent");

      const fresh = { ...data, id: crypto.randomUUID() };
      for (const stage of ["inspect", "draft", "review"] as const) await prepareLessonStage(db, "owner", { ...fresh, stage }, services);
      const ready = await getLessonPreparation(db, "owner", fresh.id);
      assert.equal(ready.review?.value.decision, "ready"); assert.deepEqual(ready.sourceCaptureIds, original.sourceCaptureIds);
      assert.equal(calls, callsBefore + 3);
      assert.deepEqual(await getLessonPreparation(db, "owner", data.id), original);
      for (const row of oldCosts) assert.deepEqual(sql.prepare("SELECT * FROM spending WHERE id=?").get(row.id), row);
      assert.ok((await budgetSummary(db)).committed > before.committed);
      assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_preparations").get()?.n, 2);
      assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 0, "fresh preparation does not publish a lesson");

      const remaining = MONTHLY_LIMIT - (await budgetSummary(db)).committed;
      await reserveSpend(db, "EXPLICIT-full-budget", "fixture", remaining, "EXPLICIT budget fixture");
      await assert.rejects(prepareLessonStage(db, "owner", { ...data, id: crypto.randomUUID(), stage: "inspect" }, services));
      assert.equal(calls, callsBefore + 3, "a fresh ID cannot bypass a full allowance");
      assert.deepEqual(await getLessonPreparation(db, "owner", data.id), original);
      assert.deepEqual(sql.prepare("SELECT * FROM spending WHERE id=?").get(held.id), held);
    } finally { sql.close(); }
  }
});
test("saved-source deep links reopen the library and overview history remains compatible", () => {
  const id = crypto.randomUUID(), hash = `#saved-interest-${id}`;
  assert.equal(overviewView("?view=library", hash), "library");
  assert.equal(overviewView("", hash), "library");
  assert.equal(overviewView("?view=activity", "", { tab: "today" }), "activity");
  assert.equal(overviewView("", "", { tab: "settings" }), "settings");
  assert.equal(overviewView("?view=unknown", "#unrelated", { tab: "unknown" }), "today");
  assert.equal(savedInterestAnchor(hash), `saved-interest-${id}`); assert.equal(savedInterestAnchor("#saved-interest-<script>"), null);
});
test("home continues the current lesson, then the most recently saved unfinished lesson", () => {
  const progress = pilotLessons.map((l, i) => ({ lesson_key: lessonKey(l), position: 80, section: 1, completed: 0, revision: 1, observed_at: i ? 1000 : 2000 }));
  const library = { lessons: pilotLessons, archivedLessons: [], progress, coursePreferences: [{ id: firstLesson.courseId, active: true }] };
  assert.equal(selectHomeLesson(library)?.lesson.id, firstLesson.id);
  const current = selectHomeLesson(library, lessonKey(pilotLessons[1]));
  assert.equal(current?.lesson.id, pilotLessons[1].id); assert.equal(current?.mode, "resume"); assert.equal(current?.progress?.position, 80);
  library.progress[0].observed_at = 500;
  assert.equal(selectHomeLesson(library)?.lesson.id, pilotLessons[1].id);
});
test("home resumes the exact saved revision and standalone lessons without recommending paused courses", () => {
  const revised = { ...firstLesson, version: 2 }, standalone = { ...firstLesson, id: "standalone-fixture", courseId: "standalone" };
  const record = (l: Lesson, observed_at: number) => ({ lesson_key: lessonKey(l), position: 0, section: 2, completed: 0, revision: 1, observed_at });
  const library = { lessons: [revised, standalone], archivedLessons: [firstLesson], progress: [record(firstLesson, 2000), record(standalone, 1000)], coursePreferences: [{ id: firstLesson.courseId, active: true }] };
  assert.equal(selectHomeLesson(library)?.lesson.version, 1);
  library.coursePreferences[0].active = false;
  assert.equal(selectHomeLesson(library)?.lesson.id, standalone.id);
  assert.equal(selectHomeLesson(library, lessonKey(firstLesson))?.lesson.id, firstLesson.id, "an explicitly open lesson can continue even in a paused course");
});
test("home advances within the last course in lesson order before another active path", () => {
  const other = { ...firstLesson, id: "other-course-fixture", courseId: "ai-development" }, later = { ...firstLesson, id: "later-fixture", order: 3 };
  const library = { lessons: [other, later, ...pilotLessons], archivedLessons: [], progress: [{ lesson_key: lessonKey(firstLesson), position: 278, section: 4, completed: 1, revision: 1, observed_at: 1000 }], coursePreferences: [{ id: other.courseId, active: true }, { id: firstLesson.courseId, active: true }] };
  const next = selectHomeLesson(library, lessonKey(firstLesson));
  assert.equal(next?.lesson.id, pilotLessons[1].id); assert.equal(next?.mode, "next");
  library.progress.push({ ...library.progress[0], lesson_key: lessonKey(pilotLessons[1]), observed_at: 2000 });
  assert.equal(selectHomeLesson(library)?.lesson.id, later.id);
});
test("home keeps the last completed lesson available when caught up and ignores unavailable records", () => {
  const progress = pilotLessons.map((l, i) => ({ lesson_key: lessonKey(l), position: 280, section: 4, completed: 1, revision: 1, observed_at: i + 1000 }));
  const library = { lessons: pilotLessons, archivedLessons: [], progress, coursePreferences: [{ id: firstLesson.courseId, active: true }] };
  library.progress.push({ ...progress[0], lesson_key: "missing:v1", completed: 0, observed_at: 9000 });
  const choice = selectHomeLesson(library);
  assert.equal(choice?.lesson.id, pilotLessons[1].id); assert.equal(choice?.mode, "revisit");
  assert.equal(library.progress[0].completed, 1, "choosing a home lesson never resets completion");
});
test("home offers only released lessons from active paths to a new learner", () => {
  const library = { lessons: [...pilotLessons].reverse(), archivedLessons: [], progress: [], coursePreferences: [{ id: "ai-healthcare", active: true }, { id: firstLesson.courseId, active: true }] };
  assert.equal(selectHomeLesson(library)?.lesson.id, firstLesson.id);
  assert.equal(selectHomeLesson(library)?.mode, "next");
  library.coursePreferences[1].active = false;
  assert.equal(selectHomeLesson(library), null);
});
test("opening a lesson updates its recency without erasing reading, audio, or completion", async () => {
  const { db, sql } = database(), now = Date.now(), key = lessonKey(firstLesson);
  try {
    await writeProgress(db, "owner", { key, position: 80, section: 3, completed: true, observedAt: now - 1000 }, now);
    const row = await writeProgress(db, "owner", { key, completed: false, observedAt: now }, now) as Progress;
    assert.equal(row.position, 80); assert.equal(row.section, 3); assert.equal(row.completed, 1); assert.equal(row.observed_at, now);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM events").get()?.n, 1);
  } finally { sql.close(); }
});

test("a delayed library refresh cannot reset progress already acknowledged by the server", () => {
  const newer = { lesson_key: "lesson:v1", position: 90, section: 2, completed: 1, revision: 5, observed_at: 5000 };
  const older = { ...newer, position: 20, section: 0, completed: 0, revision: 4, observed_at: 4000 };
  const another = { ...older, lesson_key: "other:v1" };
  assert.deepEqual(mergeProgress([newer], [older, another]), [newer, another]);
});

function database() {
  const sql = new DatabaseSync(":memory:");
  for (const migration of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) sql.exec(readFileSync(`drizzle/${migration}`, "utf8"));
  const db = { prepare(query: string) {
    const statement = sql.prepare(query);
    let values: (string | number | null)[] = [];
    const result = {
      bind(...args: (string | number | null)[]) { values = args; return result; },
      async first() { return statement.get(...values) ?? null; },
      async run() { const info = statement.run(...values); return { meta: { changes: Number(info.changes) } }; },
      async all() { return { results: statement.all(...values) }; },
    };
    return result;
  }, async batch(statements: D1PreparedStatement[]) {
    sql.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec("COMMIT"); return results; }
    catch (error) { sql.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
  return { db, sql };
}

function voiceFixture(seconds = 2) {
  return encodeVoiceWav([Float32Array.from({ length: seconds * VOICE_SAMPLE_RATE }, (_, i) => Math.sin(i / 15) * 0.2)]);
}
const sourceFixtureText = "TEST SOURCE FIXTURE. A learning product should retain the evidence behind each explanation and distinguish a retrieved page from a checked claim. ".repeat(8);
const sourceFixtureHtml = `<html><head><title>Fixture page</title><meta property="article:published_time" content="2024-04-20T10:00:00Z"></head><body><nav>UNWANTED NAVIGATION</nav><script>UNWANTED SCRIPT</script><main><span class="material-icons">UNWANTED ICON</span><h1>TEST source &amp; evidence</h1><h1>A later section heading</h1><p>${sourceFixtureText}<em>Inline emphasis.</em></p><p hidden>UNWANTED HIDDEN</p><p style="display:none">UNWANTED STYLE</p></main><footer>UNWANTED FOOTER</footer></body></html>`;
async function saveSourceFixture(db: D1Database, url = "https://pair.withgoogle.com/chapter/user-needs/") {
  const itemId = crypto.randomUUID();
  await db.prepare("INSERT INTO library_items(id,user_id,kind,title,url,detail,status,created_at) VALUES(?,'owner','source','TEST source fixture',?,'Explicit test fixture','saved',?)").bind(itemId, url, Date.now()).run();
  return itemId;
}

test("source extraction keeps readable main text and dates while excluding scripts, hidden content and navigation", () => {
  const source = extractSource(sourceFixtureHtml, "text/html", "https://pair.withgoogle.com/chapter/user-needs/");
  assert.equal(source.title, "TEST source & evidence"); assert.equal(source.publisher, "Google PAIR"); assert.equal(source.published, "2024-04-20");
  assert.ok(source.text.includes(sourceFixtureText.trim())); assert.ok(source.text.includes("Inline emphasis.")); assert.ok(!source.text.includes("UNWANTED"));
  assert.equal(source.truncated, false);
  assert.throws(() => extractSource("<title>Just a moment</title><main>Verify you are human</main>", "text/html", "https://www.fda.gov/"));
  const long = extractSource(`<title>TEST long text</title><main>${"A bounded source é😀 ".repeat(10_000)}</main>`, "text/html", "https://www.fda.gov/");
  assert.equal(long.truncated, true); assert.ok(long.bytes <= MAX_SOURCE_BYTES); assert.ok(!long.text.includes("�"));
});

test("source retrieval persists exact material once, keeps provenance and never marks a lesson reviewed", async () => {
  const { db, sql } = database(), itemId = await saveSourceFixture(db), data = { id: crypto.randomUUID(), itemId }; let calls = 0;
  const services = { fetch: (async (_url, init) => {
    calls++; assert.equal(init?.redirect, "manual"); assert.equal(init?.credentials, "omit");
    const headers = new Headers(init?.headers); assert.equal(headers.has("Authorization"), false); assert.equal(headers.has("Cookie"), false);
    return new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }) as typeof fetch };
  const first = await captureSavedSource(db, "owner", data, services), repeat = await captureSavedSource(db, "owner", data, services);
  assert.deepEqual(repeat, first); assert.equal(calls, 1); assert.equal(first.status, "retrieved");
  assert.equal(Object.hasOwn(first, "material"), false);
  const retained = await capturedMaterial(db, "owner", first.id); assert.equal(retained.hash, first.result?.hash); assert.ok(retained.text.includes("TEST SOURCE FIXTURE"));
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 0);
  assert.throws(() => sql.prepare("UPDATE source_captures SET material='changed' WHERE id=?").run(first.id), /cannot be changed/);
  await assert.rejects(getSourceCapture(db, "another-owner", first.id), /not found/);
  await assert.rejects(captureSavedSource(db, "owner", { ...data, itemId: await saveSourceFixture(db) }, services), /different saved source/);
});

test("source requests validate exact publisher hosts and every redirect; failed retries do not fetch again", async () => {
  for (const url of ["http://pair.withgoogle.com/", "https://127.0.0.1/", "https://[::1]/", "https://pair.withgoogle.com.attacker.test/", "https://user:password@pair.withgoogle.com/", "https://pair.withgoogle.com:8443/", "https://metadata.google.internal/", "https://constructor/"]) assert.throws(() => sourceUrl(url));
  const { db } = database(), itemId = await saveSourceFixture(db), data = { id: crypto.randomUUID(), itemId }; let calls = 0;
  const services = { fetch: (async () => { calls++; return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/internal" } }); }) as typeof fetch };
  const failed = await captureSavedSource(db, "owner", data, services);
  assert.equal(failed.status, "unavailable"); assert.equal(failed.result, null); assert.equal(calls, 1);
  assert.deepEqual(await captureSavedSource(db, "owner", data, services), failed); assert.equal(calls, 1);
  await captureSavedSource(db, "owner", { ...data, id: crypto.randomUUID() }, services); assert.equal(calls, 2);
});

test("unsupported and oversized source bodies are cancelled without creating usable material", async () => {
  for (const kind of ["unsupported", "oversized"]) {
    const { db } = database(), itemId = await saveSourceFixture(db); let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    const result = await captureSavedSource(db, "owner", { id: crypto.randomUUID(), itemId }, { fetch: (async () => new Response(stream, { headers: kind === "unsupported" ? { "Content-Type": "application/pdf" } : { "Content-Type": "text/html", "Content-Length": String(MAX_SOURCE_RESPONSE + 1) } })) as typeof fetch });
    assert.equal(result.status, "unavailable"); assert.equal(result.result, null); assert.equal(cancelled, true);
    await assert.rejects(capturedMaterial(db, "owner", result.id), /readable source copy/);
  }
});

test("source retrieval caps retained records and monthly work before an outbound request", async () => {
  for (const [count, createdAt] of [[MAX_SOURCE_COPIES, 0], [MONTHLY_SOURCE_RETRIEVALS, Date.now()]]) {
    const { db, sql } = database(), itemId = await saveSourceFixture(db); let calls = 0;
    const insert = sql.prepare("INSERT INTO source_captures(id,user_id,library_item_id,requested_url,status,created_at) VALUES(?,'owner',?,'https://pair.withgoogle.com/','unavailable',?)");
    for (let i = 0; i < count; i++) insert.run(`capacity-fixture-${i}`, itemId, createdAt);
    await assert.rejects(captureSavedSource(db, "owner", { id: crypto.randomUUID(), itemId }, { fetch: (async () => { calls++; return new Response(sourceFixtureHtml); }) as typeof fetch }), /allowance is full/);
    assert.equal(calls, 0); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM source_captures").get()?.n, count);
  }
});
test("voice duration comes from canonical PCM bytes; alternate headers, oversized audio and silence fail before billing", () => {
  const bytes = voiceFixture(); assert.equal(validateVoiceWav(bytes).durationMs, 2000);
  const changedRate = bytes.slice(); new DataView(changedRate.buffer).setUint32(24, 8000, true); assert.throws(() => validateVoiceWav(changedRate));
  const changedLength = bytes.slice(); new DataView(changedLength.buffer).setUint32(40, 2, true); assert.throws(() => validateVoiceWav(changedLength));
  const extraData = new Uint8Array(bytes.length + 2); extraData.set(bytes); assert.throws(() => validateVoiceWav(extraData));
  assert.throws(() => validateVoiceWav(new Uint8Array(MAX_VOICE_BYTES + 2)));
  assert.throws(() => validateVoiceWav(encodeVoiceWav([new Float32Array(VOICE_SAMPLE_RATE)])));
  assert.equal(encodeVoiceWav([new Float32Array(31 * VOICE_SAMPLE_RATE)]).length, MAX_VOICE_BYTES);
  const stereo = encodeVoiceWav([new Float32Array(VOICE_SAMPLE_RATE).fill(1), new Float32Array(VOICE_SAMPLE_RATE).fill(-0.5)]);
  assert.equal(new DataView(stereo.buffer).getInt16(44, true), 8192);
});
test("denied microphone permission preserves a usable typed fallback", async () => {
  const denied = new DOMException("Permission denied", "NotAllowedError");
  await assert.rejects(requestMicrophone(new AbortController().signal, { getUserMedia: async () => { throw denied; } }), error => error === denied);
  assert.match(microphoneMessage(denied), /keep typing/);
});
test("cancelling an ignored microphone prompt returns immediately and stops a late stream", async () => {
  let grant!: (stream: MediaStream) => void, stopped = 0;
  const controller = new AbortController();
  const pending = requestMicrophone(controller.signal, { getUserMedia: () => new Promise(resolve => { grant = resolve; }) });
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
  grant({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, 1);
});
test("transcription stores text without creating a question or note and recovers without resending audio", async () => {
  const { db, sql } = database(); let calls = 0;
  const data = { id: crypto.randomUUID(), key: "lesson:v1", purpose: "reflection" as const, bytes: voiceFixture() };
  const services = { apiKey: "test-placeholder", fetch: (async (_url, init) => {
    calls++; const form = init?.body as FormData; assert.equal(form.get("model"), "whisper-1"); assert.equal(form.get("response_format"), "verbose_json"); assert.ok(form.get("file") instanceof Blob);
    return new Response(JSON.stringify({ text: "Fixture transcript for an editable reflection.", duration: 2 }), { headers: { "x-request-id": "transcription-fixture" } });
  }) as typeof fetch };
  const first = await transcribeVoice(db, "owner", data, services);
  assert.equal(first.result?.text, "Fixture transcript for an editable reflection.");
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM notes").get()?.count, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM questions").get()?.count, 0);
  sql.prepare("UPDATE spending SET status='uncertain',charged=NULL,result=NULL").run();
  assert.deepEqual(await getVoiceDraft(db, "owner", data.id), first);
  assert.deepEqual(await transcribeVoice(db, "owner", data, {}), first);
  assert.equal(calls, 1); assert.equal((await budgetSummary(db)).committed, TRANSCRIPTION_RESERVATION);
  await assert.rejects(getVoiceDraft(db, "different-owner", data.id));
  await assert.rejects(transcribeVoice(db, "owner", { ...data, purpose: "question" }, services));
  const different = voiceFixture(3); await assert.rejects(transcribeVoice(db, "owner", { ...data, bytes: different }, services));
  assert.equal(calls, 1); sql.close();
});
test("lost transcription responses remain held and duplicate uploads never charge again", async () => {
  const { db, sql } = database(); let calls = 0;
  const data = { id: crypto.randomUUID(), key: "lesson:v1", purpose: "question" as const, bytes: voiceFixture() };
  const services = { apiKey: "test-placeholder", fetch: (async () => { calls++; throw new Error("Lost response fixture"); }) as typeof fetch };
  await assert.rejects(transcribeVoice(db, "owner", data, services));
  await assert.rejects(transcribeVoice(db, "owner", data, services));
  assert.equal(calls, 1); assert.equal((await budgetSummary(db)).committed, TRANSCRIPTION_RESERVATION);
  assert.equal((await getVoiceDraft(db, "owner", data.id)).result, null);
  sql.close();
});
test("missing transcription configuration and malformed audio never reserve spending", async () => {
  const { db, sql } = database(), data = { id: crypto.randomUUID(), key: "lesson:v1", purpose: "question" as const, bytes: voiceFixture() };
  await assert.rejects(transcribeVoice(db, "owner", data, {}));
  await assert.rejects(transcribeVoice(db, "owner", { ...data, bytes: new Uint8Array(40) }, { apiKey: "test-placeholder" }));
  assert.equal((await budgetSummary(db)).committed, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM transcriptions").get()?.count, 0);
  sql.close();
});
test("transcription usage anomalies stop future paid requests instead of undercounting cost", async () => {
  const { db, sql } = database();
  await assert.rejects(transcribeVoice(db, "owner", { id: crypto.randomUUID(), key: "lesson:v1", purpose: "question", bytes: voiceFixture() }, { apiKey: "test-placeholder", fetch: (async () => new Response(JSON.stringify({ text: "Fixture", duration: 180 }))) as typeof fetch }));
  assert.equal((await budgetSummary(db)).paused, true);
  assert.equal((await budgetSummary(db)).committed, 18000);
  await assert.rejects(reserveSpend(db, "later-work", "question", 1000, "fixture"));
  sql.close();
});

test("overlapping activity, retries, and devices count each second once", () => {
  const masks = new Map<number, { low: number; high: number }>();
  for (const [start, end] of [[0, 60_000], [30_000, 90_000], [0, 60_000]]) {
    for (const slot of activityMasks(start, end)) {
      const old = masks.get(slot.minute) ?? { low: 0, high: 0 };
      masks.set(slot.minute, { low: old.low | slot.low, high: old.high | slot.high });
    }
  }
  assert.equal([...masks.values()].reduce((sum, s) => sum + bitCount(s.low) + bitCount(s.high), 0), 90);
  assert.deepEqual(activityMasks(1, 999), []);
  assert.equal(activityMasks(50, 3050).reduce((sum, s) => sum + bitCount(s.low) + bitCount(s.high), 0), 2);
});

test("private audio ranges handle Safari probes, seeks, suffixes, and invalid ranges", () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-1", 100), { offset: 0, end: 1, length: 2 });
  assert.deepEqual(parseRange("bytes=40-", 100), { offset: 40, end: 99, length: 60 });
  assert.deepEqual(parseRange("bytes=-10", 100), { offset: 90, end: 99, length: 10 });
  assert.deepEqual(parseRange("bytes=0-999", 100), { offset: 0, end: 99, length: 100 });
  for (const value of ["bytes=100-", "bytes=-0", "bytes=9-2", "bytes=0-1,4-5", "bytes=-", "garbage"]) assert.throws(() => parseRange(value, 100));
});

test("PCM file header and chunking preserve a complete bounded narration", () => {
  const header = waveHeader(48000), view = new DataView(header.buffer);
  assert.equal(new TextDecoder().decode(header.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(4, true), 48036);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(34, true), 16);
  const script = "A useful lesson about evidence. ".repeat(350).trim();
  const chunks = splitNarration(script);
  assert.ok(chunks.every(s => s.length <= 3800));
  assert.equal(chunks.join(" "), script);
});

test("parallel budget reservations cannot overspend and exhaustion preserves existing records", async () => {
  const { db, sql } = database();
  const outcomes = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => reserveSpend(db, `work-${i}`, "test", 500_000, "test")));
  assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 16);
  assert.equal((await budgetSummary(db)).committed, MONTHLY_LIMIT);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM spending").get()?.count, 16);
  sql.close();
});

test("the same paid operation is reserved only once; uncertain attempts stay charged against allowance", async () => {
  const { db, sql } = database();
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => reserveSpend(db, "narration-v1-part1", "narration", 50_000, "test")));
  assert.equal(attempts.filter(o => o.status === "fulfilled").length, 1);
  await uncertainSpend(db, "narration-v1-part1");
  assert.equal((await budgetSummary(db)).committed, 50_000);
  await assert.rejects(reserveSpend(db, "narration-v1-part1", "narration", 50_000, "test"));
  await settleSpend(db, "narration-v1-part1", 40_000, "provider-test", "saved");
  assert.equal((await budgetSummary(db)).committed, 40_000);
  sql.close();
});

test("reading, listening, delayed updates, and completion reconcile independently", async () => {
  const { db, sql } = database(), now = Date.now();
  const base = { key: "lesson:v1", completed: false };
  await writeProgress(db, "owner", { ...base, position: 80, observedAt: now - 1000 }, now);
  await writeProgress(db, "owner", { ...base, section: 3, observedAt: now - 500 }, now);
  await writeProgress(db, "owner", { ...base, position: 10, observedAt: now - 2000 }, now);
  await writeProgress(db, "owner", { ...base, section: 1, observedAt: now - 3000, completed: true }, now);
  const row = await writeProgress(db, "owner", { ...base, position: 90, observedAt: now }, now) as { position: number; section: number; completed: number };
  assert.equal(row.position, 90); assert.equal(row.section, 3); assert.equal(row.completed, 1);
  await assert.rejects(writeProgress(db, "owner", { ...base, position: 999, observedAt: now + 60_000 }, now));
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM progress").get()?.count, 1);
  sql.close();
});

test("settlement cannot silently exceed a reservation or create negative spending", async () => {
  const { db, sql } = database();
  await reserveSpend(db, "bounded", "test", 50_000, "test");
  await assert.rejects(settleSpend(db, "bounded", 50_001, null, "bad"));
  await assert.rejects(settleSpend(db, "bounded", -1, null, "bad"));
  assert.equal((await budgetSummary(db)).committed, 50_000);
  sql.close();
});

import { withGenerationLock, boundedBytes } from "../lib/jobs";
import { saveNote, saveQuiz } from "../lib/records";
import { courses, firstLesson, seedLessons, lessonKey, narrationText, type Lesson } from "../lib/content";
import { secondLesson } from "../lib/second-lesson";
// Focused workflow fixtures use the original two-lesson pilot; full catalog checks below cover every seed.
const pilotLessons = [firstLesson, secondLesson];

const releaseTime = Date.parse("2026-09-14T12:00:00Z");
async function reviewFixture(lesson: Lesson, db: D1Database, checkedAt = releaseTime): Promise<LessonReviewReceipt> {
  // Source and receipt fixtures exercise binding, not actual source review.
  const sourceChecks: LessonReviewReceipt["sourceChecks"] = [];
  for (const [index, source] of lesson.sources.entries()) {
    const snapshotId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const text = `TEST FIXTURE — this is a synthetic retained source for checking immutable review bindings. ${source.supports}`;
    const metadata = { finalUrl: source.url, title: source.title, publisher: source.publisher, published: source.published, retrievedAt: Date.parse("2026-09-13T12:00:00Z"), contentType: "text/plain", hash: await materialHash({ ...source, text }, source.url), bytes: new TextEncoder().encode(text).length, truncated: false, preview: text.slice(0, 420) };
    await db.prepare("INSERT OR IGNORE INTO source_captures(id,user_id,library_item_id,requested_url,status,result,material,created_at,finished_at) VALUES(?,'owner','review-fixture',?,'retrieved',?,?,?,?)").bind(snapshotId, source.url, JSON.stringify(metadata), text, metadata.retrievedAt, metadata.retrievedAt).run();
    sourceChecks.push({ id: source.id, url: source.url, inspected: source.inspected, materialHash: metadata.hash, snapshotId });
  }
  return { method: "automated", checkedAt, contentHash: await lessonContentHash(lesson), summary: "TEST FIXTURE — no editorial or provider review performed.", sourceChecks };
}
async function releaseFixture(db: D1Database, lesson: Lesson, previousKey: string | null = null, now = releaseTime) {
  return appendReviewedLessonVersion(db, lesson, { userId: "owner", previousKey, summary: "TEST FIXTURE — revised takeaway for version history verification.", review: await reviewFixture(lesson, db, now) }, now);
}

test("a revision preserves old notes, progress, quiz context and media without duplicating course completion", async () => {
  const { db, sql } = database(), original = structuredClone(firstLesson), key = lessonKey(original);
  await releaseFixture(db, original);
  await writeProgress(db, "owner", { key, position: 75, section: 2, completed: true, observedAt: releaseTime }, releaseTime);
  sql.prepare("INSERT INTO notes(id,user_id,lesson_key,kind,text,created_at) VALUES('history-note','owner',?,'reflection','Version one note',?)").run(key, releaseTime);
  sql.prepare("INSERT INTO media(lesson_key,object_key,content_type,bytes,duration,created_at) VALUES(?,'private/v1.wav','audio/wav',100,300,?)").run(key, releaseTime);
  const beforeProgress = sql.prepare("SELECT * FROM progress").all(), beforeNotes = sql.prepare("SELECT * FROM notes").all(), beforeMedia = sql.prepare("SELECT * FROM media").all();
  const revision = { ...original, version: 2, takeaway: `${original.takeaway} Revisit your evidence as the workflow changes.` };
  const released = await releaseFixture(db, revision, key);
  assert.equal(released.previousKey, key);
  const rows = sql.prepare("SELECT key,content,release_info,created_at FROM lesson_versions ORDER BY version DESC").all() as VersionRow[];
  const versions = rows.map(row => JSON.parse(row.content) as Lesson), library = { ...partitionLessonVersions(versions), progress: beforeProgress as Progress[] };
  assert.equal(library.lessons.length, 1); assert.equal(library.lessons[0].version, 2);
  assert.deepEqual(findLessonVersion(library, key), original);
  assert.equal(library.archivedLessons.length, 1); assert.equal(completedLessonIds(library).size, 1);
  assert.equal(hasUnreadUpdate(revision, library), true);
  assert.equal(completedVersions(versions, library.progress)[0].version, 1);
  assert.deepEqual(sql.prepare("SELECT * FROM progress").all(), beforeProgress);
  assert.deepEqual(sql.prepare("SELECT * FROM notes").all(), beforeNotes);
  assert.deepEqual(sql.prepare("SELECT * FROM media").all(), beforeMedia);
  assert.equal(rows.map(releaseFromRow).find(row => row.lesson_key === lessonKey(revision))?.review?.contentHash, await lessonContentHash(revision));
  await writeProgress(db, "owner", { key: lessonKey(revision), completed: true, observedAt: releaseTime }, releaseTime);
  library.progress = sql.prepare("SELECT * FROM progress").all() as Progress[];
  assert.equal(completedLessonIds(library).size, 1); assert.equal(hasUnreadUpdate(revision, library), false);
  assert.equal(completedVersions(versions, library.progress)[0].version, 2);
});

test("concurrent reviewed revisions accept one successor; retries cannot replace published content", async () => {
  const { db, sql } = database(); await releaseFixture(db, firstLesson);
  const next = { ...firstLesson, version: 2 }, other = { ...next, takeaway: `${next.takeaway} A conflicting fixture revision.` };
  const receipts = await Promise.all([reviewFixture(next, db), reviewFixture(other, db)]);
  const results = await Promise.allSettled([next, other].map((candidate, i) => appendReviewedLessonVersion(db, candidate, { userId: "owner", previousKey: lessonKey(firstLesson), summary: "Concurrent fixture release.", review: receipts[i] }, releaseTime)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 2);
  const winner = results.findIndex(r => r.status === "fulfilled"), saved = await appendReviewedLessonVersion(db, [next, other][winner], { userId: "owner", previousKey: lessonKey(firstLesson), summary: "Concurrent fixture release.", review: receipts[winner] }, releaseTime + 1);
  assert.equal(saved.createdAt, releaseTime);
  await assert.rejects(releaseFixture(db, { ...next, version: 3 }, lessonKey(firstLesson)), /newer lesson version/);
  await assert.rejects(releaseFixture(db, { ...next, version: 4 }, lessonKey(next)), /revision sequence/);
  assert.throws(() => sql.prepare("UPDATE lesson_versions SET content='{}' WHERE key=?").run(lessonKey(firstLesson)), /cannot be changed/);
  assert.deepEqual(JSON.parse(String(sql.prepare("SELECT content FROM lesson_versions WHERE key=?").get(lessonKey(firstLesson))?.content)), firstLesson);
});

test("release rejects stale review hashes, mismatched source records and invalid course or quiz data", async () => {
  const { db, sql } = database(), receipt = await reviewFixture(firstLesson, db);
  await assert.rejects(appendReviewedLessonVersion(db, { ...firstLesson, title: "Changed after review" }, { userId: "owner", previousKey: null, summary: "Test", review: receipt }, releaseTime), /exact lesson/);
  const missing = { ...receipt, sourceChecks: receipt.sourceChecks.slice(1) };
  await assert.rejects(appendReviewedLessonVersion(db, firstLesson, { userId: "owner", previousKey: null, summary: "Test", review: missing }, releaseTime), /source record/);
  const wrongUrl = structuredClone(receipt); wrongUrl.sourceChecks[0].url = "https://example.test/not-the-inspected-source";
  await assert.rejects(appendReviewedLessonVersion(db, firstLesson, { userId: "owner", previousKey: null, summary: "Test", review: wrongUrl }, releaseTime), /inspected source/);
  const missingCopy = structuredClone(receipt); missingCopy.sourceChecks[0].snapshotId = crypto.randomUUID();
  await assert.rejects(appendReviewedLessonVersion(db, firstLesson, { userId: "owner", previousKey: null, summary: "Test", review: missingCopy }, releaseTime), /source copy is missing/);
  const wrongCopy = structuredClone(receipt); wrongCopy.sourceChecks[0].materialHash = "b".repeat(64);
  await assert.rejects(appendReviewedLessonVersion(db, firstLesson, { userId: "owner", previousKey: null, summary: "Test", review: wrongCopy }, releaseTime), /retained source material/);
  await assert.rejects(releaseFixture(db, { ...firstLesson, quiz: { ...firstLesson.quiz, answer: 99 } }), /recall question/);
  const unknown = structuredClone(firstLesson); unknown.sections[0].sources = ["invented-source"];
  await assert.rejects(releaseFixture(db, unknown), /unknown source/);
  const future = structuredClone(firstLesson); future.sources[0].inspected = "2026-09-15";
  await assert.rejects(releaseFixture(db, future), /inspected source/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 0);
  await releaseFixture(db, firstLesson);
  await assert.rejects(releaseFixture(db, { ...firstLesson, version: 2, order: 2 }, lessonKey(firstLesson)), /original course and position/);
  await assert.rejects(releaseFixture(db, { ...firstLesson, id: "different-lesson-same-slot" }), /position is already occupied/);
});
test("one generation owns the lock; terminated claims require recovery", async () => {
  const { db, sql } = database();
  let release!: () => void;
  const first = withGenerationLock(db, "first", () => new Promise<void>(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(withGenerationLock(db, "second", async () => {}));
  release(); await first;
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM generation_lock").get()?.count, 0);
  await assert.rejects(withGenerationLock(db, "failed", async () => { throw new Error("service unavailable"); }));
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM generation_lock").get()?.count, 0);
  sql.prepare("INSERT INTO generation_lock(id,job_id,created_at) VALUES(1,'interrupted',0)").run();
  await assert.rejects(withGenerationLock(db, "later", async () => {}));
  sql.close();
});

import { recoverGenerationLock, JOB_DURATION, type GenerationClaim } from "../lib/jobs";
import { reconcileNarrationPart, textFingerprint } from "../lib/narration-records";
import { answerQuestion } from "../lib/questions";
import { sourceContext, SOURCE_CONTEXT_BYTES, checkAnswerEvidence } from "../lib/question-grounding";
import { researchTopic, getTopicResearch, researchReservation, SEARCH_REQUEST_BYTES, SEARCH_OUTPUT_TOKENS, MONTHLY_RESEARCH_RUNS, MAX_RESEARCH_RUNS } from "../lib/topic-research";

const researchUrls = ["https://pair.withgoogle.com/chapter/user-needs/", "https://www.nist.gov/artificial-intelligence"];
async function saveTopicFixture(db: D1Database) {
  const topicId = crypto.randomUUID();
  await db.prepare("INSERT INTO library_items(id,user_id,kind,title,detail,status,created_at) VALUES(?,'owner','topic','TEST research topic','Explicit fixture; no real research requested.','awaiting research',?)").bind(topicId, Date.now()).run();
  return topicId;
}
function searchFixture({ urls = researchUrls, consulted = researchUrls, calls = 1, usage = { input_tokens: 1000, output_tokens: 200 }, status = "completed" }: { urls?: string[]; consulted?: string[]; calls?: number; usage?: { input_tokens: number; output_tokens: number } | null; status?: string } = {}) {
  return new Response(JSON.stringify({ id: "research-response-fixture", status,
    output: [...Array.from({ length: calls }, () => ({ type: "web_search_call", status: "completed", action: { type: "search", sources: consulted.map(url => ({ type: "url", url })) } })), { type: "message", content: [{ type: "output_text", text: JSON.stringify({ candidates: urls.map(url => ({ url, reason: "TEST suggested relevance; not a checked lesson claim." })), gap: "TEST fixture, not actual source discovery." }) }] }], usage,
  }), { headers: { "x-request-id": "research-request-fixture" } });
}

test("topic research accounts one bounded search before retrieving verified candidates and repeats without new calls", async () => {
  const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) }; let searches = 0, pages = 0;
  const services = { apiKey: "test-placeholder", fetch: (async (url, options) => {
    if (url === "https://api.openai.com/v1/responses") {
      searches++; const body = JSON.parse(String(options?.body)), bytes = new TextEncoder().encode(String(options?.body)).length;
      assert.equal(body.max_tool_calls, 1); assert.equal(body.parallel_tool_calls, false); assert.equal(body.max_output_tokens, SEARCH_OUTPUT_TOKENS);
      assert.equal(body.store, false); assert.equal(body.service_tier, "default"); assert.equal(body.tools.length, 1); assert.equal(body.tools[0].type, "web_search");
      assert.ok(body.tools[0].filters.allowed_domains.includes("www.fda.gov")); assert.deepEqual(body.include, ["web_search_call.action.sources"]); assert.ok(bytes <= SEARCH_REQUEST_BYTES);
      assert.equal(sql.prepare("SELECT reserved FROM spending").get()?.reserved, researchReservation(bytes).amount);
      return searchFixture();
    }
    pages++; assert.ok(researchUrls.includes(String(url))); assert.equal(new Headers(options?.headers).has("Authorization"), false);
    assert.ok(sql.prepare("SELECT search FROM topic_research").get()?.search); assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "complete");
    return new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } });
  }) as typeof fetch };
  const first = await researchTopic(db, "owner", data, services);
  assert.equal(first.search!.candidates.length, 2); assert.deepEqual(first.search!.consultedUrls, researchUrls);
  assert.equal(first.search!.cost, 13920); assert.equal((await budgetSummary(db)).committed, 13920);
  for (const candidate of first.search!.candidates) { const copy = await capturedMaterial(db, "owner", candidate.captureId); assert.ok(copy.text.includes("TEST SOURCE FIXTURE")); }
  assert.deepEqual(await researchTopic(db, "owner", data, { fetch: services.fetch }), first);
  assert.equal(searches, 1); assert.equal(pages, 2); assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM lesson_versions").get()?.count, 0);
  assert.throws(() => sql.prepare("UPDATE topic_research SET search='{}' WHERE id=?").run(data.id), /cannot be changed/);
  await assert.rejects(getTopicResearch(db, "foreign", data.id), /not found/);
  const otherTopic = await saveTopicFixture(db);
  await assert.rejects(researchTopic(db, "owner", { ...data, topicId: otherTopic }, services), /different topic/);
  assert.equal(searches, 1); sql.close();
});

test("unverified, repeated and absent search evidence never creates source material or retries the paid search", async () => {
  for (const result of [{ urls: ["https://www.nist.gov/invented-page"] }, { urls: [researchUrls[0], researchUrls[0]] }, { calls: 0 }, { status: "incomplete" }, { urls: ["https://unconnected.example/"], consulted: ["https://unconnected.example/"] }]) {
    const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) }; let calls = 0;
    const services = { apiKey: "test-placeholder", fetch: (async url => { calls++; assert.equal(url, "https://api.openai.com/v1/responses"); return searchFixture(result); }) as typeof fetch };
    await assert.rejects(researchTopic(db, "owner", data, services));
    const saved = await researchTopic(db, "owner", data, services); assert.equal(saved.search, null); assert.ok(saved.error);
    assert.equal(calls, 1); assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "uncertain");
    assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM source_captures").get()?.count, 0); assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM library_items WHERE kind='source'").get()?.count, 0);
    sql.close();
  }
});

test("deliberately starting fresh research keeps the old hold and history within the shared allowance", async () => {
  const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) }; let calls = 0;
  try {
    await assert.rejects(researchTopic(db, "owner", data, {
      apiKey: "EXPLICIT_FIXTURE_KEY", fetch: async () => { calls++; throw new Error("EXPLICIT interrupted search fixture"); },
    }));
    const original = await getTopicResearch(db, "owner", data.id), held = sql.prepare("SELECT * FROM spending WHERE id=?").get(`research:${data.id}`)!;
    assert.equal(held.status, "uncertain");
    const services = { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: async () => { calls++; return searchFixture({ urls: [] }); } };
    assert.deepEqual(await researchTopic(db, "owner", data, services), original); assert.equal(calls, 1);
    const fresh = await researchTopic(db, "owner", { ...data, id: crypto.randomUUID() }, services);
    assert.ok(fresh.search); assert.equal(calls, 2);
    assert.deepEqual(await getTopicResearch(db, "owner", data.id), original);
    assert.deepEqual(sql.prepare("SELECT * FROM spending WHERE id=?").get(held.id), held);
    assert.equal((await budgetSummary(db)).committed, Number(held.reserved) + fresh.search.cost);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM topic_research").get()?.n, 2);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM source_captures").get()?.n, 0);

    await reserveSpend(db, "EXPLICIT-full-budget", "fixture", MONTHLY_LIMIT - (await budgetSummary(db)).committed, "EXPLICIT budget fixture");
    await assert.rejects(researchTopic(db, "owner", { ...data, id: crypto.randomUUID() }, services));
    assert.equal(calls, 2);
    assert.deepEqual(sql.prepare("SELECT * FROM spending WHERE id=?").get(held.id), held);
    assert.deepEqual(await getTopicResearch(db, "owner", data.id), original);
  } finally { sql.close(); }
});

test("research resumes retrieval after a saved search without requiring an API key or another paid request", async () => {
  const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) }; let searches = 0, pages = 0, interrupt = true;
  const faultDb = { ...db, prepare(query: string) { if (interrupt && query.startsWith("INSERT OR IGNORE INTO library_items")) { interrupt = false; throw new Error("Simulated worker stop before retrieval"); } return db.prepare(query); } } as D1Database;
  const services = { apiKey: "test-placeholder", fetch: (async url => { if (url === "https://api.openai.com/v1/responses") { searches++; return searchFixture(); } pages++; return new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } }); }) as typeof fetch };
  await assert.rejects(researchTopic(faultDb, "owner", data, services), /Simulated worker stop/);
  assert.ok((await getTopicResearch(db, "owner", data.id)).search); assert.equal(pages, 0);
  sql.prepare("UPDATE spending SET status='uncertain',charged=NULL,result=NULL").run();
  const resumed = await researchTopic(db, "owner", data, { fetch: services.fetch });
  assert.equal(resumed.search!.candidates.length, 2); assert.equal(searches, 1); assert.equal(pages, 2);
  assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "complete"); sql.close();
});

test("an unreadable research page remains unavailable while other material and the paid search are preserved", async () => {
  const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) }; let calls = 0;
  const services = { apiKey: "test-placeholder", fetch: (async url => { calls++; return url === "https://api.openai.com/v1/responses" ? searchFixture() : url === researchUrls[0] ? new Response("Publisher unavailable", { status: 403 }) : new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } }); }) as typeof fetch };
  const run = await researchTopic(db, "owner", data, services);
  const bad = await getSourceCapture(db, "owner", run.search!.candidates[0].captureId), good = await getSourceCapture(db, "owner", run.search!.candidates[1].captureId);
  assert.equal(bad.status, "unavailable"); assert.equal(bad.result, null); assert.equal(good.status, "retrieved");
  await researchTopic(db, "owner", data, services); assert.equal(calls, 3); assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM lesson_versions").get()?.count, 0); sql.close();
});

test("research limits and absent setup prevent paid calls before searching", async () => {
  for (const boundary of ["key", "budget", "source", "monthly", "retained"] as const) {
    const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) }; let calls = 0;
    if (boundary === "budget") await reserveSpend(db, "budget-fixture", "fixture", MONTHLY_LIMIT, "Test full allowance");
    if (boundary === "source") for (let i = 0; i < MONTHLY_SOURCE_RETRIEVALS - 1; i++) sql.prepare("INSERT INTO source_captures(id,user_id,library_item_id,requested_url,status,created_at) VALUES(?,'owner','fixture','https://www.nist.gov/','retrieving',?)").run(String(i), Date.now());
    if (boundary === "monthly" || boundary === "retained") for (let i = 0; i < (boundary === "monthly" ? MONTHLY_RESEARCH_RUNS : MAX_RESEARCH_RUNS); i++) sql.prepare("INSERT INTO topic_research(id,user_id,topic_id,title,detail,created_at) VALUES(?,'owner','fixture','TEST topic','',?)").run(String(i), boundary === "monthly" ? Date.now() : 1);
    await assert.rejects(researchTopic(db, "owner", data, { apiKey: boundary === "key" ? undefined : "test-placeholder", fetch: (async () => { calls++; return searchFixture(); }) as typeof fetch }));
    assert.equal(calls, 0); assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM spending WHERE kind='topic research'").get()?.count, 0); sql.close();
  }
});

test("search call or token anomalies pause paid work and missing usage keeps the full reservation", async () => {
  for (const result of [{ calls: 2 }, { usage: { input_tokens: 1_000_000, output_tokens: 100 } }]) {
    const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) };
    await assert.rejects(researchTopic(db, "owner", data, { apiKey: "test-placeholder", fetch: (async () => searchFixture(result)) as typeof fetch }), /paused for review/);
    assert.equal((await budgetSummary(db)).paused, true); assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "cost_review");
    await assert.rejects(reserveSpend(db, "later-work", "fixture", 100, "Test pause")); sql.close();
  }
  const { db, sql } = database(), data = { id: crypto.randomUUID(), topicId: await saveTopicFixture(db) };
  const result = await researchTopic(db, "owner", data, { apiKey: "test-placeholder", fetch: (async () => searchFixture({ urls: [], usage: null })) as typeof fetch });
  assert.equal(result.search!.cost, sql.prepare("SELECT reserved FROM spending").get()?.reserved); assert.match(result.search!.costBasis, /unavailable/); sql.close();
});

test("expired recovery retains costs and fences a late worker without deleting a newer claim", async () => {
  const { db, sql } = database(); let now = 1000, releaseOld!: () => void, releaseNew!: () => void, oldClaim!: GenerationClaim;
  const old = withGenerationLock(db, "same-job", async claim => { oldClaim = claim; await new Promise<void>(resolve => { releaseOld = resolve; }); await claim.assertActive(); }, () => now);
  await new Promise(resolve => setImmediate(resolve));
  await reserveSpend(db, "unique-paid-operation", "test", 50000, "fixture", oldClaim.token);
  await assert.rejects(recoverGenerationLock(db, oldClaim.token, now));
  now += JOB_DURATION + 1;
  await assert.rejects(recoverGenerationLock(db, "wrong-token", now));
  await recoverGenerationLock(db, oldClaim.token, now);
  assert.equal((await budgetSummary(db)).committed, 50000);
  assert.equal(sql.prepare("SELECT status FROM spending WHERE id='unique-paid-operation'").get()?.status, "uncertain");
  const newer = withGenerationLock(db, "same-job", async () => { await new Promise<void>(resolve => { releaseNew = resolve; }); }, () => now);
  await new Promise(resolve => setImmediate(resolve));
  releaseOld(); await assert.rejects(old);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM generation_lock").get()?.count, 1);
  await assert.rejects(reserveSpend(db, "unique-paid-operation", "test", 50000, "fixture"));
  releaseNew(); await newer; sql.close();
});

test("saved narration reconciles an interrupted settlement only for its exact script and operation", async () => {
  const { db, sql } = database(), fingerprint = await textFingerprint("A source-supported lesson.");
  await reserveSpend(db, "segment-1", "narration", 50000, "fixture");
  await uncertainSpend(db, "segment-1");
  const saved = { key: "private/segment.pcm", size: 48000, customMetadata: { operation: "segment-1", inputSha256: fingerprint, reservedMicrodollars: "50000", providerRequest: "fixture-request" } };
  await assert.rejects(reconcileNarrationPart(db, saved, "segment-1", "changed-script", 50000));
  assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "uncertain");
  await reconcileNarrationPart(db, saved, "segment-1", fingerprint, 50000);
  await reconcileNarrationPart(db, saved, "segment-1", fingerprint, 50000);
  assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "complete");
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM spending").get()?.count, 1);
  await assert.rejects(settleSpend(db, "segment-1", 40000, "fixture-request", "changed"));
  sql.close();
});

function answerFixture(sourceIds = [firstLesson.sources[0].id], usage = { input_tokens: 1000, output_tokens: 100 }, evidence: { sourceId: string; quote: string }[] = []) {
  return new Response(JSON.stringify({ id: "response-fixture", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ text: "Local test answer about the lesson's stated capabilities.", sourceIds, needsResearch: false, evidence }) }] }], usage }), { headers: { "x-request-id": "request-fixture" } });
}

test("questions use retained source text, preserve its evidence and never change a repeated request's source copy", async () => {
  const { db, sql } = database(), itemId = await saveSourceFixture(db), snapshotId = crypto.randomUUID(), sourceId = `snapshot:${snapshotId}`;
  const capture = await captureSavedSource(db, "owner", { id: snapshotId, itemId }, { fetch: (async () => new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } })) as typeof fetch });
  const quote = "Inline emphasis.", input = { id: crypto.randomUUID(), question: "What does this source say?", sourceCaptureIds: [snapshotId] }; let calls = 0;
  const service = { apiKey: "test-placeholder", fetch: (async (_url, options) => {
    calls++; const body = JSON.parse(String(options?.body)), packet = JSON.parse(body.input[0].content);
    assert.equal(body.tools, undefined); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 800);
    assert.match(body.instructions, /untrusted data/);
    assert.equal(packet.retrievedSources[0].sourceId, sourceId); assert.ok(packet.retrievedSources[0].text.includes(quote));
    assert.equal(packet.retrievedSources[0].hash, capture.result!.hash);
    const expected = Math.ceil((new TextEncoder().encode(String(options?.body)).length + 4096) * 0.4 + 800 * 1.6);
    assert.equal(sql.prepare("SELECT reserved FROM spending").get()?.reserved, expected);
    return answerFixture([sourceId], undefined, [{ sourceId, quote }]);
  }) as typeof fetch };
  const answered = await answerQuestion(db, "owner", firstLesson, input, service);
  assert.deepEqual(answered.sourceCaptureIds, [snapshotId]); assert.deepEqual(answered.answer!.evidence, [{ sourceId, quote }]);
  assert.equal(answered.answer!.sourceCopies![0].retrievedAt, capture.result!.retrievedAt);
  assert.equal(Object.hasOwn(answered.answer!.sourceCopies![0], "text"), false);
  const newerId = crypto.randomUUID();
  await captureSavedSource(db, "owner", { id: newerId, itemId }, { fetch: (async () => new Response(sourceFixtureHtml.replace("Inline emphasis.", "Newer retained copy."), { headers: { "Content-Type": "text/html" } })) as typeof fetch });
  sql.prepare("UPDATE spending SET status='uncertain',charged=NULL,result=NULL").run();
  assert.deepEqual(await answerQuestion(db, "owner", firstLesson, input, {}), answered);
  assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "complete");
  await assert.rejects(answerQuestion(db, "owner", firstLesson, { ...input, sourceCaptureIds: [newerId] }, service), /different text or sources/);
  await assert.rejects(answerQuestion(db, "owner", firstLesson, { ...input, sourceCaptureIds: [] }, service), /different text or sources/);
  assert.equal(calls, 1); sql.close();
});

test("unavailable, foreign, duplicate and excessive question sources fail before a paid request", async () => {
  const { db, sql } = database(), itemId = await saveSourceFixture(db), id = crypto.randomUUID(); let calls = 0;
  await captureSavedSource(db, "owner", { id, itemId }, { fetch: (async () => new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } })) as typeof fetch });
  const service = { apiKey: "test-placeholder", fetch: (async () => { calls++; return answerFixture(); }) as typeof fetch };
  for (const [user, ids] of [["foreign", [id]], ["owner", [crypto.randomUUID()]], ["owner", [id, id]], ["owner", [id, crypto.randomUUID(), crypto.randomUUID()]]] as [string, string[]][]) {
    await assert.rejects(answerQuestion(db, user, firstLesson, { id: crypto.randomUUID(), question: "Test source boundary", sourceCaptureIds: ids }, service));
  }
  assert.equal(calls, 0); assert.equal((await budgetSummary(db)).committed, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM questions").get()?.count, 0); sql.close();
});

test("a fabricated or missing retrieved-source excerpt withholds the answer and holds cost without retry", async () => {
  for (const quotes of [[], ["This quotation never appeared in the source."]]) {
    const { db, sql } = database(), itemId = await saveSourceFixture(db), snapshotId = crypto.randomUUID(), sourceId = `snapshot:${snapshotId}`; let calls = 0;
    await captureSavedSource(db, "owner", { id: snapshotId, itemId }, { fetch: (async () => new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } })) as typeof fetch });
    const data = { id: crypto.randomUUID(), question: "Test unsupported quotation", sourceCaptureIds: [snapshotId] };
    const service = { apiKey: "test-placeholder", fetch: (async () => { calls++; return answerFixture([sourceId], undefined, quotes.map(quote => ({ sourceId, quote }))); }) as typeof fetch };
    await assert.rejects(answerQuestion(db, "owner", firstLesson, data, service), /excerpt/);
    await assert.rejects(answerQuestion(db, "owner", firstLesson, data, service));
    assert.equal(calls, 1); assert.equal(sql.prepare("SELECT answer FROM questions").get()?.answer, null);
    assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "uncertain"); sql.close();
  }
});

test("source context limits preserve unicode and evidence cannot quote text outside the supplied excerpt", () => {
  const content = "Visible source paragraph é😀 ".repeat(1500) + "A final claim that is outside the excerpt.";
  const context = sourceContext(content), sourceId = "snapshot:test", contexts = [{ sourceId, text: context.text }];
  assert.ok(context.partial); assert.ok(context.bytes <= SOURCE_CONTEXT_BYTES); assert.ok(!context.text.includes("�"));
  checkAnswerEvidence([sourceId], [{ sourceId, quote: "Visible source paragraph é😀" }], contexts);
  assert.throws(() => checkAnswerEvidence([sourceId], [{ sourceId, quote: "A final claim that is outside the excerpt." }], contexts), /could not be verified/);
  assert.throws(() => checkAnswerEvidence([], [{ sourceId, quote: "Visible source paragraph é😀" }], contexts), /could not be verified/);
  assert.throws(() => checkAnswerEvidence([sourceId], [{ sourceId, quote: "Visible source paragraph é😀 ".repeat(6) }], contexts), /could not be verified/);
  assert.throws(() => checkAnswerEvidence([sourceId], [{ sourceId, quote: "Visible source paragraph é😀" }, { sourceId, quote: "Visible source paragraph é😀" }], contexts), /repeated/);
});

test("two long retrieved pages stay within the reserved question context and source order is retry-stable", async () => {
  const { db, sql } = database(), ids: string[] = []; let calls = 0;
  const quote = "A bounded retrieved source é😀", html = `<title>TEST bounded page</title><main>${`${quote} `.repeat(4000)}</main>`;
  for (const url of ["https://pair.withgoogle.com/chapter/user-needs/", "https://www.nist.gov/artificial-intelligence"]) {
    const itemId = await saveSourceFixture(db, url), id = crypto.randomUUID(); ids.push(id);
    await captureSavedSource(db, "owner", { id, itemId }, { fetch: (async () => new Response(html, { headers: { "Content-Type": "text/html" } })) as typeof fetch });
  }
  const data = { id: crypto.randomUUID(), question: "Compare these two test pages.", sourceCaptureIds: ids };
  const answered = await answerQuestion(db, "owner", firstLesson, data, { apiKey: "test-placeholder", fetch: (async (_url, options) => {
    calls++; const body = JSON.parse(String(options?.body)), packet = JSON.parse(body.input[0].content);
    assert.ok(new TextEncoder().encode(String(options?.body)).length <= 52_000);
    assert.equal(packet.retrievedSources.length, 2);
    for (const source of packet.retrievedSources) { assert.ok(source.partialContext); assert.ok(new TextEncoder().encode(source.text).length <= SOURCE_CONTEXT_BYTES); }
    const sourceIds = packet.retrievedSources.map((s: { sourceId: string }) => s.sourceId);
    assert.ok(Number(sql.prepare("SELECT reserved FROM spending").get()?.reserved) <= 23719);
    return answerFixture(sourceIds, undefined, sourceIds.map((sourceId: string) => ({ sourceId, quote })));
  }) as typeof fetch });
  assert.equal(answered.answer!.sourceCopies!.length, 2);
  assert.deepEqual(await answerQuestion(db, "owner", firstLesson, { ...data, sourceCaptureIds: [...ids].reverse() }, {}), answered);
  assert.equal(calls, 1); sql.close();
});

test("question retries recover a saved answer and accounting without another provider call", async () => {
  const { db, sql } = database(); let calls = 0;
  const input = { id: crypto.randomUUID(), question: "What can models do?" };
  const service = { apiKey: "test-placeholder", fetch: (async (_url, options) => { calls++; const body = JSON.parse(String(options?.body)); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 800); assert.equal(body.tools, undefined); return answerFixture(); }) as typeof fetch };
  const first = await answerQuestion(db, "owner", firstLesson, input, service);
  assert.ok(first.answer); assert.equal(first.answer.cost, 560);
  sql.prepare("UPDATE spending SET status='uncertain',charged=NULL,result=NULL").run();
  const repeated = await answerQuestion(db, "owner", firstLesson, input, {});
  assert.deepEqual(repeated, first); assert.equal(calls, 1);
  assert.equal((await budgetSummary(db)).committed, 560);
  assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "complete");
  await assert.rejects(answerQuestion(db, "owner", firstLesson, { ...input, question: "Different text" }, service));
  await assert.rejects(answerQuestion(db, "someone-else", firstLesson, input, service));
  assert.equal(calls, 1); sql.close();
});

test("ambiguous question failures retain the question and spending; identical retry never calls the provider", async () => {
  const { db, sql } = database(); let calls = 0;
  const input = { id: crypto.randomUUID(), question: "Explain the lesson." };
  const service = { apiKey: "test-placeholder", fetch: (async () => { calls++; throw new Error("Simulated lost response"); }) as typeof fetch };
  await assert.rejects(answerQuestion(db, "owner", firstLesson, input, service));
  const committed = (await budgetSummary(db)).committed;
  assert.ok(committed > 560);
  await assert.rejects(answerQuestion(db, "owner", firstLesson, input, service));
  assert.equal(calls, 1); assert.equal((await budgetSummary(db)).committed, committed);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM questions WHERE answer IS NULL").get()?.count, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM generation_lock").get()?.count, 0);
  sql.close();
});

test("missing AI and invalid citations never produce a simulated answer", async () => {
  const { db, sql } = database(), input = { id: crypto.randomUUID(), question: "Explain the lesson." };
  await assert.rejects(answerQuestion(db, "owner", firstLesson, input, {}));
  assert.equal((await budgetSummary(db)).committed, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM questions").get()?.count, 0);
  await assert.rejects(answerQuestion(db, "owner", firstLesson, input, { apiKey: "test-placeholder", fetch: (async () => answerFixture(["invented-source"])) as typeof fetch }));
  assert.equal(sql.prepare("SELECT answer FROM questions").get()?.answer, null);
  assert.equal(sql.prepare("SELECT status FROM spending").get()?.status, "uncertain");
  sql.close();
});

test("usage beyond configured limits pauses every new paid feature until reviewed", async () => {
  const { db, sql } = database();
  await assert.rejects(answerQuestion(db, "owner", firstLesson, { id: crypto.randomUUID(), question: "Explain the lesson." }, { apiKey: "test-placeholder", fetch: (async () => answerFixture(undefined, { input_tokens: 100000, output_tokens: 900 })) as typeof fetch }));
  assert.equal((await budgetSummary(db)).paused, true);
  assert.ok((await budgetSummary(db)).committed >= 41440);
  await assert.rejects(reserveSpend(db, "new-narration", "narration", 50000, "fixture"));
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM spending").get()?.count, 1);
  sql.close();
});
test("unknown-length provider responses stop at the byte boundary", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(8)); }, cancel() { cancelled = true; } }));
  await assert.rejects(boundedBytes(response, 10));
  assert.equal(cancelled, true);
  assert.deepEqual(await boundedBytes(new Response(new Uint8Array([1, 2])), 10), new Uint8Array([1, 2]));
});
test("retrying notes and quizzes does not duplicate history or silently replace an answer", async () => {
  const { db, sql } = database(), key = lessonKey(firstLesson);
  const note = { id: "note-1", key, kind: "reflection", text: "Evidence matters." };
  await Promise.all([saveNote(db, "owner", note), saveNote(db, "owner", note)]);
  await assert.rejects(saveNote(db, "owner", { ...note, text: "Different note." }));
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM notes").get()?.count, 1);
  const attempt = { id: "attempt-1", key, answer: 1 };
  await Promise.all([saveQuiz(db, "owner", firstLesson, attempt), saveQuiz(db, "owner", firstLesson, attempt)]);
  await assert.rejects(saveQuiz(db, "owner", firstLesson, { ...attempt, answer: 0 }));
  assert.equal(sql.prepare("SELECT COUNT(*) AS count FROM events").get()?.count, 1);
  sql.close();
});
test("all three foundation courses have eight distinct ready lessons in the planned order", () => {
  assert.equal(seedLessons.length, 24);
  for (const course of courses) {
  const lessons = seedLessons.filter(l => l.courseId === course.id);
  assert.deepEqual(lessons.map(l => l.order), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(lessons.map(l => l.title), course.lessons);
  assert.equal(new Set(lessons.map(l => l.id)).size, 8);
  assert.equal(new Set(lessons.map(l => l.objective)).size, 8);
  assert.equal(new Set(lessons.map(l => l.quiz.question)).size, 8);
  }
});
test("plan deliveries save one owner-bound weekly set without changing learning or spending", async () => {
  const { db, sql } = supplementFixture(), now = releaseTime;
  const publication: PlanPublication = { ownerId: "owner", week: learningWeek(now), preparedAt: now, summary: "EXPLICIT TEST FIXTURE: no lesson due.", checks: [], batch: { week: learningWeek(now), origin: "scheduled", items: [], created_at: now } };
  const tables = ["progress", "events", "notes", "media", "spending", "lesson_versions"], before = tables.map(t => sql.prepare(`SELECT * FROM ${t}`).all());
  await assert.rejects(deliverPlanPublication(db, "other", publication, now), /different owner/);
  const deliveries = await Promise.all(Array.from({ length: 4 }, () => deliverPlanPublication(db, "owner", publication, now)));
  for (const delivery of deliveries) assert.deepEqual(delivery, deliveries[0]);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM plan_deliveries").get()?.n, 1);
  assert.equal(sql.prepare("SELECT origin FROM weekly_batches").get()?.origin, "scheduled");
  await assert.rejects(deliverPlanPublication(db, "owner", { ...publication, summary: "changed" }, now), /different content/);
  assert.deepEqual(await deliverPlanPublications(db, "owner", [], now), [deliveries[0]], "Pruning confirmed build artifacts keeps database history");
  for (const [i, t] of tables.entries()) assert.deepEqual(sql.prepare(`SELECT * FROM ${t}`).all(), before[i], t);
  const future = { ...publication, week: learningWeek(now + 7 * 86400000), preparedAt: now + 7 * 86400000, batch: { ...publication.batch, week: learningWeek(now + 7 * 86400000), created_at: now + 7 * 86400000 } };
  assert.deepEqual(await deliverPlanPublications(db, "owner", [future], now), [deliveries[0]]);
  sql.close();
});
test("plan publication imports checked source copies and a new version once, preserving original progress and audio", async () => {
  const { db, sql } = supplementFixture(), fixture = database(), now = releaseTime;
  const revised = { ...firstLesson, version: 2, takeaway: `${firstLesson.takeaway} TEST editorial update.` };
  const review = { ...await reviewFixture(revised, fixture.db), method: "build-editorial" as const };
  const sources = await Promise.all(review.sourceChecks.map(async check => ({ snapshotId: check.snapshotId, material: await capturedMaterial(fixture.db, "owner", check.snapshotId) })));
  fixture.sql.close();
  await writeProgress(db, "owner", { key: lessonKey(firstLesson), completed: true, position: 33, observedAt: now }, now);
  sql.prepare("INSERT INTO media(lesson_key,object_key,content_type,bytes,duration,created_at) VALUES(?,'TEST/original.wav','audio/wav',100,300,?)").run(lessonKey(firstLesson), now);
  const progress = sql.prepare("SELECT * FROM progress").all(), media = sql.prepare("SELECT * FROM media").all();
  const publication: PlanPublication = { ownerId: "owner", week: learningWeek(now), preparedAt: now, summary: "TEST reviewed update", checks: [{ lessonKey: lessonKey(firstLesson), outcome: "updated", checkedAt: now, summary: "TEST material change" }], batch: { week: learningWeek(now), origin: "scheduled", items: [], created_at: now }, release: { lesson: revised, previousKey: lessonKey(firstLesson), summary: "TEST revision", review, sources } };
  const result = await deliverPlanPublication(db, "owner", publication, now);
  assert.equal(result.updatedLessonKey, lessonKey(revised));
  assert.deepEqual(await deliverPlanPublication(db, "owner", publication, now), result);
  assert.deepEqual(sql.prepare("SELECT * FROM progress").all(), progress); assert.deepEqual(sql.prepare("SELECT * FROM media").all(), media);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM source_captures").get()?.n, sources.length);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 3);
  const info = JSON.parse(String(sql.prepare("SELECT release_info FROM lesson_versions WHERE key=?").get(lessonKey(revised))?.release_info));
  assert.equal(info.previousKey, lessonKey(firstLesson)); assert.equal(info.review.method, "build-editorial");
  sql.close();
});
test("bad editorial evidence stays held without publishing teaching or preventing saved learning from loading", async () => {
  const { db, sql } = supplementFixture(), now = releaseTime, revised = { ...firstLesson, version: 2 };
  const review = { ...await reviewFixture(revised, db), method: "build-editorial" as const };
  const sources = await Promise.all(review.sourceChecks.map(async check => ({ snapshotId: check.snapshotId, material: await capturedMaterial(db, "owner", check.snapshotId) })));
  sources[0].material.text += " CORRUPTED";
  const publication: PlanPublication = { ownerId: "owner", week: learningWeek(now), preparedAt: now, summary: "TEST invalid evidence", checks: [{ lessonKey: lessonKey(firstLesson), outcome: "updated", checkedAt: now, summary: "TEST" }], batch: { week: learningWeek(now), origin: "scheduled", items: [], created_at: now }, release: { lesson: revised, previousKey: lessonKey(firstLesson), summary: "TEST", review, sources } };
  const results = await deliverPlanPublications(db, "owner", [publication], now);
  assert.equal(results[0].status, "needs_attention"); assert.match(results[0].error!, /fingerprint/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 2); assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 0);
  sql.close();
});
test("starter lessons have bounded narration, valid references, and distinct version keys", () => {
  assert.equal(new Set(seedLessons.map(lessonKey)).size, seedLessons.length);
  for (const lesson of seedLessons) {
    const script = narrationText(lesson), words = script.split(/\s+/).length;
    assert.ok(words >= 600 && words <= 800, `${lesson.title}: ${words} words`);
    assert.ok(script.length <= 8000);
    assert.ok(lesson.sources.length >= 2 && lesson.sources.length <= 4);
    assert.ok(lesson.quiz.answer >= 0 && lesson.quiz.answer < lesson.quiz.options.length);
    assert.equal(new Set(lesson.sources.map(s => s.url)).size, lesson.sources.length);
    for (const source of lesson.sources) assert.ok(lesson.sections.some(section => section.sources.includes(source.id)));
    for (const section of lesson.sections) for (const id of section.sources) assert.ok(lesson.sources.some(s => s.id === id));
  }
});
import { reserveStorage, settleStorage, STORAGE_LIMIT } from "../lib/storage";
test("storage reservations include interrupted work and enforce the cap before writes", async () => {
  const { db, sql } = database();
  const requests = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => reserveStorage(db, `audio-${i}`, 100_000_000)));
  assert.equal(requests.filter(r => r.status === "fulfilled").length, 20);
  assert.equal(sql.prepare("SELECT SUM(bytes) AS bytes FROM storage_allocations").get()?.bytes, STORAGE_LIMIT);
  await reserveStorage(db, "audio-0", 100_000_000);
  await settleStorage(db, "audio-0", 40_000_000);
  await assert.rejects(reserveStorage(db, "another", 100_000_000));
  await reserveStorage(db, "smaller", 60_000_000);
  assert.equal(sql.prepare("SELECT SUM(bytes) AS bytes FROM storage_allocations").get()?.bytes, STORAGE_LIMIT);
  sql.close();
});

import { researchQuestion, questionResearchFromRow, type QuestionResearchRow } from "../lib/question-research";

async function followupFixture() {
  const { db, sql } = database(), id = crypto.randomUUID();
  sql.prepare("INSERT INTO owner(id,user_id,created_at) VALUES(1,'owner',?)").run(Date.now());
  sql.prepare("INSERT INTO lesson_versions(key,lesson_id,version,course_id,content,status,created_at) VALUES(?,?,?,?,?,'ready',?)").run(lessonKey(firstLesson), firstLesson.id, firstLesson.version, firstLesson.courseId, JSON.stringify(firstLesson), Date.now());
  const gap = await answerFixture().json() as { output: { content: { text: string }[] }[] }; gap.output[0].content[0].text = JSON.stringify({ text: "EXPLICIT FOLLOW-UP FIXTURE: current source evidence is missing.", sourceIds: [], needsResearch: true, evidence: [] });
  const original = await answerQuestion(db, "owner", firstLesson, { id, question: "EXPLICIT FOLLOW-UP FIXTURE: what evidence supports this workflow today?" }, { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: async () => Response.json(gap) });
  let searches = 0, answers = 0, pages = 0;
  const services = { apiKey: "EXPLICIT_FIXTURE_KEY", fetch: (async (url, init) => {
    if (url !== "https://api.openai.com/v1/responses") { pages++; return new Response(sourceFixtureHtml, { headers: { "Content-Type": "text/html" } }); }
    const body = JSON.parse(String(init?.body));
    if (body.tools) { searches++; assert.ok(JSON.parse(body.input[0].content).detail.includes(original.question)); return searchFixture(); }
    answers++; const packet = JSON.parse(body.input[0].content), sources = packet.retrievedSources as {sourceId: string; text: string}[];
    assert.ok(sources.length > 0); assert.ok(sources[0].text.includes("TEST SOURCE FIXTURE"));
    assert.equal(packet.question, original.question); assert.equal(packet.lesson.version, 1);
    return answerFixture([sources[0].sourceId], undefined, [{ sourceId: sources[0].sourceId, quote: "Inline emphasis." }]);
  }) as typeof fetch };
  return { db, sql, id, original, services, calls: () => ({ searches, answers, pages }) };
}

test("a question evidence gap can research fresh pages and retain a separate dated answer without overwriting the original", async () => {
  const f = await followupFixture(), before = f.sql.prepare("SELECT * FROM questions WHERE id=?").get(f.id);
  const searched = await researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, f.services);
  assert.equal(searched.answer, null); assert.equal(searched.research.search?.candidates.length, 2);
  assert.equal(searched.link.sourceCaptureIds, null);
  const answered = await researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, f.services);
  assert.equal(answered.answer?.answer?.needsResearch, false); assert.equal(answered.answer?.sourceCaptureIds.length, 2);
  assert.ok(answered.answer?.answer?.sourceCopies?.every(s => s.retrievedAt >= answered.link.created_at));
  assert.deepEqual(f.sql.prepare("SELECT * FROM questions WHERE id=?").get(f.id), before);
  assert.deepEqual(f.calls(), { searches: 1, answers: 1, pages: 2 });
  assert.deepEqual(await researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, {}), answered);
  await researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, {});
  assert.deepEqual(f.calls(), { searches: 1, answers: 1, pages: 2 });
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM questions").get()?.n, 2);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 3);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM activity").get()?.n, 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM lesson_versions").get()?.n, 1);
  f.sql.close();
});

test("question research enforces ownership, a saved gap, prior search, setup, immutable request bindings and no direct child-answer bypass", async () => {
  const f = await followupFixture();
  await assert.rejects(researchQuestion(f.db, "other", { id: f.id, stage: "research" }, f.services), /Only the owner/);
  await assert.rejects(researchQuestion(f.db, "owner", { id: crypto.randomUUID(), stage: "research" }, f.services), /not found/);
  await assert.rejects(researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, f.services), /Research this question/);
  await assert.rejects(researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, {}), /secure AI setup/);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM question_research").get()?.n, 0);
  const direct = await answerQuestion(f.db, "owner", firstLesson, { id: crypto.randomUUID(), question: "Ordinary question fixture" }, { apiKey: "fixture", fetch: async () => answerFixture() });
  await assert.rejects(researchQuestion(f.db, "owner", { id: direct.id, stage: "research" }, f.services), /no saved evidence gap/);
  const run = await researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, f.services);
  assert.throws(() => f.sql.prepare("UPDATE question_research SET answer_id=? WHERE question_id=?").run(crypto.randomUUID(), f.id), /keeps its original/);
  await assert.rejects(answerQuestion(f.db, "owner", firstLesson, { id: run.link.answer_id, question: f.original.question }, f.services), /saved question research/);
  const complete = await researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, f.services);
  assert.throws(() => f.sql.prepare("UPDATE question_research SET source_capture_ids='[]' WHERE question_id=?").run(f.id), /keeps its original/);
  const exported = questionResearchFromRow(f.sql.prepare("SELECT * FROM question_research").get() as QuestionResearchRow);
  assert.deepEqual(exported, complete.link); assert.equal(Object.hasOwn(exported, "user_id"), false);
  f.sql.close();
});

test("empty or unreadable question research makes no answer call and a readable subset remains usable", async () => {
  for (const mode of ["empty", "unreadable", "partial"] as const) {
    const f = await followupFixture();
    const services = { ...f.services, fetch: (async (url, init) => {
      if (url === "https://api.openai.com/v1/responses" && JSON.parse(String(init?.body)).tools && mode === "empty") return searchFixture({ urls: [] });
      if (url !== "https://api.openai.com/v1/responses" && (mode === "unreadable" || mode === "partial" && url === researchUrls[0])) return new Response("Fixture unavailable", { status: 403 });
      return f.services.fetch(url, init);
    }) as typeof fetch };
    await researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, services);
    if (mode !== "partial") {
      await assert.rejects(researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, services), /no suitable pages|could not be read/);
      assert.equal(f.calls().answers, 0); assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM questions").get()?.n, 1);
    } else {
      const answered = await researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, services);
      assert.equal(answered.answer?.sourceCaptureIds.length, 1); assert.equal(f.calls().answers, 1);
    }
    f.sql.close();
  }
});

test("uncertain question search or answer never duplicates paid work and saved accounting recovers without a key", async () => {
  for (const failed of ["research", "answer"] as const) {
    const f = await followupFixture(); let failedCalls = 0;
    const services = { ...f.services, fetch: (async (url, init) => {
      if (url === "https://api.openai.com/v1/responses" && Boolean(JSON.parse(String(init?.body)).tools) === (failed === "research")) { failedCalls++; throw new Error("EXPLICIT LOST RESPONSE FIXTURE"); }
      return f.services.fetch(url, init);
    }) as typeof fetch };
    if (failed === "answer") await researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, services);
    await assert.rejects(researchQuestion(f.db, "owner", { id: f.id, stage: failed }, services));
    const committed = (await budgetSummary(f.db)).committed;
    if (failed === "research") { const repeated = await researchQuestion(f.db, "owner", { id: f.id, stage: failed }, {}); assert.equal(repeated.research.search, null); }
    else await assert.rejects(researchQuestion(f.db, "owner", { id: f.id, stage: failed }, services), /already started/);
    assert.equal(failedCalls, 1); assert.equal((await budgetSummary(f.db)).committed, committed); f.sql.close();
  }
  const f = await followupFixture(); await researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, f.services);
  const answered = await researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, f.services);
  f.sql.prepare("UPDATE spending SET status='uncertain',charged=NULL,result=NULL WHERE id IN (?,?)").run(`research:${answered.link.research_id}`, `question:${answered.link.answer_id}`);
  assert.deepEqual(await researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, {}), answered);
  assert.deepEqual(f.calls(), { searches: 1, answers: 1, pages: 2 }); f.sql.close();
});

test("a researched answer cannot claim the gap resolved without retrieved evidence and repeated research is bounded", async () => {
  for (const needsResearch of [false, true]) {
    const f = await followupFixture(); await researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, f.services);
    const services = { ...f.services, fetch: (async () => { const result = await answerFixture().json() as { output: { content: { text: string }[] }[] }; const answer = JSON.parse(result.output[0].content[0].text); answer.needsResearch = needsResearch; result.output[0].content[0].text = JSON.stringify(answer); return Response.json(result); }) as typeof fetch };
    if (!needsResearch) await assert.rejects(researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, services), /support from a retrieved page/);
    else {
      const saved = await researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, services);
      assert.equal(saved.answer?.answer?.needsResearch, true);
      await assert.rejects(researchQuestion(f.db, "owner", { id: saved.answer!.id, stage: "research" }, f.services), /already has a bounded research/);
    }
    f.sql.close();
  }
});

test("question research shares budget and research limits and concurrent requests retain one search identity", async () => {
  const f = await followupFixture();
  const attempts = await Promise.allSettled([researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, f.services), researchQuestion(f.db, "owner", { id: f.id, stage: "research" }, f.services)]);
  assert.ok(attempts.some(r => r.status === "fulfilled")); assert.equal(f.calls().searches, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM question_research").get()?.n, 1);
  const used = (await budgetSummary(f.db)).committed;
  await reserveSpend(f.db, "EXPLICIT_EXHAUSTED_BUDGET", "fixture", MONTHLY_LIMIT - used, "Fixture only");
  await assert.rejects(researchQuestion(f.db, "owner", { id: f.id, stage: "answer" }, f.services), /allowance is used/); assert.equal(f.calls().answers, 0); f.sql.close();
  const g = await followupFixture(); const usedBefore = (await budgetSummary(g.db)).committed;
  await reserveSpend(g.db, "EXPLICIT_EXHAUSTED_BUDGET", "fixture", MONTHLY_LIMIT - usedBefore, "Fixture only");
  await assert.rejects(researchQuestion(g.db, "owner", { id: g.id, stage: "research" }, g.services), /allowance is used/); assert.equal(g.calls().searches, 0); g.sql.close();
});

// Synthetic RSA credentials generated solely for tests; no saved site key is read.
const googleFixtureKeys = crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
async function googleFixture() {
  const keys = await googleFixtureKeys, der = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const secret = JSON.stringify({ type: "service_account", project_id: GOOGLE_PROJECT_ID, client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL, token_uri: "https://oauth2.googleapis.com/token", private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----\n` });
  let authCalls = 0, synthesisCalls = 0, fail = false;
  const transport = (async (url, init) => {
    assert.equal(init?.redirect, "manual");
    if (url === "https://oauth2.googleapis.com/token") {
      authCalls++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const [head, claim, signature] = body.get("assertion")!.split(".");
      assert.ok(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", keys.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${head}.${claim}`)));
      const claims = JSON.parse(Buffer.from(claim, "base64url").toString());
      assert.equal(claims.aud, "https://oauth2.googleapis.com/token"); assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform"); assert.equal(claims.sub, undefined); assert.equal(claims.exp - claims.iat, 3600);
      return Response.json({ access_token: "EXPLICIT_SYNTHETIC_TOKEN", token_type: "Bearer" });
    }
    assert.equal(url, SYNTHESIS_URL, "No OpenAI or other destination may receive narration");
    synthesisCalls++;
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer EXPLICIT_SYNTHETIC_TOKEN");
    const body = JSON.parse(String(init?.body)); assert.ok(new TextEncoder().encode(body.input.text).length <= 3800);
    assert.match(body.voice.name, /^en-US-Chirp3-HD-(Charon|Kore)$/);
    assert.deepEqual(body.audioConfig, { audioEncoding: "LINEAR16", sampleRateHertz: 24000 });
    if (fail) throw new Error("EXPLICIT lost Google response");
    const wav = new Uint8Array(48044); wav.set(waveHeader(48000));
    return Response.json({ audioContent: Buffer.from(wav).toString("base64") });
  }) as typeof fetch;
  return { secret, fetch: transport, calls: () => ({ authCalls, synthesisCalls }), fail: () => { fail = true; } };
}

test("Google authorization signs a bounded service-account JWT and rejects unexpected credential endpoints without sending", async () => {
  const f = await googleFixture(); assert.equal(await googleAccessToken(f.secret, f.fetch), "EXPLICIT_SYNTHETIC_TOKEN");
  assert.deepEqual(f.calls(), { authCalls: 1, synthesisCalls: 0 });
  for (const value of ["NOT_JSON_PRIVATE_SENTINEL", JSON.stringify({ ...JSON.parse(f.secret), token_uri: "https://attacker.example/token" }), JSON.stringify({ ...JSON.parse(f.secret), client_email: "other@example.com" })]) {
    await assert.rejects(googleAccessToken(value, f.fetch), /Google narration secret needs checking/);
  }
  assert.deepEqual(f.calls(), { authCalls: 1, synthesisCalls: 0 });
});

test("Chirp respects UTF-8 request limits and accepts only complete 24kHz mono PCM WAV audio", () => {
  const input = "日本語 é 😀 test ".repeat(350), chunks = splitChirpText(input);
  assert.equal(chunks.join(" "), input.trim()); assert.ok(chunks.every(text => new TextEncoder().encode(text).length <= 3800));
  assert.throws(() => splitChirpText("字".repeat(1500)), /oversized word/);
  const wav = new Uint8Array(144); wav.set(waveHeader(100)); assert.equal(chirpPcm(wav).length, 100);
  for (const index of [0, 4, 22, 24, 28, 32, 34, 40]) { const bad = wav.slice(); bad[index] ^= 1; assert.throws(() => chirpPcm(bad)); }
  assert.throws(() => chirpPcm(wav.subarray(0, 130)));
});

test("Chirp allowance is atomic, spans calendar boundaries, and keeps unresolved attempts held", async () => {
  const { db, sql } = database(), now = Date.UTC(2026, 8, 30, 23, 59);
  try {
    sql.prepare("INSERT INTO chirp_requests VALUES('prior','fixture','fixture',897000,'complete',?)").run(now);
    const results = await Promise.allSettled([reserveChirp(db, "a", "fixture", "hash", 3000, now), reserveChirp(db, "b", "fixture", "hash", 3000, now)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await chirpSummary(db, true, now)).used, 900000);
    await assert.rejects(reserveChirp(db, "c", "fixture", "hash", 1, now + 120000), /paused/);
    assert.equal((await chirpSummary(db, true, now + 120000)).monthUsed, 0);
    await assert.rejects(reserveChirp(db, "c", "fixture", "hash", 1, now + CHIRP_WINDOW + 1), /paused/, "Unresolved old attempts do not reset into permission to resend");
  } finally { sql.close(); }
});

test("Chirp previews, full pilot, voice choice and lesson narration preserve old audio and learning; replay never calls a provider", async () => {
  const { db, sql } = database(), storage = narrationBucketFixture(), f = await googleFixture(), services = { ...storage, ...f };
  try {
    await assert.rejects(activateChirp(db, "Charon"), /Prepare a voice sample/);
    await assert.rejects(prepareChirpLesson(db, firstLesson, services), /Choose a tested/);
    await prepareChirpPreview(db, "sample", "Charon", firstLesson, services);
    await assert.rejects(activateChirp(db, "Charon"), /full lesson preview/);
    await prepareChirpPreview(db, "pilot", "Charon", firstLesson, services);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM media").get()?.n, 0);
    await activateChirp(db, "Charon");
    const next = { ...firstLesson, version: 2 };
    sql.prepare("INSERT INTO media VALUES(?,'ORIGINAL_AUDIO','audio/wav',100,1,1)").run(lessonKey(firstLesson));
    const original = sql.prepare("SELECT * FROM media").all();
    const before = f.calls(); await prepareChirpLesson(db, firstLesson, services); assert.deepEqual(f.calls(), before);
    await prepareChirpLesson(db, next, services);
    const savedCalls = f.calls(), usage = await chirpSummary(db, true), records = sql.prepare("SELECT * FROM chirp_requests").all();
    await prepareChirpLesson(db, next, {}); await prepareChirpPreview(db, "pilot", "Charon", firstLesson, { ...storage });
    assert.deepEqual(f.calls(), savedCalls); assert.deepEqual(sql.prepare("SELECT * FROM chirp_requests").all(), records);
    assert.ok(usage.used > 5000); assert.equal(usage.held, 0); assert.equal(usage.voice, "Charon");
    assert.deepEqual(sql.prepare("SELECT * FROM media WHERE lesson_key=?").all(lessonKey(firstLesson)), original);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 0);
    for (const table of ["progress", "events", "activity"]) assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
    const row = sql.prepare("SELECT object_key,bytes FROM media WHERE lesson_key=?").get(lessonKey(next))!;
    assert.equal(storage.objects.get(String(row.object_key))!.bytes.length, row.bytes);
  } finally { sql.close(); }
});

test("a lost Google response is permanently held without automatic retry or OpenAI fallback", async () => {
  const { db, sql } = database(), storage = narrationBucketFixture(), f = await googleFixture(); f.fail();
  try {
    await assert.rejects(prepareChirpPreview(db, "sample", "Charon", firstLesson, { ...storage, ...f }), /lost Google response/);
    const calls = f.calls();
    await assert.rejects(prepareChirpPreview(db, "sample", "Charon", firstLesson, { ...storage, ...f }), /will not be resent/);
    assert.deepEqual(f.calls(), calls); assert.equal((await chirpSummary(db, true)).held, 1);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM spending").get()?.n, 0);
  } finally { sql.close(); }
});

test("an interrupted lesson is discoverable for saved-only recovery without retrying Google", async () => {
  const { db, sql } = database(), storage = narrationBucketFixture(), f = await googleFixture(); f.fail();
  try {
    sql.exec("INSERT INTO chirp_settings VALUES(1,'Charon')");
    await assert.rejects(prepareChirpLesson(db, firstLesson, { ...storage, ...f }), /lost Google response/);
    const before = await chirpSummary(db, true), calls = f.calls();
    assert.equal(before.pending?.[0].lesson_key, lessonKey(firstLesson));
    await assert.rejects(prepareChirpLesson(db, firstLesson, { ...storage, onlySaved: true }), /will not be resent/);
    assert.deepEqual(f.calls(), calls);
    assert.deepEqual(await chirpSummary(db, true), before);
  } finally { sql.close(); }
});

test("an HTML timeout explains the unknown outcome without retrying the browser request", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("<!DOCTYPE html><title>Gateway timeout</title>", { status: 504 }); };
  try {
    await assert.rejects(api("narrate", { key: "fixture:v1" }), /Check Settings for saved results/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("saved Google segments recover after assembly or final database failure without any provider request", async () => {
  for (const mode of ["assembly", "database"] as const) {
    const { db, sql } = database(), storage = narrationBucketFixture(), f = await googleFixture();
    if (mode === "assembly") storage.rejectAssembly(true);
    else sql.exec("CREATE TRIGGER test_fail_chirp BEFORE UPDATE OF object_key ON chirp_audio BEGIN SELECT RAISE(ABORT,'EXPLICIT db failure'); END");
    try {
      await assert.rejects(prepareChirpPreview(db, "pilot", "Charon", firstLesson, { ...storage, ...f }));
      storage.rejectAssembly(false); if (mode === "database") sql.exec("DROP TRIGGER test_fail_chirp");
      const calls = f.calls(), before = (await chirpSummary(db, true)).used;
      await prepareChirpPreview(db, "pilot", "Charon", firstLesson, { ...storage, onlySaved: true });
      assert.deepEqual(f.calls(), calls); const usage = await chirpSummary(db, true); assert.equal(usage.used, before); assert.equal(usage.held, 0); assert.ok(usage.previews[0].object_key);
    } finally { sql.close(); }
  }
});
