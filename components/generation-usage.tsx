"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import type { AppState } from "@/lib/contracts";
import { CostReviewForm } from "./cost-review";
import { NarrationReplacementForm } from "./narration-replacement";
import { SavedRequestCheckControl } from "./saved-request-check";
import { api } from "@/lib/client";
export function GenerationUsage({ state, refresh }: { state: AppState; refresh: () => Promise<AppState> }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lock = state.generation, expired = lock && lock.expires_at <= state.asOf;
  async function recover() {
    if (!lock) return; setBusy(true); setMessage("");
    try { await api("recover", { token: lock.token }); await refresh(); setMessage("Expired preparation released. Reserved costs and saved results were retained. You can reopen the lesson to check its saved narration."); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="settings-card"><h2>Preparation & request history</h2>
    <p className="muted">{lock ? expired ? "A preparation expired before it finished. Release it to allow other work to proceed." : "A preparation is running. Its spending is reserved before any paid request." : "No preparation is running."}</p>
    {lock && <p className="small muted">{expired ? "Expired" : "Recovery available after"} {new Date(lock.expires_at).toLocaleString()}.</p>}
    {expired && lock?.token && <Button variant="outline" disabled={busy} onClick={() => void recover()}>Release expired preparation</Button>}
    <Button variant="ghost" disabled={busy} onClick={() => void refresh().catch(e => setMessage(e.message))}>Refresh usage</Button>
    {message && <p role="status" className="small">{message}</p>}
    {state.budget.paused && <p className="question-error" role="alert">Unexpected AI usage needs review. All new paid work is paused.</p>}
    <details><summary>{state.spending.length} recorded request{state.spending.length === 1 ? "" : "s"}</summary>{state.spending.length ? <ol className="spending-list">{state.spending.map(s => <li key={s.id}><strong>{s.kind} · ${(s.effective / 1_000_000).toFixed(4)}</strong><p className="small">{s.needsReview ? "Cost review required" : s.reviewCurrent && state.costReviews.some(r => r.id === s.reviewId && r.decision === "confirmed") ? "Final cost recorded; original outcome retained" : s.status === "complete" ? "Accounted" : "Reserved; outcome needs checking"} · {new Date(s.created_at).toLocaleString()}</p><p className="small muted">{s.basis}</p>{s.provider_request && <p className="small request-id">Provider request: {s.provider_request}</p>}<p className="small muted">Budget holds ${(s.effective / 1_000_000).toFixed(6)} for {s.month}.</p><SavedRequestCheckControl spend={s} refresh={refresh} /><CostReviewForm key={`${s.id}:${s.fingerprint}:${s.reviewId}`} spend={s} state={state} refresh={refresh} onResult={setMessage} /><NarrationReplacementForm key={`replacement:${s.id}:${s.fingerprint}:${s.reviewId}`} spend={s} state={state} refresh={refresh} onResult={setMessage} /></li>)}</ol> : <p className="small muted">No paid app requests have been recorded.</p>}</details>
    <p className="small muted">Releasing a preparation never clears a charge or resends an uncertain request. Missing results still require cost review before a new paid attempt. Accounted costs use published rates; owner-recorded cost checks remain separate from those estimates.</p>
  </section>;
}
