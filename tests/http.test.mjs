import { test } from "node:test";
import assert from "node:assert/strict";
const base = process.env.INTERLUDE_TEST_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("Set INTERLUDE_TEST_URL to the running local development server. These tests create local test records.");
const headers = { Cookie: "__sites_local_auth=1", Origin: new URL(base).origin, "Content-Type": "application/json" };
const request = (path, body, overrides = {}) => fetch(`${base}/api/${path}`, { method: body ? "POST" : "GET", headers: { ...headers, ...overrides }, ...(body ? { body: JSON.stringify(body) } : {}) });
test("weekly refresh is private and accepts no browser-selected schedule, target, evidence or request identity", async () => {
  const before = await (await request("state")).json();
  assert.equal((await fetch(`${base}/api/advance-weekly-refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await request("advance-weekly-refresh", {}, { Origin: "https://unrelated.example" })).status, 403);
  for (const extra of [{ userId: "other" }, { origin: "scheduled" }, { week: "2030-01-01" }, { key: "what-models-can-do:v1" }, { researchId: crypto.randomUUID() }, { result: "ready" }, { apiKey: "forged" }]) assert.equal((await request("advance-weekly-refresh", extra)).status, 400);
  const runId = crypto.randomUUID();
  assert.equal((await fetch(`${base}/api/weekly-refresh?runId=${runId}`)).status, 401);
  assert.equal((await request(`weekly-refresh?runId=${runId}`)).status, 404);
  assert.equal((await request("weekly-refresh?runId=invalid")).status, 400);
  assert.equal((await request("advance-weekly-refresh", { runId })).status, 404);
  for (const runId of ["", "invalid", null, 10]) assert.equal((await request("advance-weekly-refresh", { runId })).status, 400);
  for (const run of before.weeklyRefresh.history) {
    const result = await request(`weekly-refresh?runId=${run.preparation_id}`); assert.equal(result.status, 200); assert.match(result.headers.get("cache-control"), /private.*no-store/);
    assert.deepEqual((await result.json()).refresh.run, run);
  }
  const response = await request("export"); assert.match(response.headers.get("cache-control"), /private.*no-store/);
  const after = await response.json();
  assert.deepEqual(after.weeklyRefresh, before.weeklyRefresh); assert.deepEqual(after.weekly, before.weekly);
  assert.deepEqual(after.lessons, before.lessons); assert.deepEqual(after.spending, before.spending);
});
test("saved-output recovery is private, strict and never creates a request for a missing result", async () => {
  const body = { spendingId: `question:${crypto.randomUUID()}` }, before = await (await request("state")).json();
  assert.equal((await fetch(`${base}/api/check-saved-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 401);
  assert.equal((await request("check-saved-request", body, { Origin: "https://unrelated.example" })).status, 403);
  for (const extra of [{ userId: "other" }, { retry: true }, { cost: 0 }, { answer: {} }, { apiKey: "forged" }]) assert.equal((await request("check-saved-request", { ...body, ...extra })).status, 400);
  assert.equal((await request("check-saved-request", body)).status, 404);
  const exported = await request("export"); assert.match(exported.headers.get("cache-control"), /private.*no-store/);
  const after = await exported.json();
  for (const key of ["spending", "questions", "voiceDrafts", "topicResearch", "lessonPreparations", "costReviews", "sourceCaptures", "lessons", "progress", "events"]) assert.deepEqual(after[key], before[key], key);
});
test("weekly suggestions enforce private server-owned sets and preserve retries, choices, topics and export", async () => {
  const before = await (await request("state")).json(), missing = { week: "2000-01-03", itemId: crypto.randomUUID() };
  assert.ok(Array.isArray(before.weekly.batches)); assert.ok(Array.isArray(before.weekly.choices));
  for (const [path, body] of [["prepare-weekly", {}], ["choose-weekly", { ...missing, dismissed: true, revision: 0 }], ["save-weekly-topic", missing]]) {
    assert.equal((await fetch(`${base}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await request(path, body, { Origin: "https://unrelated.example" })).status, 403);
    assert.equal((await request(path, { ...body, userId: "another" })).status, 400);
  }
  for (const extra of [{ week: "2030-01-01" }, { origin: "scheduled" }, { items: [] }, { now: 0 }]) assert.equal((await request("prepare-weekly", extra)).status, 400);
  assert.equal((await request("choose-weekly", { ...missing, dismissed: true, revision: 0 })).status, 404);
  assert.equal((await request("save-weekly-topic", missing)).status, 404);
  const date = new Date(); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const current = before.weekly.batches.find(b => b.week === date.toISOString().slice(0, 10));
  // Verify the saved browser-QA set without creating a new weekly set during this suite.
  if (current) {
    const responses = await Promise.all([request("prepare-weekly", {}), request("prepare-weekly", {})]);
    for (const r of responses) { assert.equal(r.status, 200); assert.match(r.headers.get("cache-control"), /private.*no-store/); assert.deepEqual((await r.json()).batch, current); }
    for (const choice of before.weekly.choices.filter(c => c.week === current.week)) assert.deepEqual((await (await request("choose-weekly", { week: choice.week, itemId: choice.item_id, dismissed: Boolean(choice.dismissed), revision: choice.revision })).json()).choice, choice);
    for (const item of current.items.filter(i => i.kind === "topic" && before.libraryItems.some(l => l.id === i.topicId))) assert.equal((await (await request("save-weekly-topic", { week: current.week, itemId: item.id })).json()).itemId, item.topicId);
  }
  const response = await request("export"), after = await response.json(); assert.match(response.headers.get("cache-control"), /private.*no-store/);
  for (const key of ["weekly", "libraryItems", "spending", "lessons", "progress", "events"]) assert.deepEqual(after[key], before[key], key);
});
test("supplement completion is private, rejects fabricated metadata and exports manual records separately", async () => {
  const input = { key: "what-models-can-do:v1", supplementId: "3b1b-llms-briefly" }, before = await (await request("state")).json();
  assert.equal((await fetch(`${base}/api/complete-supplement`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).status, 401);
  assert.equal((await request("complete-supplement", input, { Origin: "https://unrelated.example" })).status, 403);
  for (const extra of [{ userId: "other" }, { duration: 200 }, { completed: true }, { provider: "forged" }, { sourceUrl: "https://forged.test/" }]) assert.equal((await request("complete-supplement", { ...input, ...extra })).status, 400);
  assert.equal((await request("complete-supplement", { ...input, key: "missing-version:v1" })).status, 404);
  assert.equal((await request("complete-supplement", { ...input, supplementId: "lennys-reads-pm-agents" })).status, 404);
  // Reuse only a deliberately saved local browser-QA record; this check never marks unseen media complete.
  const saved = before.events.find(e => e.kind === "supplement" && e.payload.key === input.key && e.payload.supplementId === input.supplementId);
  if (saved) {
    const responses = await Promise.all([request("complete-supplement", input), request("complete-supplement", input)]);
    for (const r of responses) { assert.equal(r.status, 200); assert.match(r.headers.get("cache-control"), /private.*no-store/); assert.equal((await r.json()).completion.id, saved.id); }
  }
  const exported = await request("export"), after = await exported.json(); assert.match(exported.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual(after.events, before.events); assert.deepEqual(after.progress, before.progress); assert.deepEqual(after.spending, before.spending);
  for (const e of after.events.filter(e => e.kind === "supplement")) { assert.equal(e.payload.method, "manual"); assert.equal(e.payload.completed, true); assert.equal(Object.hasOwn(e.payload, "minutes"), false); }
});
test("anonymous API and audio requests fail closed, including spoofed identity headers", async () => {
  for (const path of ["state", "audio/what-models-can-do%3Av1"]) {
    const result = await fetch(`${base}/api/${path}`, { headers: { "oai-authenticated-user-id": "fake", "oai-authenticated-user-email": "fake@example.test" } });
    assert.equal(result.status, 401);
  }
});
test("cross-origin writes are refused", async () => { const result = await request("notes", {}, { Origin: "https://unrelated.example" }); assert.equal(result.status, 403); });
test("lesson update requests bind the original version privately and do not generate or replace teaching", async () => {
  const before = await (await request("state")).json(), lesson = before.lessons.find(l => l.id === "what-models-can-do");
  const body = { id: crypto.randomUUID(), key: `${lesson.id}:v${lesson.version}`, reason: "LOCAL HTTP UPDATE CHECK: verify request persistence without generating teaching." };
  assert.equal((await fetch(`${base}/api/request-refresh`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })).status, 401);
  assert.equal((await request("request-refresh", body, { Origin: "https://unrelated.example" })).status, 403);
  for (const changed of [{ originalLesson: lesson }, { contentHash: "a".repeat(64) }, { userId: "other" }, { reason: "x".repeat(601) }, { reviewed: true }]) assert.equal((await request("request-refresh", { ...body, ...changed })).status, 400);
  const first = await request("request-refresh", body); assert.equal(first.status, 200); assert.match(first.headers.get("cache-control"), /no-store/);
  const item = (await first.json()).item;
  assert.equal(item.refresh_of, body.key); assert.match(item.refresh_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual((await (await request("request-refresh", body)).json()).item, item);
  assert.equal((await request("request-refresh", { ...body, reason: "Different requested check" })).status, 409);
  assert.equal((await request("library", { id: crypto.randomUUID(), kind: "topic", title: "LOCAL forged update", refresh_of: body.key, refresh_hash: item.refresh_hash })).status, 400);
  const after = await (await request("export")).json();
  assert.deepEqual(after.lessons, before.lessons); assert.deepEqual(after.spending, before.spending); assert.deepEqual(after.lessonPreparations, before.lessonPreparations);
  assert.equal(after.libraryItems.filter(i => i.id === body.id).length, 1); assert.equal(after.libraryItems.find(i => i.id === body.id).refresh_of, body.key);
  for (const p of after.lessonPreparations) if (p.refresh) { assert.equal(Object.hasOwn(p.refresh, "lesson"), false); assert.match(p.refresh.hash, /^[a-f0-9]{64}$/); }
});
test("narration replacement and recovery require private explicit requests and never accept browser cost limits", async () => {
  const before = await (await request("state")).json(); assert.ok(Array.isArray(before.narrationReplacements));
  const body = { id: crypto.randomUUID(), spendingId: `unknown:${crypto.randomUUID()}`, expectedFingerprint: "a".repeat(64), reviewId: crypto.randomUUID(), confirmedNewCharge: true };
  for (const [path, input] of [["replace-narration", body], ["recover-narration", { key: "what-models-can-do:v1" }]]) {
    assert.equal((await fetch(`${base}/api/${path}`, { method: "POST", body: JSON.stringify(input), headers: { "Content-Type": "application/json" } })).status, 401);
    assert.equal((await request(path, input, { Origin: "https://unrelated.example" })).status, 403);
  }
  for (const changed of [{ confirmedNewCharge: false }, { maxCost: 1 }, { userId: "other" }, { expectedFingerprint: "wrong" }, { reviewId: null }]) assert.equal((await request("replace-narration", { ...body, ...changed })).status, 400);
  assert.equal((await request("replace-narration", body)).status, 404);
  assert.equal((await request("recover-narration", { key: "what-models-can-do:v1", apiKey: "browser-supplied" })).status, 400);
  const checked = await request("recover-narration", { key: "what-models-can-do:v1" });
  if (checked.status === 503) {
    assert.equal(before.chirp.voice, null, "A fresh checkout has no tested Google voice");
    assert.match((await checked.json()).error, /Choose a tested Google voice in Settings/);
  } else assert.ok([200, 409].includes(checked.status));
  assert.match(checked.headers.get("cache-control"), /no-store/);
  const after = await (await request("export")).json();
  assert.deepEqual(after.narrationReplacements, before.narrationReplacements); assert.deepEqual(after.spending, before.spending);
  assert.equal(after.chirp.used, before.chirp.used); assert.equal(after.chirp.held, before.chirp.held);
  for (const r of after.narrationReplacements) { assert.equal(Object.hasOwn(r, "snapshot"), false); assert.equal(Object.hasOwn(r, "input_sha256"), false); }
});
test("cost checks are private, require explicit evidence, and export without raw accounting snapshots", async () => {
  const before = await (await request("state")).json(); assert.ok(Array.isArray(before.costReviews));
  const body = { id: crypto.randomUUID(), spendingId: `unknown:${crypto.randomUUID()}`, expectedFingerprint: "a".repeat(64), previousReviewId: null,
    decision: "confirmed", amount: 1000, evidence: "LOCAL HTTP VALIDATION: no real provider cost is being entered.", confirmedFinalOutcome: true };
  assert.equal((await fetch(`${base}/api/review-cost`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })).status, 401);
  assert.equal((await request("review-cost", body, { Origin: "https://unrelated.example" })).status, 403);
  for (const change of [{ amount: -1 }, { amount: 0.1 }, { amount: null }, { evidence: "short" }, { confirmedFinalOutcome: false }, { snapshot: "browser state" }, { userId: "other" }]) assert.equal((await request("review-cost", { ...body, ...change })).status, 400);
  assert.equal((await request("review-cost", body)).status, 404);
  const after = await (await request("export")).json(); assert.deepEqual(after.costReviews, before.costReviews); assert.deepEqual(after.budget, before.budget);
  for (const spend of after.spending) { assert.match(spend.fingerprint, /^[a-f0-9]{64}$/); assert.equal(Object.hasOwn(spend, "snapshot"), false); assert.equal(Object.hasOwn(spend, "result"), false); }
  assert.ok(after.costReviews.every(r => !Object.hasOwn(r, "snapshot")));
});
test("progress persists across independent requests without overwriting another lane", async () => {
  const state = await (await request("state")).json(), key = `${state.lessons[0].id}:v${state.lessons[0].version}`, now = Date.now();
  assert.equal((await request("progress", { key, position: 42, completed: false, observedAt: now })).status, 200);
  assert.equal((await request("progress", { key, section: 2, completed: false, observedAt: now + 1 })).status, 200);
  const reloaded = await (await request("state")).json(), saved = reloaded.progress.find(p => p.lesson_key === key);
  assert.equal(saved.position, 42); assert.equal(saved.section, 2);
});
test("a repeated note request creates one exportable note", async () => {
  const body = { id: crypto.randomUUID(), key: "what-models-can-do:v1", kind: "reflection", text: "Automated local verification: retries preserve this note once." };
  const responses = await Promise.all([request("notes", body), request("notes", body)]);
  assert.ok(responses.every(r => r.status === 200));
  const data = await (await request("export")).json();
  assert.equal(data.notes.filter(n => n.id === body.id).length, 1);
  assert.ok(Array.isArray(data.events));
});
test("the library exposes one current version per lesson and exports its complete version history", async () => {
  const state = await (await request("state")).json(), exported = await (await request("export")).json();
  assert.ok(Array.isArray(state.archivedLessons)); assert.ok(Array.isArray(state.releases));
  assert.equal(new Set(state.lessons.map(l => l.id)).size, state.lessons.length);
  for (const archived of state.archivedLessons) {
    const current = state.lessons.find(l => l.id === archived.id);
    assert.ok(current && current.version > archived.version);
    assert.ok(exported.archivedLessons.some(l => l.id === archived.id && l.version === archived.version));
  }
  for (const lesson of [...state.lessons, ...state.archivedLessons]) {
    assert.ok(exported.releases.some(r => r.lesson_key === `${lesson.id}:v${lesson.version}`));
  }
  // Review receipts are internal pipeline records; the browser cannot assert
  // that arbitrary content is source-reviewed and publish it through an API.
  assert.equal((await request("release", { reviewed: true })).status, 404);
});
test("source copies require owner access and repeat retrieval IDs read the saved result", async () => {
  const before = await (await request("state")).json();
  assert.ok(Array.isArray(before.sourceCaptures)); assert.equal(before.sourceAllowance.limit, 500);
  const id = crypto.randomUUID(), itemId = crypto.randomUUID();
  assert.equal((await fetch(`${base}/api/source?id=${id}`)).status, 401);
  assert.equal((await request(`source?id=${id}`)).status, 404);
  assert.equal((await request("source", { id, itemId }, { Origin: "https://unrelated.example" })).status, 403);
  assert.equal((await request("source", { id, itemId, url: "https://127.0.0.1/" })).status, 400);
  if (before.sourceCaptures.length) {
    const stored = before.sourceCaptures[0];
    const result = await request("source", { id: stored.id, itemId: stored.library_item_id });
    assert.equal(result.status, 200); assert.match(result.headers.get("cache-control"), /private.*no-store/);
    const { capture } = await result.json(); assert.deepEqual(capture, stored); assert.equal(Object.hasOwn(capture, "material"), false);
    const after = await (await request("state")).json();
    assert.equal(after.sourceCaptures.length, before.sourceCaptures.length);
    assert.equal(after.budget.committed, before.budget.committed);
  }
});
test("missing AI credentials are explicit and create no spending", async t => {
  const before = await (await request("state")).json();
  if (before.aiConfigured) { t.skip("AI configured: the HTTP verification suite never initiates paid calls."); return; }
  const response = await request("narrate", { key: "what-models-can-do:v1" });
  assert.equal(response.status, 503);
  const after = await (await request("state")).json();
  assert.equal(after.budget.committed, before.budget.committed);
});
test("question setup failures do not charge and recovery requires a valid owner request", async t => {
  const before = await (await request("state")).json();
  assert.equal((await request("recover", { token: "not-a-token" })).status, 400);
  assert.equal((await fetch(`${base}/api/recover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: crypto.randomUUID() }) })).status, 401);
  assert.equal((await request("state/unrecognized")).status, 404);
  if (before.aiConfigured) { t.skip("AI configured: never initiate paid calls from local HTTP tests."); return; }
  const response = await request("question", { id: crypto.randomUUID(), key: "what-models-can-do:v1", question: "Local verification: explain this lesson." });
  assert.equal(response.status, 503);
  const after = await (await request("state")).json();
  assert.equal(after.budget.committed, before.budget.committed);
  assert.equal(after.questions.length, before.questions.length);
  assert.ok(Array.isArray(after.spending));
});
test("question sources accept only bounded saved-copy IDs and export their original selection", async t => {
  const before = await (await request("state")).json(), baseQuestion = { id: crypto.randomUUID(), key: "what-models-can-do:v1", question: "Local verification: use source context." };
  const repeated = crypto.randomUUID();
  for (const invalid of [{ sourceCaptureIds: ["https://example.test/"] }, { sourceCaptureIds: [repeated, repeated] }, { sourceCaptureIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] }, { sourceText: "Client-supplied material is not inspected source text." }]) {
    assert.equal((await request("question", { ...baseQuestion, ...invalid })).status, 400);
  }
  const exported = await (await request("export")).json();
  for (const q of exported.questions) {
    assert.ok(Array.isArray(q.sourceCaptureIds));
    assert.deepEqual(q.sourceCaptureIds, before.questions.find(saved => saved.id === q.id).sourceCaptureIds);
  }
  if (before.aiConfigured) { t.skip("AI configured: never initiate paid calls from local HTTP tests."); return; }
  const copy = before.sourceCaptures.find(s => s.status === "retrieved");
  if (copy) assert.equal((await request("question", { ...baseQuestion, sourceCaptureIds: [copy.id] })).status, 503);
  const after = await (await request("state")).json();
  assert.equal(after.budget.committed, before.budget.committed); assert.equal(after.questions.length, before.questions.length);
});
test("topic research is private, input-bound and honest when secure AI setup is absent", async t => {
  const before = await (await request("state")).json(); assert.ok(Array.isArray(before.topicResearch)); assert.equal(before.researchAllowance.monthlyLimit, 40);
  const id = crypto.randomUUID(), topicId = crypto.randomUUID();
  assert.equal((await fetch(`${base}/api/research?id=${id}`)).status, 401);
  assert.equal((await request(`research?id=${id}`)).status, 404);
  assert.equal((await request("research", { id, topicId }, { Origin: "https://unrelated.example" })).status, 403);
  assert.equal((await request("research", { id, topicId, url: "https://unconnected.example/" })).status, 400);
  assert.equal((await request("research", { id, topicId })).status, 404);
  const exported = await (await request("export")).json(); assert.deepEqual(exported.topicResearch, before.topicResearch);
  if (before.aiConfigured) { t.skip("AI configured: HTTP checks never initiate a paid search."); return; }
  assert.equal((await request("library", { id: topicId, kind: "topic", title: "Local verification: research an AI pilot" })).status, 200);
  assert.equal((await request("research", { id, topicId })).status, 503);
  const after = await (await request("state")).json(); assert.equal(after.budget.committed, before.budget.committed); assert.equal(after.topicResearch.length, before.topicResearch.length);
});

test("lesson preparations stay private, export their checks and refuse client-supplied teaching or review", async t => {
  const before = await (await request("state")).json(), id = crypto.randomUUID(), topicId = crypto.randomUUID();
  assert.ok(Array.isArray(before.lessonPreparations)); assert.equal(before.preparationAllowance.monthlyLimit, 30);
  const body = { id, topicId, sourceCaptureIds: [crypto.randomUUID(), crypto.randomUUID()], stage: "inspect" };
  assert.equal((await fetch(`${base}/api/preparation?id=${id}`)).status, 401);
  assert.equal((await request(`preparation?id=${id}`)).status, 404);
  assert.equal((await request("preparation", body, { Origin: "https://unrelated.example" })).status, 403);
  for (const invalid of [{ review: { decision: "ready" } }, { sourceText: "Client supplied source text" }, { stage: "release" }, { sourceCaptureIds: [body.sourceCaptureIds[0], body.sourceCaptureIds[0]] }]) {
    assert.equal((await request("preparation", { ...body, ...invalid })).status, 400);
  }
  assert.equal((await request("preparation", body)).status, 404);
  const exported = await (await request("export")).json();
  assert.deepEqual(exported.lessonPreparations, before.lessonPreparations);
  for (const saved of before.lessonPreparations) {
    const result = await request(`preparation?id=${saved.id}`); assert.equal(result.status, 200);
    assert.match(result.headers.get("cache-control"), /private.*no-store/);
    const { preparation } = await result.json(); assert.deepEqual(preparation, saved);
    assert.equal(Object.hasOwn(preparation, "inputs"), false); assert.ok(preparation.sources.every(s => !Object.hasOwn(s, "context")));
  }
  if (before.aiConfigured) { t.skip("AI configured: local HTTP tests never start paid calls."); return; }
  assert.equal((await request("library", { id: topicId, kind: "topic", title: "Local verification: prepare a lesson" })).status, 200);
  assert.equal((await request("preparation", body)).status, 503);
  const after = await (await request("state")).json();
  assert.equal(after.lessonPreparations.length, before.lessonPreparations.length);
  assert.equal(after.budget.committed, before.budget.committed); assert.equal(after.lessons.length, before.lessons.length);
});
test("preparation release accepts only an owned saved preparation ID, never browser review claims", async () => {
  const id = crypto.randomUUID(), before = await (await request("state")).json();
  assert.equal((await fetch(`${base}/api/release-preparation`, { method: "POST", body: JSON.stringify({ id }), headers: { "Content-Type": "application/json" } })).status, 401);
  assert.equal((await request("release-preparation", { id }, { Origin: "https://unrelated.example" })).status, 403);
  for (const extra of [{ lesson: {} }, { review: { decision: "ready" } }, { sourceCaptureIds: [] }, { previousKey: null }]) assert.equal((await request("release-preparation", { id, ...extra })).status, 400);
  assert.equal((await request("release-preparation", { id })).status, 404);
  for (const saved of before.lessonPreparations.filter(p => !p.review || p.review.value.decision !== "ready")) {
    const result = await request("release-preparation", { id: saved.id }); assert.ok([409, 422].includes(result.status));
  }
  const after = await (await request("state")).json();
  assert.deepEqual(after.releases, before.releases); assert.deepEqual(after.budget, before.budget);
});
test("private transcription routes validate input and keep unsupported audio out of billing", async () => {
  const params = new URLSearchParams({ id: crypto.randomUUID(), key: "what-models-can-do:v1", purpose: "reflection" });
  const before = await (await request("state")).json();
  const anonymous = await fetch(`${base}/api/transcribe?${params}`, { method: "POST", body: "bad audio", headers: { "Content-Type": "audio/wav" } });
  assert.equal(anonymous.status, 401);
  assert.equal((await request(`transcribe?${params}`, {})).status, 415);
  const malformed = await fetch(`${base}/api/transcribe?${params}`, { method: "POST", headers: { ...headers, "Content-Type": "audio/wav" }, body: new Uint8Array(44) });
  assert.equal(malformed.status, 400);
  const missing = await request(`transcript?id=${crypto.randomUUID()}`); assert.equal(missing.status, 404);
  const after = await (await request("state")).json();
  assert.equal(after.budget.committed, before.budget.committed);
  assert.equal(after.voiceDrafts.length, before.voiceDrafts.length);
});
test("saved links reject executable URLs and mismatched retries", async () => {
  const malicious = await request("library", { id: crypto.randomUUID(), kind: "topic", title: "Local URL validation", url: "javascript:alert(1)" });
  assert.equal(malicious.status, 400);
  const body = { id: crypto.randomUUID(), kind: "source", title: "Local verification: Google PAIR", url: "https://pair.withgoogle.com/chapter/user-needs/", detail: "Local source save verification." };
  assert.equal((await request("library", body)).status, 200);
  assert.equal((await request("library", body)).status, 200);
  assert.equal((await request("library", { ...body, title: "Different content" })).status, 409);
});

test("question research is private, rejects browser-authored evidence and exports stable links without initiating AI", async () => {
  const before = await (await request("state")).json(); assert.ok(Array.isArray(before.questionResearch));
  const body = { id: crypto.randomUUID(), stage: "research" };
  assert.equal((await fetch(`${base}/api/research-question`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })).status, 401);
  assert.equal((await request("research-question", body, { Origin: "https://unrelated.example" })).status, 403);
  for (const extra of [{ stage: "publish" }, { userId: "other" }, { question: "Client replacement" }, { answerId: crypto.randomUUID() }, { sourceCaptureIds: [] }, { researchQuestionId: crypto.randomUUID() }]) assert.equal((await request("research-question", { ...body, ...extra })).status, 400);
  assert.equal((await request("research-question", body)).status, 404);
  if (!before.aiConfigured) {
    const gap = before.questions.find(q => q.answer?.needsResearch && !before.questionResearch.some(r => r.question_id === q.id || r.answer_id === q.id));
    if (gap) assert.equal((await request("research-question", { id: gap.id, stage: "research" })).status, 503);
  }
  for (const link of before.questionResearch) {
    const q = before.questions.find(q => q.id === link.question_id); assert.ok(q); assert.equal(link.question, q.question); assert.equal(link.lesson_key, q.lesson_key);
    assert.equal(Object.hasOwn(link, "user_id"), false); assert.equal(Object.hasOwn(link, "answer"), false);
    if (link.sourceCaptureIds) assert.equal((await request("question", { id: link.answer_id, key: link.lesson_key, question: link.question, sourceCaptureIds: link.sourceCaptureIds })).status, 409);
  }
  const exported = await request("export"); assert.match(exported.headers.get("cache-control"), /private.*no-store/);
  const after = await exported.json(); assert.deepEqual(after.questionResearch, before.questionResearch); assert.deepEqual(after.questions, before.questions); assert.deepEqual(after.spending, before.spending);
});
