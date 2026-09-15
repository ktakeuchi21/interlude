import { z } from "zod";
import { AppError } from "./errors";
import { settleSpend } from "./budget";
import { preparationFromRow, type PreparationRow } from "./lesson-preparation";
import { candidateLesson, checkInspection, checkDraft, checkReview, type PreparationInputs } from "./preparation-content";
import { appendReviewedLessonVersion, lessonContentHash } from "./lesson-release";
import { capturedMaterial } from "./source-capture";
import { sourceContext } from "./question-grounding";
import { validateRefreshContext } from "./lesson-refresh";

/** No provider call: derive the release only from this owner's immutable results. */
export async function releasePreparedLesson(db: D1Database, userId: string, preparationId: string, now = Date.now()) {
  const id = z.string().uuid().parse(preparationId);
  const row = await db.prepare("SELECT * FROM lesson_preparations WHERE id=? AND user_id=?").bind(id, userId).first<PreparationRow>();
  if (!row) throw new AppError("That lesson preparation was not found.", 404);
  const saved = preparationFromRow(row), inputs: PreparationInputs = JSON.parse(row.inputs);
  if (inputs.refresh) await validateRefreshContext(db, inputs.refresh, false);
  if (!saved.inspection || !saved.draft || !saved.review) throw new AppError("Finish the source inspection, draft, and teaching review before adding this lesson.", 409);
  if (saved.inspection.completedAt > saved.draft.completedAt || saved.draft.completedAt > saved.review.completedAt || saved.review.completedAt > now) throw new AppError("The preparation's review dates need checking before release.", 409);
  const inspection = checkInspection(saved.inspection.value, inputs);
  if (!inspection.sufficient) throw new AppError("This preparation needs more source material before release.", 422);
  const draft = checkDraft(saved.draft.value, id, inputs, inspection, saved.inspection.completedAt);
  const review = checkReview(saved.review.value, draft, inputs);
  if (review.decision !== "ready") throw new AppError("This draft still has unresolved review issues. Prepare a checked draft before adding it to your library.", 422);
  for (const source of inputs.sources) {
    const copy = await capturedMaterial(db, userId, source.snapshotId);
    if (copy.hash !== source.hash || copy.finalUrl !== source.finalUrl || sourceContext(copy.text).text !== source.context) throw new AppError("The retained sources no longer match this preparation. Nothing was released.", 409);
    if (inputs.refresh && copy.retrievedAt < inputs.refresh.requestedAt) throw new AppError("This update was not checked against newly retrieved source copies.", 409);
  }
  // A saved result can recover an interrupted settlement without a new paid call.
  // Missing, replaced, or flagged accounting cannot be bypassed by releasing it.
  for (const [stage, result] of [["inspect", saved.inspection], ["draft", saved.draft], ["review", saved.review]] as const) {
    await settleSpend(db, `lesson:${id}:${stage}`, result.cost, result.providerRequest, JSON.stringify({ preparationId: id, stage, requestHash: result.requestHash, basis: result.costBasis }));
  }
  const lesson = candidateLesson(id, inputs, inspection, draft, saved.inspection.completedAt);
  // The deterministic version key is the release binding. The atomic insert is
  // safe to repeat after a lost response and never needs a second mutable status.
  return appendReviewedLessonVersion(db, lesson, {
    userId, previousKey: inputs.refresh?.key ?? null, summary: inputs.refresh ? review.updateCheck!.summary : "Initial lesson prepared from your requested topic and retained sources.",
    review: { method: "automated", preparationId: id, checkedAt: saved.review.completedAt, contentHash: await lessonContentHash(lesson), summary: review.summary,
      sourceChecks: inputs.sources.map(source => ({ id: source.id, url: source.finalUrl, inspected: new Date(saved.inspection!.completedAt).toISOString().slice(0, 10), materialHash: source.hash, snapshotId: source.snapshotId })),
    },
  }, now);
}
