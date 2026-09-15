import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

// Offline selection only: no API calls, provider credentials, or publication.
// Input: { ownerId, now?, state: { lessons?, archivedLessons?, progress, events,
// coursePreferences?, libraryItems, weekly:{batches,choices}, planDeliveries? } }.
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/prepare-plan-week.mjs <owner-state.json> <publication.json>");
const result = await build({ stdin: { contents: 'export { courses, seedLessons } from "./lib/content"; export { selectWeekly, learningWeek } from "./lib/weekly-selection"; export { selectRefreshLesson } from "./lib/weekly-refresh";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const { courses, seedLessons, selectWeekly, learningWeek, selectRefreshLesson } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const input = JSON.parse(await readFile(inputPath, "utf8")), now = input.now ?? Date.now(), state = input.state;
if (typeof input.ownerId !== "string" || !input.ownerId || !state || !Array.isArray(state.progress) || !Array.isArray(state.events) || !Array.isArray(state.libraryItems)) throw new Error("Complete owner state is required.");
const week = learningWeek(now), context = { lessons: state.lessons ?? seedLessons, archivedLessons: state.archivedLessons ?? [], progress: state.progress, events: state.events, libraryItems: state.libraryItems, coursePreferences: state.coursePreferences ?? courses.map(c => ({ id: c.id, active: true })) };
const history = state.weekly?.batches ?? [], choices = state.weekly?.choices ?? [];
const priorChecks = (state.planDeliveries ?? []).flatMap(p => (p.checks ?? []).map(c => ({ lesson_key: c.lessonKey, created_at: c.checkedAt })));
const due = selectRefreshLesson(context.lessons, context.coursePreferences, [...priorChecks, ...(state.weeklyRefresh?.history ?? [])], now);
const existing = history.find(b => b.week === week);
const publication = { ownerId: input.ownerId, week, preparedAt: now, summary: due ? `Suggestions prepared. ${due.title} is due for source review; finish that review before publishing this record.` : "Weekly suggestions are ready. All active course lessons were reviewed within the past four weeks, so no lesson update is due.", checks: [], batch: { week, origin: "scheduled", items: existing?.items ?? selectWeekly(context, history, choices, now), created_at: now } };
await writeFile(outputPath, JSON.stringify(publication, null, 2) + "\n");
console.log(JSON.stringify({ week, suggestions: publication.batch.items.map(i => ({ kind: i.kind, title: i.title })), dueLesson: due ? { key: `${due.id}:v${due.version}`, title: due.title, sources: due.sources } : null, output: outputPath }));
