"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client";
import { claimMediaFocus } from "@/lib/media-focus";
import { CHIRP_VOICES, type ChirpVoice } from "@/lib/chirp-voices";
import type { AppState } from "@/lib/contracts";
import { findLessonVersion } from "@/lib/lesson-history";

export function ChirpSettings({ state, refresh }: { state: AppState; refresh: () => Promise<AppState> }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const usage = state.chirp;
  async function prepare(kind: "sample" | "pilot", voice: ChirpVoice, onlySaved = false) {
    setBusy(`${kind}:${voice}`); setError(""); setNotice("");
    try { await api("chirp-preview", { kind, voice, onlySaved }); await refresh(); setNotice(`${voice} ${kind === "sample" ? "sample" : "full lesson preview"} is ready to listen.`); }
    catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(""); }
  }
  async function select(voice: ChirpVoice) {
    setBusy(`select:${voice}`); setError(""); setNotice("");
    try { await api("chirp-activate", { voice }); await refresh(); setNotice(`${voice} will narrate future lessons.`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(""); }
  }
  async function recoverLesson(key: string) {
    setBusy(`recover:${key}`); setError(""); setNotice("");
    try { await api("recover-narration", { key }); await refresh(); setNotice("Saved lesson audio recovered. No new Google request was sent."); }
    catch (e) { setError((e as Error).message); await refresh().catch(() => {}); }
    finally { setBusy(""); }
  }
  const blocked = !!busy || !!state.generation;
  const canGenerate = usage.configured && !usage.held && usage.used < usage.limit;
  return <section className="settings-card chirp-settings" aria-labelledby="chirp-heading" aria-busy={!!busy}>
    <h2 id="chirp-heading">Google narration</h2>
    <p className="muted">{usage.voice ? `Chirp 3 HD · ${usage.voice} for future lessons.` : "Try a voice, then listen to a full lesson preview."} Your saved lesson audio stays as it is.</p>
    <p className="budget-number">{usage.used.toLocaleString()} <span>of {usage.limit.toLocaleString()}</span></p>
    <p className="small muted">Conservative characters counted over the last 32 days. {usage.monthUsed.toLocaleString()} this month ({usage.month}, UTC). Replays use no new narration allowance.</p>
    <p className="small muted">Interlude stops at 900,000 to leave room below Google’s 1 million monthly free characters. This counter includes held attempts and counts UTF-8 bytes conservatively. It covers this app, not other Google usage or storage. <a className="text-link" href="https://cloud.google.com/text-to-speech/pricing" target="_blank" rel="noreferrer">Google pricing</a></p>
    {!usage.configured && <p className="small">Google narration is awaiting Site secret setup.</p>}
    {usage.held > 0 && <p className="small" role="status">{usage.held} attempt(s) awaiting recovery. New narration is paused. Saved audio remains playable.</p>}
    {(usage.pending ?? []).map(clip => clip.lesson_key && <div className="chirp-clip" key={clip.id}>
      <p className="small">{findLessonVersion(state, clip.lesson_key)?.title ?? "Lesson narration"}</p>
      <p className="small muted">Check for saved audio after an interruption. This check sends no Google request and keeps every attempted character counted.</p>
      <Button variant="outline" disabled={blocked} onClick={() => void recoverLesson(clip.lesson_key!)}>{busy === `recover:${clip.lesson_key}` ? "Checking saved audio…" : "Check saved lesson audio"}</Button>
    </div>)}
    <div className="chirp-voices">{CHIRP_VOICES.map(voice => {
      const sample = usage.previews.find(p => p.id === `sample:${voice.toLowerCase()}`), pilot = usage.previews.find(p => p.id === `pilot:${voice.toLowerCase()}`);
      return <div className="chirp-voice" key={voice}>
        <h3>{voice} {usage.voice === voice && <span className="small muted">· Current voice</span>}</h3>
        {(["sample", "pilot"] as const).map(kind => {
          const clip = kind === "sample" ? sample : pilot, label = kind === "sample" ? "Voice sample" : "Full lesson preview";
          if (kind === "pilot" && !sample?.object_key) return null;
          return <div className="chirp-clip" key={kind}><p className="small">{label}</p>{clip?.object_key ? <audio aria-label={`${voice} ${label.toLowerCase()}`} controls preload="none" src={`/api/chirp-audio/${clip.id}`} onLoadedMetadata={e => { e.currentTarget.playbackRate = 1.5; }} onPlay={e => claimMediaFocus(`chirp:${clip.id}`, e.currentTarget)} onError={() => setError("This preview could not play. Reload the page to try the saved audio again.")} /> : <Button variant="outline" disabled={blocked || !canGenerate && !clip} onClick={() => void prepare(kind, voice, !!clip && !!usage.held)}>{busy === `${kind}:${voice}` ? "Preparing audio…" : clip && usage.held ? `Recover ${voice} ${kind}` : `Prepare ${voice} ${kind === "sample" ? "sample" : "full preview"}`}</Button>}</div>;
        })}
        {sample?.object_key && pilot?.object_key && usage.voice !== voice && <Button disabled={blocked || !usage.configured} onClick={() => void select(voice)}>{busy === `select:${voice}` ? "Saving voice…" : `Use ${voice} for new lessons`}</Button>}
      </div>;
    })}</div>
    <p className="small muted">Previews play at 1.5× and do not change your lesson progress. A full preview uses “What models can and cannot do.”</p>
    {notice && <p className="small" role="status">{notice}</p>}
    {error && <p className="source-error" role="alert">{error}</p>}
  </section>;
}
