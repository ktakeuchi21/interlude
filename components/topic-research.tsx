"use client";
import { useRef, useState } from "react";
import { Search, RefreshCw, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { api } from "@/lib/client";
import type { AppState, LibraryItem, TopicResearch as Research } from "@/lib/contracts";
import { LessonPreparationPanel } from "./lesson-preparation";
import type { Lesson } from "@/lib/content";

export function TopicResearch({ item, state, refresh, onOpen }: { item: LibraryItem; state: AppState; refresh: () => Promise<unknown>; onOpen: (lesson: Lesson) => void }) {
  const history = state.topicResearch.filter(r => r.topic_id === item.id);
  const [returned, setReturned] = useState<Research | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const latest = returned && returned.created_at >= (history[0]?.created_at ?? 0) ? returned : history[0];
  const hasPaidAttempt = latest && state.spending.some(s => s.id === `research:${latest.id}`);
  const interrupted = !!latest && !latest.search && hasPaidAttempt;
  const missingCopies = latest?.search?.candidates.some(c => !state.sourceCaptures.some(s => s.id === c.captureId));
  const pendingCopies = latest?.search?.candidates.some(c => state.sourceCaptures.some(s => s.id === c.captureId && s.status === "retrieving"));
  const canPay = state.aiConfigured && !state.budget.paused && state.budget.committed < state.budget.limit;
  const allowance = state.researchAllowance.thisMonth < state.researchAllowance.monthlyLimit && state.researchAllowance.retained < state.researchAllowance.limit && state.sourceAllowance.thisMonth + 2 <= state.sourceAllowance.monthlyLimit && state.sourceAllowance.retained + 2 <= state.sourceAllowance.limit;
  async function prepare(mode: "start" | "resume" | "check") {
    if (mode === "start" && latest) requestId.current = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const { research } = mode === "check" && latest
        ? await api<{ research: Research }>(`research?id=${encodeURIComponent(latest.id)}`)
        : await api<{ research: Research }>("research", { id: mode === "resume" && latest ? latest.id : requestId.current, topicId: item.id });
      setReturned(research); await refresh();
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <div className="topic-research" aria-label={`Research for ${item.title}`} aria-busy={busy}>
    <div className="source-actions">
      {(!latest || interrupted || latest.search && !missingCopies && !pendingCopies) && <Button variant="outline" disabled={busy || !!state.generation || !canPay || !allowance} onClick={() => void prepare("start")}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}{busy ? "Finding and reading sources…" : interrupted ? "Start fresh research" : latest ? "Research again" : "Research this topic"}
      </Button>}
      {!!latest && (missingCopies || !latest.search && !hasPaidAttempt) && <Button variant="outline" disabled={busy || !!state.generation || !latest.search && !canPay} onClick={() => void prepare("resume")}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{busy ? "Continuing research…" : latest.search ? "Retrieve remaining sources" : "Continue research"}
      </Button>}
      {!!latest && (!latest.search || pendingCopies) && <Button variant="ghost" disabled={busy} onClick={() => void prepare("check")}>Check saved research</Button>}
    </div>
    {interrupted && <p className="small muted">Check saved output and its cost in Settings first. Fresh research makes a new paid request; the earlier attempt and its cost stay saved and count toward your allowance.</p>}
    {!state.aiConfigured && <p className="small muted">New research is awaiting secure AI setup. Your topic stays saved.</p>}
    {state.budget.paused && <p className="small muted">New paid research is paused for a usage review.</p>}
    {!latest && <p className="small muted">Find and retrieve up to two pages from connected publishers. Uses your monthly AI allowance; drafting and lesson review follow separately.</p>}
    {!allowance && <p className="small muted">The research or source retrieval allowance is full. Saved material stays available.</p>}
    {error && <p className="source-error" role="alert">{error}</p>}
    {latest?.error && <p className="source-error" role="status">{latest.error}</p>}
    {latest && !latest.search && !latest.error && <p className="small muted">Research is saved but has no completed search result yet. Checking it does not repeat a paid search. Interrupted preparations can be recovered in Settings.</p>}
    {latest?.search && <details className="research-details" open><summary>Source research · {new Date(latest.search.searchedAt).toLocaleDateString()}</summary>
      {latest.search.gap && <p className="small">Research gap: {latest.search.gap}</p>}
      {!latest.search.candidates.length && <p className="small muted">No suitable pages were selected from this search. The topic remains available for further research.</p>}
      <div className="research-candidates">{latest.search.candidates.map(candidate => {
        const capture = state.sourceCaptures.find(s => s.id === candidate.captureId), source = capture?.result;
        const preview = (source?.preview.startsWith(source.title) ? source.preview.slice(source.title.length) : source?.preview ?? "").replace(/\s+/g, " ").trim();
        const excerpt = preview.length > 220 ? preview.slice(0, 220).replace(/\s+\S*$/, "") : preview;
        return <div className="research-candidate" key={candidate.captureId}>
          <a href={candidate.url} target="_blank" rel="noreferrer">{source?.title ?? new URL(candidate.url).hostname}</a>
          <p className="small muted">Suggested relevance: {candidate.reason}</p>
          {source ? <><p className="small">Text retrieved · {source.publisher} · {new Date(source.retrievedAt).toLocaleDateString()}{source.truncated ? " · partial copy" : ""}</p><p className="source-preview">{excerpt}…</p></> : <p className="small muted">{capture?.error ?? (capture ? "Retrieval has not finished. Check Settings if the preparation was interrupted." : "Page text still needs retrieval.")}</p>}
          <a className="text-link small" href={`?view=library#saved-interest-${candidate.itemId}`}>View saved source and retrieval controls</a>
        </div>;
      })}</div>
      <p className="small muted">Retrieved pages can be selected when asking about a lesson. These are candidate sources; no new lesson or expert review has been produced.</p>
    </details>}
    {history.length > 1 && <details className="research-history"><summary>Earlier searches ({history.length - 1})</summary>{history.filter(r => r.id !== latest?.id).map(r => <p className="small muted" key={r.id}>{new Date(r.created_at).toLocaleString()} · {r.search ? `${r.search.candidates.length} candidate ${r.search.candidates.length === 1 ? "source" : "sources"}` : "No completed search result"}</p>)}</details>}
    <LessonPreparationPanel item={item} state={state} refresh={refresh} onOpen={onOpen} />
  </div>;
}
