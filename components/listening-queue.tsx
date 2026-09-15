"use client";
import { narrationAvailable } from "@/lib/chirp-voices";
import { useState } from "react";
import { Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/client";
import { lessonKey } from "@/lib/content";
import type { AppState } from "@/lib/contracts";
export function ListeningQueue({ state, refresh, onOpen, onError }: { state: AppState; refresh: () => Promise<unknown>; onOpen: (keys: string[]) => void; onError: (message: string) => void }) {
  const [keys, setKeys] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const missing = keys.filter(key => !state.media.some(m => m.lesson_key === key));
  return <section className="settings-card"><h2>A little longer to listen?</h2><p className="muted">Choose up to three lessons. Playback stops at the end of your queue.</p><div className="queue-options">{state.lessons.map(l => { const key = lessonKey(l); return <label key={key}><Checkbox checked={keys.includes(key)} disabled={busy || (keys.length >= 3 && !keys.includes(key))} onCheckedChange={checked => setKeys(list => checked ? [...list, key] : list.filter(k => k !== key))} /> <span>{l.title}<small className="muted">{keys.includes(key) ? `Position ${keys.indexOf(key) + 1} · ` : ""}~{l.minutes} min</small></span></label>; })}</div>{missing.length > 0 && <p className="small muted">{narrationAvailable(state) ? `${missing.length} selected lesson(s) need narration first.` : "Narration setup is needed before this queue can play."}</p>}<Button disabled={busy || keys.length === 0 || (missing.length > 0 && !narrationAvailable(state))} onClick={async () => { if (missing.length) { setBusy(true); try { for (const key of missing) await api("narrate", { key }); await refresh(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); } } else onOpen(keys); }}><Headphones />{busy ? "Preparing your queue…" : missing.length ? "Prepare selected narration" : "Open listening queue"}</Button></section>;
}
