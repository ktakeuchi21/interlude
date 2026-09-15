"use client";
import { useRef, useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { api } from "@/lib/client";
import { lessonKey, type Lesson } from "@/lib/content";
import type { AppState } from "@/lib/contracts";
import { QuestionResearchPanel } from "./question-research";
import { SpokenInput } from "./spoken-input";

export function LessonQuestions({ lesson, state, refresh }: { lesson: Lesson; state: AppState; refresh: () => Promise<AppState> }) {
  const key = lessonKey(lesson), draftKey = `interlude-question:${key}`;
  const questionInput = useRef<HTMLTextAreaElement>(null);
  // This keyed panel mounts after the client library request has completed.
  const [draft, setDraft] = useState(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null"); if (typeof saved?.text === "string" && typeof saved?.id === "string") return { text: saved.text as string, id: saved.id as string, sourceCaptureIds: Array.isArray(saved.sourceCaptureIds) ? saved.sourceCaptureIds.filter((s: unknown): s is string => typeof s === "string").slice(0, 2) as string[] : [] }; } catch { /* Typing works even when storage is unavailable. */ }
    return { text: "", id: crypto.randomUUID(), sourceCaptureIds: [] as string[] };
  });
  const { text, id, sourceCaptureIds } = draft;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [checkNotice, setCheckNotice] = useState("");
  function edit(value: string, sources = sourceCaptureIds) {
    const next = { text: value, id: crypto.randomUUID(), sourceCaptureIds: [...sources].sort() }; setDraft(next); setError(""); setCheckNotice("");
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* Keep the current draft in memory. */ }
  }
  async function ask(questionId = id, questionText = text, questionSources = sourceCaptureIds) {
    setBusy(true); setError("");
    try {
      await api("question", { id: questionId, key, question: questionText, sourceCaptureIds: questionSources });
      if (questionId === id) { setDraft({ text: "", id: crypto.randomUUID(), sourceCaptureIds: [] }); try { sessionStorage.removeItem(draftKey); } catch {} }
      await refresh();
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  const history = state.questions.filter(q => q.lesson_key === key);
  async function checkSaved(questionId: string) {
    setBusy(true); setError(""); setCheckNotice("");
    try {
      const result = await api<{ check: { available: boolean } }>("check-saved-request", { spendingId: `question:${questionId}` });
      await refresh(); setCheckNotice(result.check.available ? "The saved answer is available. No new AI request was sent." : "No completed answer is saved yet. Its existing cost was retained; no new AI request was sent.");
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  // Show the newest copy of each page, while preserving a deliberately selected
  // older copy through retrievals on this or another device.
  const available = [...state.sourceCaptures].filter(s => s.status === "retrieved" && s.result).sort((a, b) => b.created_at - a.created_at);
  const sourceChoices = new Map<string, typeof available[number]>();
  for (const copy of available) if (!sourceChoices.has(copy.library_item_id) || sourceCaptureIds.includes(copy.id)) sourceChoices.set(copy.library_item_id, copy);
  const missingSelection = sourceCaptureIds.some(id => !available.some(s => s.id === id));
  const configured = state.aiConfigured && !state.budget.paused;
  return <section className="practice question-panel" aria-labelledby="question-heading">
    <p className="eyebrow">TAKE THE IDEA FURTHER · OPTIONAL</p><h2 id="question-heading">Ask about this lesson</h2>
    <p className="muted small">A short AI answer using this lesson and any retrieved pages you choose. When evidence is missing, you can research the question and keep a separate answer with dated sources.</p>
    <label htmlFor="lesson-question" className="small">Your question</label><Textarea ref={questionInput} id="lesson-question" value={text} onChange={e => edit(e.target.value)} disabled={busy} maxLength={2000} placeholder="How would I apply this in my work?" />
    <details className="question-source-picker"><summary>Include retrieved sources{sourceCaptureIds.length ? ` · ${sourceCaptureIds.length} selected` : " · optional"}</summary>
      <p id="question-source-help" className="small muted">Choose up to two pages retrieved in Your library. Answers use a limited excerpt of each page and retain that copy’s date. This does not run a new web search.</p>
      {sourceChoices.size ? <fieldset aria-describedby="question-source-help" disabled={busy}><legend className="small">Sources for this question ({sourceCaptureIds.length}/2)</legend><div className="question-source-options">{[...sourceChoices.values()].map(copy => <label className="question-source-choice" key={copy.id}>
        <Checkbox checked={sourceCaptureIds.includes(copy.id)} disabled={busy || (!sourceCaptureIds.includes(copy.id) && sourceCaptureIds.length >= 2)} onCheckedChange={checked => edit(text, checked === true ? [...sourceCaptureIds, copy.id] : sourceCaptureIds.filter(id => id !== copy.id))} />
        <span><strong>{copy.result!.title}</strong><span className="small muted">{copy.result!.publisher} · retrieved {new Date(copy.result!.retrievedAt).toLocaleDateString()}</span></span>
      </label>)}</div></fieldset> : <p className="small muted">Save and retrieve a public source in Your library to include it here.</p>}
      {missingSelection && <p className="question-error" role="alert">A selected source is no longer available. <Button variant="outline" size="sm" disabled={busy} onClick={() => edit(text, sourceCaptureIds.filter(id => available.some(s => s.id === id)))}>Remove unavailable sources</Button></p>}
    </details>
    <Button disabled={!configured || !text.trim() || !id || busy || missingSelection} onClick={() => void ask()}>{busy ? "Thinking…" : "Ask question"}</Button>
    <SpokenInput lessonKey={key} purpose="question" state={state} disabled={busy} maxLength={2000} refresh={refresh} onText={spoken => {
      const combined = [text.trim(), spoken].filter(Boolean).join("\n");
      if (combined.length > 2000) throw new Error("Shorten your typed question or transcript so the combined draft fits 2,000 characters.");
      edit(combined);
    }} />
    {!state.aiConfigured && <p className="small muted">Answers are awaiting secure AI setup. You can draft a question here.</p>}
    {state.budget.paused && <p className="small muted">New AI work is paused for a usage review. Saved answers remain available.</p>}
    {error && <p className="question-error" role="alert">{error}</p>}
    {checkNotice && <p className="small" role="status">{checkNotice}</p>}
    {history.length > 0 && <div className="question-history"><h3>Your questions</h3>{history.map(q => <div className="question-entry" key={q.id} id={`question-${q.id}`}><h4>{q.question}</h4>{q.answer ? <>
      {state.questionResearch.filter(r => r.answer_id === q.id).map(r => <a className="text-link" key={r.question_id} href={`#question-${r.question_id}`}>Researched follow-up · read the original answer</a>)}<p className="answer-text">{q.answer.text}</p><p className="small muted">{q.answer.needsResearch ? "Further research needed; the supplied material does not fully answer this question." : q.answer.sourceCopies?.length ? "AI answer using this lesson version and the source copies below." : "AI answer based on this lesson version."}</p>
      {q.answer.sourceIds.some(id => lesson.sources.some(s => s.id === id)) && <div className="section-sources">{q.answer.sourceIds.filter(id => lesson.sources.some(s => s.id === id)).map(id => <a key={id} href={`#source-${id}`}>{lesson.sources.find(s => s.id === id)?.title}</a>)}</div>}
      {!!q.answer.sourceCopies?.length && <details className="answer-source-details"><summary>Source copies provided ({q.answer.sourceCopies.length})</summary><p className="small muted">Quoted excerpts match the text supplied to the AI. This is not an expert review of the answer.</p>{q.answer.sourceCopies.map(copy => <div className="answer-source-copy" key={copy.snapshotId}>
        <a href={copy.finalUrl} target="_blank" rel="noreferrer">{copy.title}</a><p className="small muted">{copy.publisher} · retrieved {new Date(copy.retrievedAt).toLocaleDateString()}{copy.published ? ` · published ${copy.published}` : " · publication date not provided"}{copy.partialContext ? " · partial text used" : ""}</p>
        {q.answer!.evidence?.filter(e => e.sourceId === copy.sourceId).map(e => <blockquote key={e.sourceId}>{e.quote}</blockquote>)}
        {!q.answer!.sourceIds.includes(copy.sourceId) && <p className="small muted">Provided as context; not cited in this answer.</p>}
      </div>)}</details>}
      <QuestionResearchPanel question={q} state={state} refresh={refresh} draftDisabled={busy} onNewQuestion={() => {
        if (text.trim() && text !== q.question) { setCheckNotice("Finish or clear your current draft before opening this question. Your draft has been preserved."); questionInput.current?.focus(); return; }
        edit(q.question, q.sourceCaptureIds); setCheckNotice("A new question draft is ready to edit. Nothing has been submitted."); questionInput.current?.focus();
      }} />
    </> : <><p className="small muted">Saved question{q.sourceCaptureIds.length ? ` with ${q.sourceCaptureIds.length} source ${q.sourceCaptureIds.length === 1 ? "copy" : "copies"}` : ""}; no checked answer yet. Checking its result uses the original text and sources and will not repeat an uncertain paid call.</p>{state.questionResearch.some(r => r.answer_id === q.id) ? state.questionResearch.filter(r => r.answer_id === q.id).map(r => <a className="text-link" key={r.question_id} href={`#question-${r.question_id}`}>Continue through the original question</a>) : <Button variant="outline" disabled={busy} onClick={() => void checkSaved(q.id)}>Check saved result</Button>}</>}</div>)}</div>}
  </section>;
}
