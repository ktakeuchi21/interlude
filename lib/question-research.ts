import { z } from "zod";
import { AppError } from "./errors";
import { withGenerationLock } from "./jobs";
import { researchTopic, getTopicResearch, MAX_RESEARCH_RUNS } from "./topic-research";
import { answerQuestion, questionFromRow } from "./questions";
import { questionGrounding } from "./question-grounding";
import type { Lesson } from "./content";
import type { QuestionResearch, Question, TopicResearch } from "./contracts";

export const questionResearchRequest = z.object({ id: z.string().uuid(), stage: z.enum(["research", "answer"]) }).strict();
export type QuestionResearchRow = QuestionResearch & { user_id: string; source_capture_ids: string | null };
export function questionResearchFromRow(row: QuestionResearchRow): QuestionResearch {
  return { question_id: row.question_id, lesson_key: row.lesson_key, question: row.question, topic_id: row.topic_id, research_id: row.research_id, answer_id: row.answer_id, sourceCaptureIds: row.source_capture_ids ? JSON.parse(row.source_capture_ids) : null, created_at: row.created_at };
}

/** Two resumable stages; neither may silently replace the original answer. */
export async function researchQuestion(db: D1Database, userId: string, raw: z.input<typeof questionResearchRequest>, services: { apiKey?: string; fetch?: typeof fetch } = {}) {
  const data = questionResearchRequest.parse(raw);
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId) throw new AppError("Only the owner can research a learning question.", 403);
  const originalRow = await db.prepare("SELECT * FROM questions WHERE id=? AND user_id=?").bind(data.id, userId).first<Parameters<typeof questionFromRow>[0]>();
  if (!originalRow) throw new AppError("That saved question was not found.", 404);
  const original = questionFromRow(originalRow);
  const lessonRow = await db.prepare("SELECT content FROM lesson_versions WHERE key=? AND status='ready'").bind(original.lesson_key).first<{ content: string }>();
  if (!lessonRow) throw new AppError("The original lesson version is unavailable.", 409);
  const lesson: Lesson = JSON.parse(lessonRow.content);
  async function existing() {
    const row = await db.prepare("SELECT * FROM question_research WHERE question_id=?").bind(data.id).first<QuestionResearchRow>();
    if (row && (row.user_id !== userId || row.lesson_key !== original.lesson_key || row.question !== original.question)) throw new AppError("This research no longer matches the original question.", 409);
    return row ? questionResearchFromRow(row) : null;
  }
  let link = await existing();
  if (!link) {
    if (data.stage !== "research") throw new AppError("Research this question before preparing its updated answer.", 409);
    if (!original.answer?.needsResearch) throw new AppError("This question has no saved evidence gap to research.", 409);
    if (await db.prepare("SELECT question_id FROM question_research WHERE answer_id=?").bind(data.id).first()) throw new AppError("This question already has a bounded research attempt. Ask a new question to explore further.", 409);
    if (!services.apiKey) throw new AppError("Question research is awaiting secure AI setup. Your original answer is saved.", 503);
    link = await withGenerationLock(db, `question-research:${data.id}`, async claim => {
      const repeated = await existing(); if (repeated) return repeated;
      const capacity = await db.prepare("SELECT COUNT(*) AS n FROM library_items WHERE user_id=?").bind(userId).first<{ n: number }>();
      if ((capacity?.n ?? 0) >= 1000) throw new AppError("The saved-interest allowance is full. Your original question remains available.", 402);
      const next = { question_id: data.id, lesson_key: original.lesson_key, question: original.question, topic_id: crypto.randomUUID(), research_id: crypto.randomUUID(), answer_id: crypto.randomUUID(), sourceCaptureIds: null, created_at: Date.now() };
      await claim.assertActive();
      const inserted = await db.prepare(`INSERT OR IGNORE INTO question_research(question_id,user_id,lesson_key,question,topic_id,research_id,answer_id,created_at)
        SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM question_research)<?`).bind(data.id, userId, next.lesson_key, next.question, next.topic_id, next.research_id, next.answer_id, next.created_at, MAX_RESEARCH_RUNS).run();
      if (inserted.meta.changes !== 1) throw new AppError("The retained question-research allowance is full. Saved answers remain available.", 402);
      return next;
    });
  }
  const title = `Follow-up: ${lesson.title}`.slice(0, 200);
  // A crash between these durable writes can recover the same topic and IDs.
  await db.prepare("INSERT OR IGNORE INTO library_items(id,user_id,kind,title,detail,status,created_at) VALUES(?,?,'topic',?,?,'awaiting research',?)").bind(link.topic_id, userId, title, link.question, link.created_at).run();
  const topic = await db.prepare("SELECT user_id,kind,title,detail FROM library_items WHERE id=?").bind(link.topic_id).first<{ user_id: string; kind: string; title: string; detail: string }>();
  if (!topic || topic.user_id !== userId || topic.kind !== "topic" || topic.title !== title || topic.detail !== link.question) throw new AppError("The research topic no longer matches its original question.", 409);

  let research: TopicResearch;
  if (data.stage === "research") research = await researchTopic(db, userId, { id: link.research_id, topicId: link.topic_id }, services);
  else {
    research = await getTopicResearch(db, userId, link.research_id);
    if (!research.search) throw new AppError("This question needs a completed search before an updated answer.", 409);
    // Recover original search accounting before another paid stage. This call
    // cannot repeat a saved search and uses the same source-copy IDs.
    research = await researchTopic(db, userId, { id: link.research_id, topicId: link.topic_id }, { fetch: services.fetch });
  }
  let answer: Question | null = null;
  if (data.stage === "answer") {
    if (!research.search?.candidates.length) throw new AppError("The search found no suitable pages. Your original answer and the evidence gap remain saved.", 422);
    if (!link.sourceCaptureIds) {
      const sourceIds: string[] = [];
      for (const candidate of research.search.candidates) {
        const copy = await db.prepare("SELECT user_id,library_item_id,requested_url,status FROM source_captures WHERE id=?").bind(candidate.captureId).first<{ user_id: string; library_item_id: string; requested_url: string; status: string }>();
        if (!copy || copy.user_id !== userId || copy.library_item_id !== candidate.itemId || copy.requested_url !== candidate.url) throw new AppError("A research source no longer matches this question.", 409);
        if (copy.status === "retrieving") throw new AppError("A source retrieval is still unresolved. Its saved attempt will not be repeated automatically.", 409);
        if (copy.status === "retrieved") sourceIds.push(candidate.captureId);
      }
      if (!sourceIds.length) throw new AppError("The selected pages could not be read. No updated answer was requested; your original answer remains saved.", 422);
      sourceIds.sort();
      const grounding = await questionGrounding(db, userId, sourceIds);
      if (grounding.copies.some(c => c.retrievedAt < link!.created_at)) throw new AppError("Research needs source copies retrieved after this question's research began.", 409);
      await db.prepare("UPDATE question_research SET source_capture_ids=? WHERE question_id=? AND user_id=? AND source_capture_ids IS NULL").bind(JSON.stringify(sourceIds), data.id, userId).run();
      link = (await existing())!;
    }
    answer = await answerQuestion(db, userId, lesson, { id: link.answer_id, question: link.question, sourceCaptureIds: link.sourceCaptureIds! }, { ...services, researchQuestionId: data.id });
  }
  return { link, research, answer };
}
