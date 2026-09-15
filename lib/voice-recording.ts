import { encodeVoiceWav, MAX_VOICE_SECONDS, VOICE_SAMPLE_RATE, validateVoiceWav } from "./voice-audio";

export function microphoneMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was not allowed. You can enable it in your browser's site settings, or keep typing.";
  if (name === "NotFoundError") return "No microphone was found. Connect one or type instead.";
  if (name === "NotReadableError") return "The microphone is unavailable or in use. Close the other recording app, or type instead.";
  if (name === "AbortError") return "Recording cancelled. Your typed draft is unchanged.";
  return error instanceof Error ? error.message : "Recording was interrupted. You can type instead.";
}
// getUserMedia may never settle when its permission prompt is ignored. The
// abort path returns immediately and stops a stream even if permission arrives late.
export function requestMicrophone(signal: AbortSignal, devices: Pick<MediaDevices, "getUserMedia"> = navigator.mediaDevices): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Recording cancelled", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false }).then(stream => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); abort(); }
      else resolve(stream);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
export async function startVoiceRecording(signal: AbortSignal, onSeconds: (value: number) => void) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof OfflineAudioContext === "undefined") throw new Error("This browser cannot record here. Open the app in Safari or keep typing.");
  const stream = await requestMicrophone(signal);
  const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(type => MediaRecorder.isTypeSupported(type));
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 }); }
  catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
  const chunks: Blob[] = []; let size = 0, stopping = false, done = false, ticker: ReturnType<typeof setInterval>, deadline: ReturnType<typeof setTimeout>;
  let finish!: (blob: Blob) => void, fail!: (error: Error) => void;
  const finished = new Promise<Blob>((resolve, reject) => { finish = resolve; fail = reject; });
  // The caller receives the promise after this function resolves; attach a
  // handler now so a synchronous cancellation cannot report an unhandled rejection.
  void finished.catch(() => {});
  const release = () => { clearInterval(ticker); clearTimeout(deadline); signal.removeEventListener("abort", abort); stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); };
  const reject = (error: Error) => { if (done) return; done = true; if (recorder.state !== "inactive") recorder.stop(); release(); fail(error); };
  const abort = () => reject(new DOMException("Recording cancelled", "AbortError"));
  const stop = () => { if (done || stopping) return; stopping = true; clearInterval(ticker); clearTimeout(deadline); if (recorder.state !== "inactive") recorder.stop(); stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); };
  recorder.ondataavailable = event => { if (done || !event.data.size) return; size += event.data.size; if (size > 2_000_000) reject(new Error("The recording grew too large. Try a shorter answer or type instead.")); else chunks.push(event.data); };
  recorder.onerror = () => reject(new Error("The microphone stopped unexpectedly. Your typed draft is unchanged."));
  recorder.onstop = () => { if (done) return; done = true; release(); finish(new Blob(chunks, { type: recorder.mimeType })); };
  stream.getTracks().forEach(track => { track.onended = () => reject(new Error("The microphone disconnected. You can try again or type instead.")); });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  else {
    try { recorder.start(1000); const start = Date.now(); ticker = setInterval(() => onSeconds(Math.min(MAX_VOICE_SECONDS, Math.floor((Date.now() - start) / 1000))), 250); deadline = setTimeout(stop, MAX_VOICE_SECONDS * 1000); }
    catch (error) { reject(error instanceof Error ? error : new Error("Recording could not start.")); }
  }
  return { stop, finished };
}
export async function recordingToWav(blob: Blob) {
  if (!blob.size || blob.size > 2_000_000) throw new Error("No usable recording was captured. You can try again or type instead.");
  const decoder = new OfflineAudioContext(1, 1, VOICE_SAMPLE_RATE);
  const audio = await decoder.decodeAudioData(await blob.arrayBuffer());
  if (audio.sampleRate !== VOICE_SAMPLE_RATE || audio.duration > MAX_VOICE_SECONDS + 5 || audio.numberOfChannels > 2) throw new Error("The recording format could not be safely converted. Try a shorter recording or type instead.");
  const wav = encodeVoiceWav(Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel)));
  validateVoiceWav(wav);
  return wav;
}
