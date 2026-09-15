"use client";
import { narrationAvailable } from "@/lib/chirp-voices";
import { useState } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client";
import type { AppState } from "@/lib/contracts";
import type { WeeklyRefreshState } from "@/lib/weekly-refresh";

export function WeeklyRefreshPanel({ state, refresh }: { state: AppState; refresh: () => Promise<AppState> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [selectedRunId, setSelectedRunId] = useState("");
  const [returned, setReturned] = useState<WeeklyRefreshState | null>(null);
  const plan = state.planDeliveries?.[0];
  const current = !selectedRunId || selectedRunId === state.weeklyRefresh.current?.run.preparation_id ? state.weeklyRefresh.current : returned;
  const history = returned && !state.weeklyRefresh.history.some(r => r.preparation_id === returned.run.preparation_id) ? [returned.run, ...state.weeklyRefresh.history] : state.weeklyRefresh.history;
  const canAdvancePaid = (latest: AppState, step?: WeeklyRefreshState | null) => step?.stage === "narration" ? narrationAvailable(latest) : latest.aiConfigured && !latest.budget.paused && latest.budget.committed < latest.budget.limit;
  const canPay = canAdvancePaid(state, current);
  const freeStage = (step?: WeeklyRefreshState | null) => !step || step.stage === "request" || step.stage === "release";
  async function selectRun(runId: string) {
    if (!runId) { setSelectedRunId(""); setReturned(null); setError(""); return; }
    setBusy(true); setError("");
    try { const result = await api<{ refresh: WeeklyRefreshState }>(`weekly-refresh?runId=${encodeURIComponent(runId)}`); await refresh(); setReturned(result.refresh); setSelectedRunId(runId); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function run() {
    setBusy(true); setError("");
    try {
      let runId = current?.run.preparation_id;
      // A browser click can continue the bounded steps while this page is open.
      // This is not the still-unconfigured unattended scheduler.
      for (let step = 0; step < 8; step++) {
        const result = await api<{ refresh: WeeklyRefreshState }>("advance-weekly-refresh", runId ? { runId } : {});
        runId = result.refresh.run.preparation_id; setSelectedRunId(runId); setReturned(result.refresh);
        const latest = await refresh();
        const canContinuePaid = canAdvancePaid(latest, result.refresh);
        if (!result.refresh.canAdvance || !freeStage(result.refresh) && !canContinuePaid) break;
      }
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <section className="settings-card" aria-labelledby="weekly-refresh-heading" aria-busy={busy}>
    <h2 id="weekly-refresh-heading">Keep your learning current</h2>
    <p className="muted">Weekly refresh runs through Codex using your plan, on Mondays at 8 AM Mountain time. Keep your laptop awake with Codex running. It prepares suggestions and checks up to one due lesson; a lesson is considered at most once every four weeks.</p>
    {plan && <div className="small"><p><strong>Latest delivery · week of {plan.week}</strong></p><p>{plan.summary}</p><p className="muted">Prepared {new Date(plan.preparedAt).toLocaleString()} · {plan.status === "saved" ? "Saved in your library" : "Needs attention in Codex"}</p>{plan.error && <p role="alert" className="source-error">{plan.error}</p>}{plan.updatedLessonKey && <p><a className="text-link" href={`/?lesson=${encodeURIComponent(plan.updatedLessonKey)}`}>Open the updated lesson</a></p>}</div>}
    <p className="small muted">Manage or pause the schedule in Codex. If Codex cannot run or needs sign-in, the latest saved material stays available. New narration uses your separate Chirp allowance.</p>
    <h3>Optional manual API check</h3>
    <p className="small muted">The button below uses your OpenAI API budget for research and checks. It is separate from the scheduled refresh through your plan. Previous versions, notes, and costs stay saved.</p>
    {history.length > 0 && <div className="weekly-history small"><label htmlFor="weekly-refresh-history">Saved content checks</label><select id="weekly-refresh-history" value={selectedRunId || current?.run.preparation_id || ""} disabled={busy} onChange={e => void selectRun(e.target.value)}>{!state.weeklyRefresh.current && <option value="">This week · not started</option>}{history.map(run => <option key={run.preparation_id} value={run.preparation_id}>Week of {run.week}</option>)}</select></div>}
    {current && <><p className="small"><strong>{current.run.lesson_title ?? "No lesson due for this check"}</strong></p><p className="small muted">Week of {current.run.week} · Monday–Sunday UTC</p><p className="small" role="status">{current.message}</p></>}
    {(!current || current.canAdvance) && <Button variant="outline" disabled={busy || !!state.generation || !canPay && !freeStage(current)} onClick={() => void run()}>{busy ? "Checking saved learning…" : current ? "Continue selected check" : "Run this week’s check"}</Button>}
    {!canPay && (!current || current.canAdvance && !freeStage(current)) && <p className="small muted">The next step is waiting for its service setup or available allowance. Suggestions and saved results remain available.</p>}
    {current?.updatedLessonKey && <p><a className="text-link" href={`/?lesson=${encodeURIComponent(current.updatedLessonKey)}`}>Open the saved update</a></p>}
    {current && state.libraryItems.some(i => i.id === current.run.topic_id) && <p><a className="text-link" href={`/?view=library#saved-interest-${current.run.topic_id}`}>View this check’s sources and preparation</a></p>}
    {error && <p className="source-error" role="alert">{error}</p>}
  </section>;
}
