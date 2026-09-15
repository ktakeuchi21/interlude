"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, Video, X, Check } from "lucide-react";
import { Button } from "./ui/button";
import { lessonSupplements, mediaDuration, type Supplement } from "@/lib/supplements";
import { mountEmbed } from "@/lib/embed-players";
import { claimMediaFocus, MEDIA_FOCUS_EVENT } from "@/lib/media-focus";
import { api } from "@/lib/client";
import type { AppState } from "@/lib/contracts";

function SupplementPlayer({ item, onClose }: { item: Supplement; onClose: () => void }) {
  const container = useRef<HTMLDivElement>(null), [status, setStatus] = useState("Loading the player…"), [error, setError] = useState(""), [duration, setDuration] = useState(item.durationSeconds), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const host = document.createElement("div"); container.current!.appendChild(host);
    const controls = mountEmbed(host, item, {
      ready: () => setStatus("Ready. Use the embedded player controls to start."),
      playing: () => { claimMediaFocus(item.id); setStatus("Playing the supplement."); },
      paused: () => setStatus("Supplement paused."), ended: () => setStatus("The supplement has finished. You can mark it complete below."),
      buffering: () => setStatus("Waiting for the media provider…"),
      error: message => { setStatus("Player unavailable."); setError(message); },
      duration: seconds => { if (Number.isFinite(seconds) && seconds > 0 && seconds <= 86400) setDuration(seconds); },
    });
    const focus = (event: Event) => { if ((event as CustomEvent<string>).detail !== item.id) { controls.pause(); setStatus("Supplement paused."); } };
    const hidden = () => { if (document.visibilityState === "hidden" && item.kind === "video") { controls.pause(); setStatus("Video paused while the app is hidden."); } };
    window.addEventListener(MEDIA_FOCUS_EVENT, focus); document.addEventListener("visibilitychange", hidden);
    return () => { controls.destroy(); host.remove(); window.removeEventListener(MEDIA_FOCUS_EVENT, focus); document.removeEventListener("visibilitychange", hidden); };
  }, [item, attempt]);
  return <div className="supplement-player">
    <div className="supplement-player-heading"><span className="small">Full {item.kind} · {mediaDuration(duration)}</span><Button variant="ghost" size="icon" aria-label="Close supplement player" onClick={onClose}><X /></Button></div>
    <div ref={container} className={`embed-host embed-${item.provider}`} />
    <p className="small muted" role="status">{status}</p>
    {error && <p className="question-error" role="alert">{error} The text and exercises are still available.</p>}
    <div className="supplement-actions"><Button variant="outline" onClick={() => { setError(""); setStatus("Loading the player…"); setAttempt(n => n + 1); }}>Reload player</Button><Button variant="ghost" onClick={onClose}>Return to the lesson</Button></div>
    {item.kind === "video" && <p className="small muted">Video needs the app on screen. Locked-screen lesson listening uses the separate narration player.</p>}
  </div>;
}
export function LessonSupplements({ lessonKey, state, refresh, onOpenChange }: { lessonKey: string; state: AppState; refresh: () => Promise<AppState>; onOpenChange: (open: boolean) => void }) {
  const items = lessonSupplements(lessonKey), [selected, setSelected] = useState<string | null>(null), [saving, setSaving] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => { onOpenChange(selected !== null); return () => onOpenChange(false); }, [selected, onOpenChange]);
  if (!items.length) return null;
  async function complete(item: Supplement) {
    setSaving(item.id); setError("");
    try { await api("complete-supplement", { key: lessonKey, supplementId: item.id }); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }
  return <section className="lesson-supplements" aria-labelledby="supplements-heading">
    <p className="eyebrow">WHEN YOU HAVE MORE TIME · OPTIONAL</p><h2 id="supplements-heading">Another way into the idea</h2>
    <p className="small muted">The lesson is complete on its own. Load a publisher’s player here when you want to go further.</p>
    {items.map(item => { const completed = state.events.some(e => e.kind === "supplement" && e.payload.key === lessonKey && e.payload.supplementId === item.id); return <article className="supplement-card" key={item.id}>
      <p className="small muted">{item.kind === "video" ? "Video" : "Podcast"} · {mediaDuration(item.durationSeconds)} · published {item.published}</p><h3>{item.title}</h3><p className="small">{item.creator}</p><p>{item.description}</p><p className="small muted">{item.context}</p>
      {selected === item.id ? <SupplementPlayer item={item} onClose={() => setSelected(null)} /> : <Button variant="outline" onClick={() => { claimMediaFocus(item.id); setSelected(item.id); }}>{item.kind === "video" ? <Video /> : <Headphones />}{item.kind === "video" ? "Load video here" : "Load podcast here"}</Button>}
      <div className="supplement-actions"><Button variant="ghost" disabled={saving !== null || completed} onClick={() => void complete(item)}>{completed && <Check />}{saving === item.id ? "Saving…" : completed ? "Marked complete · manual" : "Mark supplement complete"}</Button><a className="text-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Publisher’s notes ↗</a></div>
    </article>; })}
    <p className="small muted">Supplement completion is recorded separately. Embedded playback does not add minutes or mark the lesson complete.</p>
    {error && <p className="question-error" role="alert">{error}</p>}
  </section>;
}
