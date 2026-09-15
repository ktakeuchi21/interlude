"use client";
import { useRef, useState } from "react";
import { BookOpen, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { api } from "@/lib/client";
import type { AppState, LibraryItem } from "@/lib/contracts";
import { lessonKey, type Lesson } from "@/lib/content";
import type { LessonPreparation, PreparationStage } from "@/lib/lesson-preparation";

const labels = { inspect: "Inspecting sources…", draft: "Writing your lesson…", review: "Checking the teaching…" };
function nextStage(p?: LessonPreparation): PreparationStage | null {
  if (!p?.inspection) return "inspect";
  if (!p.inspection.value.sufficient) return null;
  if (p.refresh && p.inspection.value.update?.decision !== "update") return null;
  return !p.draft ? "draft" : !p.review ? "review" : null;
}
export function LessonPreparationPanel({ item, state, refresh, onOpen }: { item: LibraryItem; state: AppState; refresh: () => Promise<unknown>; onOpen: (lesson: Lesson) => void }) {
  const history = state.lessonPreparations.filter(p => p.topic_id === item.id);
  const [returned, setReturned] = useState<LessonPreparation | null>(null), [busy, setBusy] = useState(false), [phase, setPhase] = useState(""), [error, setError] = useState("");
  const initial = (history[0]?.sourceCaptureIds ?? state.topicResearch.find(r => r.topic_id === item.id)?.search?.candidates.map(c => c.captureId) ?? []).filter(id => state.sourceCaptures.some(c => c.id === id && c.status === "retrieved"));
  const [selected, setSelected] = useState<string[]>(initial);
  const requestId = useRef(crypto.randomUUID());
  const latest = returned && returned.updated_at >= (history[0]?.updated_at ?? 0) ? returned : history[0];
  const release = latest && state.releases.find(r => r.review?.preparationId === latest.id);
  const releasedLesson = release && [...state.lessons, ...state.archivedLessons].find(l => lessonKey(l) === release.lesson_key);
  const stage = nextStage(latest), held = !!latest && !!stage && state.spending.some(s => s.id === `lesson:${latest.id}:${stage}`);
  const staleUpdate = !!item.refresh_of && !state.lessons.some(l => lessonKey(l) === item.refresh_of);
  const canPay = state.aiConfigured && !state.budget.paused && state.budget.committed < state.budget.limit && !staleUpdate;
  const allowance = state.preparationAllowance.thisMonth < state.preparationAllowance.monthlyLimit && state.preparationAllowance.retained < state.preparationAllowance.limit;
  const choices = state.sourceCaptures.filter(copy => copy.status === "retrieved" && copy.result);
  const selectedCopies = selected.map(id => state.sourceCaptures.find(c => c.id === id && c.status === "retrieved"));
  const freshEnough = (retrievedAt?: number) => !item.refresh_of || (retrievedAt ?? 0) >= item.created_at;
  const validSelection = selectedCopies.length === 2 && selectedCopies.every(c => !!c?.result && freshEnough(c.result.retrievedAt)) && new Set(selectedCopies.map(c => c?.result?.finalUrl)).size === 2;
  const stopped = !!latest && !stage;
  async function prepare(newAttempt: boolean) {
    if (newAttempt && latest) requestId.current = crypto.randomUUID();
    const id = newAttempt ? requestId.current : latest!.id, sourceCaptureIds = newAttempt ? selected : latest!.sourceCaptureIds;
    setBusy(true); setError("");
    try {
      let current = newAttempt ? undefined : latest;
      for (let step = 0; step < 3; step++) {
        const next = nextStage(current); if (!next) break;
        setPhase(labels[next]);
        const result = await api<{ preparation: LessonPreparation }>("preparation", { id, topicId: item.id, sourceCaptureIds, stage: next });
        current = result.preparation; setReturned(current); await refresh();
        if (nextStage(current) === next) break;
      }
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); setPhase(""); }
  }
  async function check() {
    if (!latest) return;
    setBusy(true); setError("");
    try { const result = await api<{ preparation: LessonPreparation }>(`preparation?id=${latest.id}`); setReturned(result.preparation); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function addToLibrary() {
    if (!latest) return;
    setBusy(true); setError(""); setPhase(item.refresh_of ? "Saving the checked update…" : "Adding your checked lesson…");
    try { await api("release-preparation", { id: latest.id }); await refresh(); }
    catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); setPhase(""); }
  }
  return <div className="lesson-preparation" aria-label={`Lesson preparation for ${item.title}`} aria-busy={busy}>
    <h4>{item.refresh_of ? "Check this lesson for an update" : "Make it a lesson"}</h4>
    {item.refresh_of && <p className="small muted">This check is tied to the original lesson version. <a className="text-link" href={`/?lesson=${encodeURIComponent(item.refresh_of)}`}>Open that lesson</a>. A new version is prepared only for a supported material change.</p>}
    {(!latest || stopped || held) && <details className="preparation-sources"><summary>Choose two retrieved sources</summary>
      <p className="small muted">Choose two different pages. These exact copies will stay with the draft and its checks.</p>
      {item.refresh_of && <p className="small muted">Use copies retrieved after {new Date(item.created_at).toLocaleString()}, when this update was requested. Research here or retrieve again from your saved sources.</p>}
      {!choices.length && <p className="small muted">Retrieve two useful public pages first, through topic research or your saved sources.</p>}
      {choices.map(copy => <label className="preparation-choice" key={copy.id}><Checkbox checked={selected.includes(copy.id)} disabled={busy || !freshEnough(copy.result!.retrievedAt) || !selected.includes(copy.id) && selected.length >= 2} onCheckedChange={checked => { setSelected(ids => checked ? [...ids, copy.id] : ids.filter(id => id !== copy.id)); requestId.current = crypto.randomUUID(); }} /><span>{copy.result!.title}<span className="small muted">{copy.result!.publisher} · {new Date(copy.result!.retrievedAt).toLocaleDateString()}{copy.result!.truncated ? " · partial copy" : ""}{!freshEnough(copy.result!.retrievedAt) ? " · retrieve a fresh copy for this update" : ""}</span></span></label>)}
      {selected.length === 2 && !validSelection && <p className="small" role="status">These copies do not provide two different usable pages. Choose another retrieved source.</p>}
    </details>}
    <div className="source-actions">
      {(!latest || stopped || held) && <Button variant="outline" disabled={busy || !!state.generation || !canPay || !allowance || !validSelection} onClick={() => void prepare(true)}><BookOpen aria-hidden="true" />{held ? "Start a fresh preparation" : item.refresh_of ? "Check selected sources for changes" : latest ? "Prepare a new draft" : "Prepare lesson"}</Button>}
      {latest && stage && !held && <Button variant="outline" disabled={busy || !!state.generation || !canPay} onClick={() => void prepare(false)}>{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <BookOpen aria-hidden="true" />}Continue preparation</Button>}
      {latest && <Button variant="ghost" disabled={busy} onClick={() => void check()}>Check saved preparation</Button>}
    </div>
    {phase && <p className="small" role="status">{phase}</p>}
    {!state.aiConfigured && <p className="small muted">Lesson preparation is awaiting secure AI setup.</p>}
    {!latest && <p className="small muted">{item.refresh_of ? "Checks for a material change first. An unchanged lesson needs no new draft or narration. Supported changes go through drafting and an independent teaching review." : "Inspects the sources, drafts about five minutes of teaching, then runs a separate review."} Each step uses your shared AI allowance.</p>}
    {!allowance && <p className="small muted">The lesson preparation allowance is full. Existing preparations remain saved.</p>}
    {staleUpdate && !releasedLesson && <p className="small muted">A newer lesson version exists. Keep this check as history and start a new update request from the current lesson.</p>}
    {held && <p className="small muted">This step has already started. Check its saved output and cost in Settings first. A fresh preparation starts again from the selected sources and uses additional allowance; earlier work and costs stay saved.</p>}
    {(error || !release && latest?.error) && <p className="source-error" role="alert">{error || latest?.error}</p>}
    {latest?.inspection && <p className="small">{latest.inspection.value.sufficient ? "Sources inspected automatically." : "More source material is needed."} {latest.inspection.value.reason}</p>}
    {latest?.inspection?.value.update && <p className="small"><strong>{latest.inspection.value.update.decision === "unchanged" ? "No material update identified. " : latest.inspection.value.update.decision === "needs_sources" ? "More evidence is needed for this update. " : "A supported update was identified. "}</strong>{latest.inspection.value.update.summary}{latest.inspection.value.update.decision === "unchanged" ? " Your current lesson stays unchanged." : ""}</p>}
    {latest?.review && <div className="preparation-review"><p><strong>{latest.review.value.decision === "ready" ? "Automated checks passed" : latest.review.value.decision === "needs_sources" ? "More evidence needed" : "Draft needs revision"}</strong></p><p className="small">{latest.review.value.summary}</p>
      {latest.review.value.checks.filter(c => !c.acceptable).map(c => <p className="small" key={c.unit}>{c.unit}: {c.reason}</p>)}
      {latest.review.value.updateCheck && <p className="small"><strong>What changed:</strong> {latest.review.value.updateCheck.summary}</p>}
      {latest.review.value.decision === "ready" && (releasedLesson ? <><p className="small muted">Added to your learning library. Reading, practice, and narration use this saved version.</p><Button onClick={() => onOpen(releasedLesson)}><BookOpen aria-hidden="true" />Open saved lesson</Button></> : <><p className="small muted">{item.refresh_of ? "Save this checked update as the next version. Your original notes, progress, and audio remain available in version history." : "Add this checked draft to read, save progress, and practice."} Saving it is free; narration is prepared separately.</p><Button disabled={busy || staleUpdate} onClick={() => void addToLibrary()}><BookOpen aria-hidden="true" />{item.refresh_of ? "Save updated version" : "Add to learning library"}</Button></>)}
    </div>}
    {latest?.draft && <details className="preparation-preview"><summary>{release ? "Read original preparation" : "Read draft · not in your learning library"}</summary><h4>{latest.draft.value.title}</h4><p>{latest.draft.value.objective}</p>{latest.draft.value.sections.map((section, i) => <section key={i}><h5>{section.title}</h5>{section.paragraphs.map((p, n) => <p key={n}>{p}</p>)}</section>)}<p><strong>Takeaway:</strong> {latest.draft.value.takeaway}</p><p className="small muted">Practice and source checks are retained with this preparation. This preview records no learning completion or activity.</p></details>}
    {latest && <p className="small muted">Automated inspection and review are fallible. This is not an expert review.</p>}
    {history.length > 1 && <details><summary>Earlier preparations ({history.length - 1})</summary>{history.filter(p => p.id !== latest?.id).map(p => <p className="small muted" key={p.id}>{new Date(p.created_at).toLocaleString()} · {p.review?.value.decision ?? (p.draft ? "Draft saved" : "Source inspection")}</p>)}</details>}
  </div>;
}
