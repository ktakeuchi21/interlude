"use client";
import { useId, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { api } from "@/lib/client";
import { dollarAmount } from "@/lib/money";
import type { AppState, SpendingRecord } from "@/lib/contracts";

export function CostReviewForm({ spend, state, refresh, onResult }: { spend: SpendingRecord; state: AppState; refresh: () => Promise<AppState>; onResult: (message: string) => void }) {
  const fieldId = useId(), requestId = useRef(crypto.randomUUID());
  const [decision, setDecision] = useState("keep_reserved"), [amount, setAmount] = useState(""), [evidence, setEvidence] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const money = dollarAmount(amount), history = state.costReviews.filter(r => r.spending_id === spend.id).sort((a, b) => b.revision - a.revision);
  function changed() { requestId.current = crypto.randomUUID(); }
  async function save() {
    setBusy(true); onResult("");
    try {
      await api("review-cost", { id: requestId.current, spendingId: spend.id, expectedFingerprint: spend.fingerprint, previousReviewId: spend.reviewId,
        decision, amount: decision === "confirmed" ? money : null, evidence, confirmedFinalOutcome: decision === "confirmed" && confirmed,
      });
      await refresh(); onResult("Cost check saved. Original request and charge history are retained; no AI request was sent.");
    } catch (e) { onResult((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="cost-check">
    {history.length > 0 && <details><summary>Cost checks ({history.length})</summary>{history.map(review => <div className="cost-check-record" key={review.id}>
      <p className="small"><strong>{review.decision === "confirmed" ? `Owner-recorded final cost: $${(review.amount! / 1_000_000).toFixed(6)}` : "Original reservation retained"}</strong></p>
      <p className="small">{review.evidence}</p><p className="small muted">{new Date(review.created_at).toLocaleString()} · Check {review.revision}{review.id === spend.reviewId && !spend.reviewCurrent ? " · Request changed since this check" : ""}</p>
    </div>)}</details>}
    <details><summary>{history.length ? "Record another cost check" : "Check this request’s cost"}</summary>
      <p className="small muted">Use a final provider record for this request. A daily or monthly total alone cannot confirm its charge. The app records your check; it does not verify a provider invoice automatically.</p>
      <form onSubmit={e => { e.preventDefault(); void save(); }}>
        <RadioGroup value={decision} onValueChange={value => { setDecision(value); setConfirmed(false); changed(); }} aria-label="Cost-check outcome" disabled={busy || !!state.generation}>
          <label className="cost-choice"><RadioGroupItem value="keep_reserved" />Outcome still uncertain; keep the reservation</label>
          <label className="cost-choice"><RadioGroupItem value="confirmed" />I have checked the final provider cost</label>
        </RadioGroup>
        {decision === "confirmed" && <><label htmlFor={`${fieldId}-amount`}>Final cost in US dollars</label><Input id={`${fieldId}-amount`} inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); changed(); }} placeholder="0.012345" disabled={busy} required maxLength={10} />{amount && money === null && <p className="small" role="status">Enter $0–$100 with up to six decimal places.</p>}</>}
        <label htmlFor={`${fieldId}-evidence`}>What you checked and its reference</label><Textarea id={`${fieldId}-evidence`} value={evidence} onChange={e => { setEvidence(e.target.value); changed(); }} minLength={20} maxLength={2000} disabled={busy} required placeholder="Provider record or support reference, date, and what it established. No API keys or account credentials." />
        {decision === "confirmed" && <label className="cost-choice"><Checkbox checked={confirmed} onCheckedChange={value => { setConfirmed(value === true); changed(); }} disabled={busy} />I checked the final charge and the cause and limits of any unusual usage.</label>}
        <p className="small muted">A confirmed final charge replaces its estimate in your budget, including a confirmed zero charge. Keep the reservation when unsure. This check makes no paid request.</p>
        <Button variant="outline" type="submit" disabled={busy || !!state.generation || evidence.trim().length < 20 || decision === "confirmed" && (money === null || !confirmed)}>{busy ? "Saving cost check…" : "Save cost check"}</Button>
      </form>
    </details>
  </div>;
}
