"use client";
import { useId, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { api } from "@/lib/client";
import { lessonKey, type Lesson } from "@/lib/content";
import type { AppState, LibraryItem } from "@/lib/contracts";

export function LessonRefresh({ lesson, state, refresh }: { lesson: Lesson; state: AppState; refresh: () => Promise<unknown> }) {
  const fieldId = useId(), requestId = useRef(crypto.randomUUID());
  const [reason, setReason] = useState(""), [savedId, setSavedId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const key = lessonKey(lesson), saved = savedId ?? state.libraryItems.find(item => item.refresh_of === key)?.id;
  const current = state.lessons.some(item => lessonKey(item) === key);
  async function save() {
    setBusy(true); setError("");
    try { const result = await api<{ item: LibraryItem }>("request-refresh", { id: requestId.current, key, reason }); setSavedId(result.item.id); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="lesson-refresh">
    <h3>Check for an update</h3>
    <p className="small muted">A source check can leave the lesson unchanged. A supported material update gets a new version; your earlier notes, progress, and audio stay with this one.</p>
    {saved && <p><a className="text-link refresh-link" href={`/?view=library#saved-interest-${saved}`}>Open saved update check</a></p>}
    {current ? <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <label htmlFor={fieldId}>What might have changed? <span className="muted">(optional)</span></label>
      <Textarea id={fieldId} value={reason} maxLength={600} onChange={e => { setReason(e.target.value); requestId.current = crypto.randomUUID(); setSavedId(null); }} disabled={busy} placeholder="A capability, new evidence, or guidance you want checked." />
      <p className="small muted">Saving this request is free. Research and teaching checks started in the library use your OpenAI API budget. Your scheduled weekly refresh runs separately through Codex using your plan.</p>
      <Button type="submit" variant="outline" disabled={busy || !!savedId}>{busy ? "Saving update request…" : "Save update request"}</Button>
    </form> : <p className="small muted">Start a new check from the current version shown above.</p>}
    {savedId && <p className="small" role="status">Update request saved. The current lesson has not changed.</p>}
    {error && <p className="source-error" role="alert">{error}</p>}
  </div>;
}
