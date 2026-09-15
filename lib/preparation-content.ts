import { z } from "zod";
import { narrationText, type Lesson } from "./content";
import { AppError } from "./errors";
import type { SourceMaterial } from "./contracts";
import type { RefreshContext } from "./lesson-refresh";

const text = (max: number) => z.string().trim().min(1).max(max);
const sourceId = z.enum(["source-1", "source-2"]);
export type PreparationSource = SourceMaterial & { snapshotId: string; id: string; context: string; partialContext: boolean };
export type PreparationInputs = { title: string; detail: string; sources: PreparationSource[]; refresh?: RefreshContext };
const updateInspectionSchema = z.object({ decision: z.enum(["update", "unchanged", "needs_sources"]), summary: text(1200), changes: z.array(z.object({ priorQuote: text(250), reason: text(500), support: z.array(z.object({ sourceId, claimIndex: z.number().int().min(0).max(2) }).strict()).min(1).max(2) }).strict()).max(4) }).strict();
const updateReviewSchema = z.object({ materialChange: z.boolean(), objectivePreserved: z.boolean(), changesSupported: z.boolean(), summary: text(1200) }).strict();
export const inspectionSchema = z.object({
  sufficient: z.boolean(), reason: text(800),
  sources: z.array(z.object({ id: sourceId, usable: z.boolean(), summary: text(600), limitations: text(600),
    claims: z.array(z.object({ claim: text(400), quote: text(250) }).strict()).max(3),
  }).strict()).length(2), update: updateInspectionSchema.optional(),
}).strict();
export const draftSchema = z.object({
  title: text(180), objective: text(700),
  sections: z.array(z.object({ title: text(180), paragraphs: z.array(text(2400)).min(1).max(4), sources: z.array(sourceId).max(2) }).strict()).min(3).max(6),
  takeaway: text(700), reflection: text(700), challenge: text(1000),
  quiz: z.object({ question: text(700), options: z.array(text(400)).min(2).max(4), answer: z.number().int().nonnegative(), explanation: text(1000) }).strict(),
}).strict();
export const reviewSchema = z.object({
  decision: z.enum(["ready", "revise", "needs_sources"]), summary: text(1200),
  checks: z.array(z.object({ unit: text(40), acceptable: z.boolean(), sourceIds: z.array(sourceId).max(2), reason: text(400) }).strict()).min(8).max(11),
  quality: z.object({ sourceSupport: z.boolean(), coherent: z.boolean(), audioFriendly: z.boolean(), quizCorrect: z.boolean(), practical: z.boolean(), attribution: z.boolean(), healthcareBoundaries: z.boolean() }).strict(), updateCheck: updateReviewSchema.optional(),
}).strict();
export type SourceInspection = z.infer<typeof inspectionSchema>;
export type LessonDraft = z.infer<typeof draftSchema>;
export type PreparationReview = z.infer<typeof reviewSchema>;
export const reviewUnits = (draft: LessonDraft) => ["objective", ...draft.sections.map((_, index) => `section-${index + 1}`), "takeaway", "reflection", "challenge", "quiz"];
const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();

export function checkInspection(value: unknown, inputs: PreparationInputs) {
  const result = inspectionSchema.parse(value);
  if (new Set(result.sources.map(s => s.id)).size !== 2) throw new AppError("The source inspection omitted or repeated a page.", 502);
  for (const source of result.sources) {
    const original = inputs.sources.find(s => s.id === source.id);
    if (!original || source.usable && !source.claims.length) throw new AppError("A usable source needs explicit claim support.", 502);
    for (const evidence of source.claims) {
      const quote = normalize(evidence.quote);
      if (quote.length < 12 || quote.split(" ").length > 20 || !normalize(original.context).includes(quote)) throw new AppError("Source inspection quoted text outside the supplied copy. No draft was created.", 502);
    }
  }
  if (result.sufficient && result.sources.some(s => !s.usable)) throw new AppError("The inspection needs two usable source pages before drafting.", 502);
  if (inputs.refresh) {
    const update = result.update;
    if (!update || !result.sufficient && update.decision !== "needs_sources" || update.decision === "update" && (!result.sufficient || !update.changes.length) || update.decision !== "update" && update.changes.length) throw new AppError("The update inspection needs a consistent material-change decision.", 502);
    const prior = normalize(narrationText(inputs.refresh.lesson));
    for (const change of update.changes) {
      const quote = normalize(change.priorQuote);
      if (quote.length < 12 || quote.split(" ").length > 20 || !prior.includes(quote) || change.support.some(s => !result.sources.find(source => source.id === s.sourceId && source.usable)?.claims[s.claimIndex])) throw new AppError("The proposed update must identify original teaching and supported inspected claims.", 502);
    }
  } else if (result.update) throw new AppError("An update assessment needs an original lesson.", 502);
  return result;
}

export function candidateLesson(id: string, inputs: PreparationInputs, inspection: SourceInspection, draft: LessonDraft, inspectedAt: number): Lesson {
  const prior = inputs.refresh?.lesson;
  return { ...draft, id: prior?.id ?? `topic-${id}`, version: prior ? prior.version + 1 : 1, courseId: prior?.courseId ?? "standalone", order: prior?.order ?? 1, minutes: 5,
    sources: inputs.sources.map(source => ({ id: source.id, title: source.title, publisher: source.publisher, url: source.finalUrl, published: source.published,
      inspected: new Date(inspectedAt).toISOString().slice(0, 10), supports: inspection.sources.find(s => s.id === source.id)!.claims.map(c => c.claim).join(" "),
    })), review: "AI-generated teaching. Automated source and teaching checks are recorded separately; no expert review is claimed.",
  };
}

export function checkDraft(value: unknown, id: string, inputs: PreparationInputs, inspection: SourceInspection, inspectedAt: number) {
  const draft = draftSchema.parse(value), lesson = candidateLesson(id, inputs, inspection, draft, inspectedAt), script = narrationText(lesson);
  if (inputs.refresh) {
    if (inspection.update?.decision !== "update") throw new AppError("No supported material update was identified. The current lesson stays available.", 409);
    if (draft.objective !== inputs.refresh.lesson.objective) throw new AppError("An update must preserve the original learning objective.", 502);
    const teaching = (value: Pick<Lesson, "sections" | "takeaway">) => JSON.stringify({ sections: value.sections.map(s => ({ title: s.title, paragraphs: s.paragraphs })), takeaway: value.takeaway });
    if (teaching(draft) === teaching(inputs.refresh.lesson)) throw new AppError("The draft did not change the teaching. A new version is unnecessary.", 502);
  }
  const words = script.trim().split(/\s+/u).length;
  if (words < 600 || words > 800 || script.length > 8000) throw new AppError("The draft did not fit a substantive five-minute lesson. It remains unavailable for learning.", 502);
  if (draft.quiz.answer >= draft.quiz.options.length || new Set(draft.quiz.options.map(normalize)).size !== draft.quiz.options.length) throw new AppError("The draft's recall question needs valid, distinct choices.", 502);
  if (inputs.sources.some(s => !draft.sections.some(section => section.sources.includes(s.id as "source-1" | "source-2"))) || draft.sections.some(s => new Set(s.sources).size !== s.sources.length)) throw new AppError("The draft needs clear citations to both inspected sources.", 502);
  return draft;
}

export function checkReview(value: unknown, draft: LessonDraft, inputs?: PreparationInputs) {
  const review = reviewSchema.parse(value), units = reviewUnits(draft);
  if (review.checks.length !== units.length || new Set(review.checks.map(c => c.unit)).size !== units.length || review.checks.some(c => !units.includes(c.unit) || new Set(c.sourceIds).size !== c.sourceIds.length)) throw new AppError("The review did not cover every teaching and practice item.", 502);
  for (const [index, section] of draft.sections.entries()) {
    const check = review.checks.find(c => c.unit === `section-${index + 1}`)!;
    if (section.sources.some(id => !check.sourceIds.includes(id))) throw new AppError("The review did not evaluate each section's cited sources.", 502);
  }
  if (review.decision === "ready" && (review.checks.some(c => !c.acceptable) || Object.values(review.quality).some(ok => !ok))) throw new AppError("The review reported unresolved issues and cannot mark this draft ready.", 502);
  if (inputs?.refresh) {
    if (!review.updateCheck || review.decision === "ready" && (!review.updateCheck.materialChange || !review.updateCheck.objectivePreserved || !review.updateCheck.changesSupported)) throw new AppError("The update needs an independent check of material change, objective, and source support.", 502);
  } else if (review.updateCheck) throw new AppError("An update review needs its original lesson.", 502);
  return review;
}

// The provider schema is deliberately simple. Runtime Zod/semantic checks above
// enforce bounds and relationships independently of schema-constrained output.
const string = { type: "string" }, boolean = { type: "boolean" }, ids = { type: "array", items: { type: "string", enum: ["source-1", "source-2"] } };
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: unknown) => ({ type: "array", items });
export const preparationFormats = {
  inspect: object({ sufficient: boolean, reason: string, sources: array(object({ id: { type: "string", enum: ["source-1", "source-2"] }, usable: boolean, summary: string, limitations: string, claims: array(object({ claim: string, quote: string })) })) }),
  draft: object({ title: string, objective: string, sections: array(object({ title: string, paragraphs: array(string), sources: ids })), takeaway: string, reflection: string, challenge: string, quiz: object({ question: string, options: array(string), answer: { type: "integer" }, explanation: string }) }),
  review: object({ decision: { type: "string", enum: ["ready", "revise", "needs_sources"] }, summary: string, checks: array(object({ unit: string, acceptable: boolean, sourceIds: ids, reason: string })), quality: object({ sourceSupport: boolean, coherent: boolean, audioFriendly: boolean, quizCorrect: boolean, practical: boolean, attribution: boolean, healthcareBoundaries: boolean }) }),
};
export const refreshFormats = {
  inspect: object({ ...preparationFormats.inspect.properties, update: object({ decision: { type: "string", enum: ["update", "unchanged", "needs_sources"] }, summary: string, changes: array(object({ priorQuote: string, reason: string, support: array(object({ sourceId: { type: "string", enum: ["source-1", "source-2"] }, claimIndex: { type: "integer" } })) })) }) }),
  draft: preparationFormats.draft,
  review: object({ ...preparationFormats.review.properties, updateCheck: object({ materialChange: boolean, objectivePreserved: boolean, changesSupported: boolean, summary: string }) }),
};
