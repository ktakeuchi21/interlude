"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, Play, Pause, RotateCcw, RotateCw, LoaderCircle, SkipForward, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { claimMediaFocus, MEDIA_FOCUS_EVENT } from "@/lib/media-focus";
import { lessonKey, type Lesson } from "@/lib/content";
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
type Props = { lesson: Lesson; ready: boolean; configured: boolean; initialPosition: number; compact: boolean; remaining: number; onGenerate: () => Promise<void>; onPosition: (key: string, position: number, complete: boolean) => void; onActivity: (key: string, start: number, end: number) => void; onError: (message: string) => void; onNext: () => void; onClose: () => void; onOpen: () => void };
export function AudioPlayer({ lesson, ready, configured, initialPosition, compact, remaining, onGenerate, onPosition, onActivity, onError, onNext, onClose, onOpen }: Props) {
  const ref = useRef<HTMLAudioElement>(null), loaded = useRef(false), continuePlayback = useRef(false), initial = useRef(initialPosition), lastSave = useRef(0), sample = useRef({ wall: 0, position: 0 });
  const key = lessonKey(lesson), active = useRef({ key, position: initialPosition, complete: false });
  const callbacks = useRef({ onPosition, onActivity, onError, onNext });
  useEffect(() => { callbacks.current = { onPosition, onActivity, onError, onNext }; }, [onPosition, onActivity, onError, onNext]);
  useEffect(() => { initial.current = initialPosition; }, [initialPosition]);
  useEffect(() => { const focus = (event: Event) => { if ((event as CustomEvent<string>).detail !== "lesson") ref.current?.pause(); }; window.addEventListener(MEDIA_FOCUS_EVENT, focus); return () => window.removeEventListener(MEDIA_FOCUS_EVENT, focus); }, []);
  const [playing, setPlaying] = useState(false), [state, setState] = useState({ key, position: initialPosition, duration: 0 }), [speed, setSpeed] = useState("1.5"), [busy, setBusy] = useState(false);
  const position = state.key === key ? state.position : initialPosition, duration = state.key === key ? state.duration : 0;
  function persist() { if (loaded.current) { const a = active.current; callbacks.current.onPosition(a.key, a.position, a.complete); } }
  function report() {
    const audio = ref.current; if (!audio || !loaded.current) return;
    const now = Date.now(), previous = sample.current, seconds = (audio.currentTime - previous.position) / audio.playbackRate, elapsed = (now - previous.wall) / 1000;
    if (previous.wall && seconds > 0 && elapsed > 0 && elapsed <= 300 && Math.abs(seconds - elapsed) < 3) callbacks.current.onActivity(active.current.key, previous.wall, now);
    active.current.position = audio.currentTime;
    sample.current = { wall: now, position: audio.currentTime };
  }
  useEffect(() => {
    const audio = ref.current!;
    // Keep the same media element through queue transitions. Do not remount it:
    // iOS playback authorization and Now Playing belong to this element.
    if (loaded.current) { const old = active.current; callbacks.current.onPosition(old.key, old.position, old.complete); }
    loaded.current = false; audio.pause(); sample.current.wall = 0;
    active.current = { key, position: initial.current, complete: false };
    if (ready) audio.src = `/api/audio/${encodeURIComponent(key)}`;
    else audio.removeAttribute("src");
    audio.load();
  }, [key, ready]);
  useEffect(() => {
    const save = () => { if (loaded.current) { const a = active.current; callbacks.current.onPosition(a.key, a.position, a.complete); } };
    const hide = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", hide);
    return () => { save(); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hide); };
  }, []);
  useEffect(() => {
    const audio = ref.current; if (!audio || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: lesson.title, artist: "Interlude · AI narration", album: "Your learning library", artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }] });
    const seek = (value: number) => { if (loaded.current) audio.currentTime = Math.max(0, Math.min(audio.duration || 0, value)); };
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => { void audio.play().catch(() => callbacks.current.onError("Tap Play in the app to resume listening.")); }], ["pause", () => audio.pause()],
      ["seekbackward", d => seek(audio.currentTime - (d.seekOffset ?? 15))], ["seekforward", d => seek(audio.currentTime + (d.seekOffset ?? 15))],
      ["seekto", d => { if (d.seekTime !== undefined) seek(d.seekTime); }],
    ];
    if (remaining) actions.push(["nexttrack", () => { continuePlayback.current = !audio.paused; callbacks.current.onNext(); }]);
    for (const [name, callback] of actions) { try { navigator.mediaSession.setActionHandler(name, callback); } catch {} }
    return () => { for (const [name] of actions) { try { navigator.mediaSession.setActionHandler(name, null); } catch {} } };
  }, [key, lesson.title, remaining]);
  async function toggle() {
    if (!ready) { setBusy(true); try { await onGenerate(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); } return; }
    const audio = ref.current!;
    if (audio.paused) { try { await audio.play(); } catch { onError("Playback could not start. Please tap Play again."); } } else audio.pause();
  }
  function update() {
    const audio = ref.current; if (!audio || !loaded.current) return;
    active.current.position = audio.currentTime;
    setState({ key: active.current.key, position: audio.currentTime, duration: audio.duration || 0 });
    if (Date.now() - lastSave.current > 10_000) { report(); persist(); lastSave.current = Date.now(); }
    if ("mediaSession" in navigator && Number.isFinite(audio.duration) && audio.duration > 0) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) }); } catch {}
    }
  }
  return <aside className={`audio-player ${compact ? "player-dock" : ""}`} aria-label="Lesson audio player">
    <audio ref={ref} preload="metadata" playsInline
      onLoadedMetadata={() => { const audio = ref.current!; loaded.current = true; audio.currentTime = Math.min(active.current.position, audio.duration); audio.playbackRate = Number(speed); setState({ key: active.current.key, position: audio.currentTime, duration: audio.duration }); setPlaying(false); if (continuePlayback.current) { continuePlayback.current = false; void audio.play().catch(() => onError("Your next queued lesson is ready. Tap Play to continue.")); } }}
      onTimeUpdate={update} onPlay={() => { if (!loaded.current) return; claimMediaFocus("lesson", ref.current); setPlaying(true); sample.current = { wall: Date.now(), position: ref.current!.currentTime }; if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing"; }}
      onPause={() => { if (!loaded.current) return; report(); persist(); setPlaying(false); sample.current.wall = 0; if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused"; }}
      onSeeking={() => { sample.current.wall = 0; }} onSeeked={() => { if (!loaded.current) return; active.current.position = ref.current!.currentTime; sample.current = { wall: ref.current!.paused ? 0 : Date.now(), position: ref.current!.currentTime }; persist(); }}
      onEnded={() => { if (!loaded.current) return; report(); active.current.complete = true; persist(); setPlaying(false); if (remaining) { continuePlayback.current = true; callbacks.current.onNext(); } }}
      onError={() => { if (ready) onError("The audio could not load. You can keep reading and retry the audio later."); }} />
    {compact && <Button variant="ghost" className="player-open" aria-label={`Open player for ${lesson.title}`} onClick={onOpen} />}
    <div className="player-heading"><span className="eyebrow"><Headphones size={16} aria-hidden="true" /> LISTEN</span><span className="muted small">AI voice</span></div>
    <h2>{lesson.title}{compact && <ChevronUp size={18} aria-hidden="true" />}</h2>
    {!ready && <p className="player-message">{configured ? "Prepare this lesson once, then listen whenever you like." : "Narration setup is pending. You can read and save notes now."}</p>}
    {!ready ? configured && <Button onClick={toggle} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Headphones />}{busy ? "Preparing narration…" : "Prepare narration"}</Button> : <>
    <div className="player-controls"><Button variant="ghost" size="icon" aria-label="Rewind 15 seconds" disabled={!ready} onClick={() => { const a = ref.current!; a.currentTime = Math.max(0, a.currentTime - 15); }}><RotateCcw /></Button><Button className="play-button" aria-label={busy ? "Preparing narration" : !ready ? "Prepare narration" : playing ? "Pause lesson" : "Play lesson"} disabled={busy || (!ready && !configured)} onClick={toggle}>{busy ? <LoaderCircle className="spin" /> : playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button><Button variant="ghost" size="icon" aria-label="Forward 15 seconds" disabled={!ready} onClick={() => { const a = ref.current!; a.currentTime = Math.min(a.duration || 0, a.currentTime + 15); }}><RotateCw /></Button></div>
    <Slider aria-label="Audio position in seconds" min={0} max={duration || lesson.minutes * 60} step={1} value={[position]} disabled={!ready} onValueChange={v => setState({ key, position: v[0], duration })} onValueCommit={v => { ref.current!.currentTime = v[0]; }} />
    <div className="player-time"><span>{time(position)}</span><span>{duration ? time(duration) : `~${lesson.minutes}:00`}</span></div>
    <div className="player-footer"><Select value={speed} onValueChange={value => { report(); setSpeed(value); ref.current!.playbackRate = Number(value); }}><SelectTrigger aria-label="Playback speed"><SelectValue /></SelectTrigger><SelectContent>{[0.75, 1, 1.25, 1.5, 1.75, 2].map(s => <SelectItem key={s} value={String(s)}>{s}× speed</SelectItem>)}</SelectContent></Select>{remaining ? <Button variant="ghost" aria-label="Next queued lesson" onClick={() => { continuePlayback.current = !ref.current!.paused; onNext(); }}>{remaining} next <SkipForward size={16} /></Button> : <span className="muted small">Pause after this lesson</span>}</div>
    </>}
    {compact && <Button className="close-player" variant="ghost" size="icon" aria-label="Close audio player" onClick={onClose}><X /></Button>}
  </aside>;
}
