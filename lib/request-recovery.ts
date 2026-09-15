import { z } from "zod";
import { AppError } from "./errors";
import { withGenerationLock } from "./jobs";
import { recoverSavedQuestion } from "./questions";
import { recoverSavedResearch } from "./topic-research";
import { recoverSavedPreparation } from "./lesson-preparation";
import { getVoiceDraft } from "./transcription";

export const recoverRequestInput = z.object({ spendingId: z.string().min(1).max(200) }).strict();
export type SavedRequestCheck = { available: boolean; href: string; label: string };
/** No API key or provider dependency is accepted: this operation only reads saved output and repairs its accounting. */
export async function recoverSavedRequest(db: D1Database, userId: string, raw: unknown): Promise<SavedRequestCheck> {
  const { spendingId } = recoverRequestInput.parse(raw);
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId) throw new AppError("Only the owner can check saved requests.", 403);
  const spend = await db.prepare("SELECT kind FROM spending WHERE id=?").bind(spendingId).first<{ kind: string }>();
  if (!spend) throw new AppError("That recorded request was not found.", 404);
  const match = /^(question|research|transcribe|lesson):([^:]+)(?::(inspect|draft|review))?$/.exec(spendingId);
  if (!match || !z.string().uuid().safeParse(match[2]).success || (match[1] === "lesson") !== Boolean(match[3])) throw new AppError("Use the narration recovery controls for audio, or inspect this request's original operation.", 409);
  const [, kind, id, stage] = match;
  const expected = kind === "question" ? "lesson question" : kind === "research" ? "topic research" : kind === "transcribe" ? "voice transcription" : `lesson ${stage}`;
  if (spend.kind !== expected) throw new AppError("This request's saved identity needs inspection. Its cost was retained.", 409);
  return withGenerationLock(db, `check-saved:${spendingId}`, async claim => {
    await claim.assertActive();
    if (kind === "question") {
      const question = await recoverSavedQuestion(db, userId, id);
      return { available: Boolean(question.answer), href: `/?lesson=${encodeURIComponent(question.lesson_key)}#question-${id}`, label: "Open saved question" };
    }
    if (kind === "transcribe") {
      const draft = await getVoiceDraft(db, userId, id);
      return { available: Boolean(draft.result), href: `/?lesson=${encodeURIComponent(draft.lesson_key)}`, label: "Open lesson and voice drafts" };
    }
    if (kind === "research") {
      const research = await recoverSavedResearch(db, userId, id);
      return { available: Boolean(research.search), href: `/?view=library#saved-interest-${research.topic_id}`, label: "Open saved research" };
    }
    const preparation = await recoverSavedPreparation(db, userId, id);
    return { available: Boolean(preparation[stage === "inspect" ? "inspection" : stage as "draft" | "review"]), href: `/?view=library#saved-interest-${preparation.topic_id}`, label: "Open lesson preparation" };
  });
}
