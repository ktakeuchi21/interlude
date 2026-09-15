"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client";
import type { AppState, Question, TopicResearch } from "@/lib/contracts";

export function QuestionResearchPanel({ question, state, refresh, onNewQuestion, draftDisabled }: { question: Question; state: AppState; refresh: () => Promise<AppState>; onNewQuestion: () => void; draftDisabled: boolean }) {
  const [busy, setBusy] = useState(false), [phase, setPhase] = useState(""), [error, setError] = useState("");
  const link = state.questionResearch.find(r => r.question_id === question.id);
  const research = link && state.topicResearch.find(r => r.id === link.research_id);
  const answer = link && state.questions.find(q => q.id === link.answer_id);
  const canPay = state.aiConfigured && !state.budget.paused && state.budget.committed < state.budget.limit;
  const heldSearch = link && !research?.search && state.spending.some(s => s.id === `research:${link.research_id}`);
  const heldAnswer = link && !answer?.answer && state.spending.some(s => s.id === `question:${link.answer_id}`);
  async function continueResearch() {
    setBusy(true); setError("");
    try {
      setPhase(research?.search || heldSearch ? "Checking saved research…" : "Finding source pages…");
      const saved = await api<{ research: TopicResearch }>("research-question", { id: question.id, stage: "research" });
      await refresh();
      if (saved.research.search?.candidates.length) {
        setPhase(heldAnswer ? "Checking saved answer…" : "Answering from retrieved pages…");
        await api("research-question", { id: question.id, stage: "answer" });
        await refresh();
      }
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); setPhase(""); }
  }
  if (!question.answer?.needsResearch || state.questionResearch.some(r => r.answer_id === question.id)) return null;
  return <div className="question-research">
    {answer?.answer ? <a className="text-link" href={`#question-${answer.id}`}>Read the researched answer</a> : <>
      <p className="small muted">Find up to two public pages, then prepare a separate answer from readable source copies. Your original answer stays saved. Uses your shared AI allowance; interrupted paid requests are not repeated.</p>
      <Button variant="outline" disabled={busy || (!canPay && !link)} onClick={() => void continueResearch()}>{busy ? phase : heldAnswer ? "Check saved researched answer" : heldSearch ? "Check saved research" : research?.search ? "Continue researched answer" : "Research and answer"}</Button>
      {!canPay && !link && <p className="small muted">New research is waiting for AI setup or available allowance.</p>}
      {(heldSearch || heldAnswer) && <><p className="small muted">The interrupted attempt and its costs stay saved. You can edit a new question and submit it deliberately; that starts separate paid work.</p><Button variant="ghost" disabled={busy || draftDisabled} onClick={onNewQuestion}>Draft a new question</Button></>}
    </>}
    {research?.search && <p className="small muted">Searched {new Date(research.search.searchedAt).toLocaleDateString()} · {research.search.candidates.length} selected {research.search.candidates.length === 1 ? "page" : "pages"}. {research.search.gap}{!research.search.candidates.length ? " No new answer was requested." : ""}</p>}
    {(error || research?.error) && <p className="question-error" role="alert">{error || research?.error}</p>}
    {link && <a className="text-link" href={`/?view=library#saved-interest-${link.topic_id}`}>View saved research and sources</a>}
    {busy && <p className="small" role="status">{phase}</p>}
  </div>;
}
