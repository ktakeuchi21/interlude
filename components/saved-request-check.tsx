"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client";
import type { AppState, SpendingRecord } from "@/lib/contracts";
import type { SavedRequestCheck } from "@/lib/request-recovery";

export function SavedRequestCheckControl({ spend, refresh }: { spend: SpendingRecord; refresh: () => Promise<AppState> }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<SavedRequestCheck | null>(null), [error, setError] = useState("");
  if (!["lesson question", "topic research", "voice transcription", "lesson inspect", "lesson draft", "lesson review"].includes(spend.kind)) return null;
  async function check() {
    setBusy(true); setError(""); setResult(null);
    try { const response = await api<{ check: SavedRequestCheck }>("check-saved-request", { spendingId: spend.id }); setResult(response.check); await refresh(); }
    catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <div className="saved-request-check">
    <Button variant="outline" disabled={busy} onClick={() => void check()}>{busy ? "Checking saved output…" : "Check saved output · no AI charge"}</Button>
    {result && <><p className="small" role="status">{result.available ? "Saved output is available and its original usage is accounted for. No new request was sent." : "No completed output is saved for this request. Its existing cost was retained; no new request was sent. Review its final cost before deliberately starting new paid work."}</p><a className="text-link" href={result.href}>{result.label}</a></>}
    {error && <p className="question-error small" role="alert">{error}</p>}
  </div>;
}
