"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Mic, Square, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { api } from "@/lib/client";
import { startVoiceRecording, recordingToWav, microphoneMessage } from "@/lib/voice-recording";
import { claimMediaFocus } from "@/lib/media-focus";
import { MAX_VOICE_SECONDS } from "@/lib/voice-audio";
import type { AppState, VoiceDraft, VoicePurpose } from "@/lib/contracts";

type Phase = "idle" | "permission" | "recording" | "converting" | "transcribing" | "checking";
export function SpokenInput({ lessonKey, purpose, state, disabled = false, maxLength, onText, refresh }: { lessonKey: string; purpose: VoicePurpose; state: AppState; disabled?: boolean; maxLength: number; onText: (text: string) => void; refresh: () => Promise<AppState> }) {
  const inputId = useId(), [phase, setPhase] = useState<Phase>("idle"), [seconds, setSeconds] = useState(0), [transcript, setTranscript] = useState<string | null>(null), [message, setMessage] = useState("");
  const abort = useRef<AbortController | null>(null), stop = useRef<(() => void) | null>(null), attempt = useRef({ sequence: 0 }), mounted = useRef(true), phaseRef = useRef<Phase>(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => {
    mounted.current = true;
    const lifecycle = attempt.current;
    const cancelOnHide = () => {
      if (document.visibilityState === "hidden" && ["permission", "recording", "converting"].includes(phaseRef.current)) abort.current?.abort();
    };
    const cancelOtherCapture = () => { if (["permission", "recording", "converting"].includes(phaseRef.current)) abort.current?.abort(); };
    document.addEventListener("visibilitychange", cancelOnHide);
    document.addEventListener("interlude:voice-start", cancelOtherCapture);
    return () => { mounted.current = false; lifecycle.sequence++; abort.current?.abort(); document.removeEventListener("visibilitychange", cancelOnHide); document.removeEventListener("interlude:voice-start", cancelOtherCapture); };
  }, []);
  const available = state.aiConfigured && !state.budget.paused && state.budget.limit - state.budget.committed >= 6000;
  const history = state.voiceDrafts.filter(v => v.lesson_key === lessonKey && v.purpose === purpose).slice(0, 3);
  const busy = phase !== "idle";
  const setStep = (next: Phase) => { phaseRef.current = next; setPhase(next); };

  async function record() {
    if (phaseRef.current !== "idle" || disabled || !available) return;
    document.dispatchEvent(new Event("interlude:voice-start"));
    const current = ++attempt.current.sequence, controller = new AbortController(); abort.current = controller;
    const active = () => mounted.current && attempt.current.sequence === current;
    setTranscript(null); setMessage(""); setSeconds(0); setStep("permission");
    // Pause lesson audio before opening the microphone, avoiding narration in the
    // recording. Resume remains an explicit user action after voice input.
    claimMediaFocus("voice");
    try {
      const capture = await startVoiceRecording(controller.signal, value => { if (active()) setSeconds(value); });
      stop.current = capture.stop;
      if (!active() || controller.signal.aborted) { controller.abort(); return; }
      setStep("recording");
      const blob = await capture.finished;
      if (!active() || controller.signal.aborted) return;
      stop.current = null; setStep("converting");
      const bytes = await recordingToWav(blob);
      if (!active() || controller.signal.aborted) return;
      setStep("transcribing");
      const id = crypto.randomUUID(), params = new URLSearchParams({ id, key: lessonKey, purpose });
      // Never resend this upload automatically. Once submitted, a server result
      // can be recovered from its saved ID even if this panel is closed.
      const response = await fetch(`/api/transcribe?${params}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: bytes, cache: "no-store", signal: AbortSignal.timeout(100_000) });
      const data = await response.json() as { draft?: VoiceDraft; error?: string };
      if (!response.ok || !data.draft?.result) throw new Error(data.error ?? "The transcript did not finish. Check recent voice drafts before recording again.");
      if (active()) { setTranscript(data.draft.result.text); setMessage(data.draft.result.text ? "Review the wording, then use it in your draft." : "No words were recognized. You can type instead or make a new recording."); }
      await refresh();
    } catch (error) {
      if (active()) { setMessage(microphoneMessage(error)); await refresh().catch(() => {}); }
    } finally {
      controller.abort();
      if (active()) { stop.current = null; setStep("idle"); }
    }
  }
  function cancel() {
    attempt.current.sequence++; abort.current?.abort(); stop.current = null; setStep("idle"); setMessage("Recording cancelled. Your typed draft is unchanged.");
  }
  async function recover(id: string) {
    if (phaseRef.current !== "idle") return;
    const current = ++attempt.current.sequence, active = () => mounted.current && attempt.current.sequence === current;
    setMessage(""); setStep("checking");
    try {
      const { draft } = await api<{ draft: VoiceDraft }>(`transcript?id=${encodeURIComponent(id)}`);
      if (active()) {
        if (draft.result) { setTranscript(draft.result.text); setMessage("Review this saved transcript before using it."); }
        else setMessage("No saved transcript is available yet. Its reserved request will not be repeated automatically.");
      }
      await refresh();
    } catch (error) { if (active()) setMessage((error as Error).message); }
    finally { if (active()) setStep("idle"); }
  }
  return <div className="spoken-input">
    <div className="voice-controls">
      {phase === "idle" && <Button variant="outline" disabled={disabled || !available} onClick={() => void record()}><Mic size={16} aria-hidden="true" /> Speak {purpose === "question" ? "your question" : "your note"}</Button>}
      {phase === "permission" && <><span className="small" role="status">Waiting for microphone permission…</span><Button variant="outline" onClick={cancel}>Cancel microphone request</Button></>}
      {phase === "recording" && <><span className="recording-indicator" aria-hidden="true" /><output aria-label="Recording seconds">{seconds}s / {MAX_VOICE_SECONDS}s</output><Button onClick={() => stop.current?.()}><Square size={14} aria-hidden="true" /> Stop & transcribe</Button><Button variant="ghost" onClick={cancel}>Cancel recording</Button></>}
      {["converting", "transcribing", "checking"].includes(phase) && <span className="voice-working" role="status"><LoaderCircle className="spin" size={16} aria-hidden="true" />{phase === "checking" ? "Checking the saved transcript…" : phase === "converting" ? "Preparing your recording…" : "Turning speech into text…"}</span>}
    </div>
    <p className="small muted">{!state.aiConfigured ? "Voice input is awaiting AI setup. Typing is always available." : !available ? "New voice transcription is paused by your usage limit. You can still type." : "Up to 30 seconds while this app is open. Review the transcript before adding it to your draft."}</p>
    {message && <p className="small voice-message" role="status">{message}</p>}
    {transcript !== null && <div className="transcript-editor"><label htmlFor={inputId} className="small">Review transcript</label><Textarea id={inputId} value={transcript} onChange={e => setTranscript(e.target.value)} maxLength={maxLength} disabled={busy} /><div className="voice-controls"><Button variant="outline" disabled={disabled || busy || !transcript.trim() || transcript.length > maxLength} onClick={() => { try { onText(transcript.trim()); setTranscript(null); setMessage("Added to your draft. You can edit it before submitting."); } catch (error) { setMessage((error as Error).message); } }}>Use transcript</Button><Button variant="ghost" disabled={busy} onClick={() => { setTranscript(null); setMessage(""); }}>Close transcript</Button></div>{transcript.length > maxLength && <p className="small">Shorten the transcript to {maxLength} characters before using it.</p>}</div>}
    {history.length > 0 && <details className="voice-history"><summary>Recent voice drafts</summary>{history.map(draft => <div key={draft.id}><p className="small">{new Date(draft.created_at).toLocaleString()} · {Math.ceil(draft.duration_ms / 1000)} seconds{!draft.result && " · result pending"}</p><Button variant="ghost" disabled={busy || disabled} onClick={() => void recover(draft.id)}>{draft.result ? "Review saved transcript" : "Check saved result"}</Button></div>)}</details>}
  </div>;
}
