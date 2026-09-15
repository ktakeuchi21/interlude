"use client";
import { useRef, useState } from "react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { api } from "@/lib/client";
import type { AppState, SpendingRecord } from "@/lib/contracts";

export function NarrationReplacementForm({ spend, state, refresh, onResult }: { spend: SpendingRecord; state: AppState; refresh: () => Promise<AppState>; onResult: (message: string) => void }) {
  const requestId = useRef(crypto.randomUUID()), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  if (spend.kind !== "narration") return null;
  const previous = state.narrationReplacements.find(r => r.operation_id === spend.id), child = state.narrationReplacements.find(r => r.parent_id === spend.id);
  const root = previous?.root_id ?? spend.id, match = /^tts:(.+):alloy:(\d+)$/.exec(root);
  if (!match) return null;
  const key = match[1], saved = state.media.some(m => m.lesson_key === key), count = state.narrationReplacements.filter(r => r.root_id === root).length;
  async function allow() {
    setBusy(true); onResult("");
    try {
      await api("replace-narration", { id: requestId.current, spendingId: spend.id, expectedFingerprint: spend.fingerprint, reviewId: spend.reviewId, confirmedNewCharge: confirmed });
      await refresh(); onResult("One replacement segment is allowed. No AI request was sent. Reopen the lesson to continue narration; both attempts stay in your cost history.");
    } catch (error) { onResult((error as Error).message); }
    finally { setBusy(false); }
  }
  async function recover() {
    setBusy(true); onResult("");
    try { await api("recover-narration", { key }); await refresh(); onResult("Saved narration is ready. No new AI request was sent."); }
    catch (error) { await refresh().catch(() => undefined); onResult((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cost-check">
    {previous && <p className="small muted">Replacement {previous.attempt} of 2 for audio segment {previous.part + 1}. The earlier attempt remains in your request history.</p>}
    {saved ? <p className="small">This lesson has saved narration.</p> : child ? <p className="small">Replacement {child.attempt} is allowed · {state.spending.some(s => s.id === child.operation_id) ? "its request is in this history" : "no new request has started"}.</p> : count >= 2 ? <p className="small">This segment reached its two-replacement limit. Inspect the failure before further work.</p> : <details><summary>Replace a missing audio segment</summary>
      <p className="small">Check saved narration first. If this segment is missing, you can allow one new request, up to ${(spend.reserved / 1_000_000).toFixed(6)}. The original cost stays recorded and may still be charged. At most two replacements are allowed per segment.</p>
      {(!spend.reviewCurrent || !spend.reviewId || spend.needsReview) && <p className="small">Save a current cost check above first. Keep the reservation if the outcome is still uncertain.</p>}
      <label className="cost-choice"><Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={busy || !!state.generation} />I allow a separately charged replacement even if the original attempt was charged.</label>
      <p className="small muted">This saves permission only. Reopening the lesson and continuing narration uses the usual budget and storage limits.</p>
      <Button variant="outline" disabled={busy || !confirmed || !!state.generation || state.budget.paused || !spend.reviewCurrent || !spend.reviewId || spend.needsReview} onClick={() => void allow()}>{busy ? "Checking saved audio…" : "Allow one replacement"}</Button>
    </details>}
    {!saved && <Button variant="outline" disabled={busy || !!state.generation} onClick={() => void recover()}>Check saved narration · no AI charge</Button>}
    <a className="small source-action-link" href={`/?lesson=${encodeURIComponent(key)}`}>Open original lesson</a>
  </div>;
}
