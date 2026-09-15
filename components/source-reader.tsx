"use client";
import { useRef, useState } from "react";
import { FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import type { AppState, LibraryItem, SourceCapture } from "@/lib/contracts";

export function SourceReader({ item, state, refresh }: { item: LibraryItem; state: AppState; refresh: () => Promise<unknown> }) {
  const copies = state.sourceCaptures.filter(copy => copy.library_item_id === item.id);
  const [returned, setReturned] = useState<SourceCapture | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const latest = returned && returned.created_at >= (copies[0]?.created_at ?? 0) ? returned : copies[0];
  const latestReadable = latest?.result ? latest : copies.find(copy => copy.result);
  async function retrieve(newAttempt = false) {
    if (newAttempt) requestId.current = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const { capture } = latest?.status === "retrieving" && !newAttempt
        ? await api<{ capture: SourceCapture }>(`source?id=${encodeURIComponent(latest.id)}`)
        : await api<{ capture: SourceCapture }>("source", { id: requestId.current, itemId: item.id });
      setReturned(capture); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const retrieving = latest?.status === "retrieving";
  const source = latestReadable?.result;
  return <div className="source-reader">
    <div className="source-actions">
      <Button variant="outline" disabled={busy || Boolean(state.generation) && !retrieving} onClick={() => void retrieve(Boolean(latest && !retrieving))}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : latest ? <RefreshCw aria-hidden="true" /> : <FileText aria-hidden="true" />}
        {busy ? "Retrieving source…" : retrieving ? "Check retrieval" : latest ? "Retrieve again" : "Retrieve source"}
      </Button>
      {retrieving && !state.generation && <Button variant="ghost" disabled={busy} onClick={() => void retrieve(true)}>Start a new retrieval</Button>}
    </div>
    {!latest && <p className="small muted">Retrieve public text for future lessons. No AI generation charge. Some publishers and formats are not connected yet.</p>}
    {retrieving && <p className="small muted" role="status">This retrieval has not finished. Check its saved result; interrupted preparations can be recovered in Settings.</p>}
    {latest?.error && <p className="source-error" role="status">{latest.error}</p>}
    {error && <p className="source-error" role="alert">{error}</p>}
    {source && <Accordion type="single" collapsible className="source-details"><AccordionItem value="details"><AccordionTrigger>Retrieved source details</AccordionTrigger><AccordionContent>
      <h4>{source.title}</h4><p className="small muted">{source.publisher} · Retrieved {new Date(source.retrievedAt).toLocaleDateString()}{source.published ? ` · Published ${source.published}` : " · Publication date not provided"}</p>
      <p className="small">Text retrieved; claims have not been reviewed for a lesson.</p>
      <p className="source-preview">{source.preview}{source.bytes > new TextEncoder().encode(source.preview).length ? "…" : ""}</p>
      {source.truncated && <p className="small muted">This is a partial source copy. Future checks can use only the retained material.</p>}
      {source.finalUrl !== item.url && <p className="small muted">The publisher redirected this link to <a href={source.finalUrl} target="_blank" rel="noreferrer">the retrieved page ↗</a>.</p>}
      {copies.length > 1 && <p className="small muted">{copies.length} retrieval records retained. Earlier source copies remain available to the lessons that used them.</p>}
    </AccordionContent></AccordionItem></Accordion>}
  </div>;
}
