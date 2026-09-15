import { AppError } from "./errors";
export const VOICE_SAMPLE_RATE = 16_000;
export const MAX_VOICE_SECONDS = 30;
export const MAX_VOICE_BYTES = 44 + VOICE_SAMPLE_RATE * MAX_VOICE_SECONDS * 2;
export function encodeVoiceWav(channels: Float32Array[]): Uint8Array<ArrayBuffer> {
  if (!channels.length || channels.some(c => c.length !== channels[0].length)) throw new AppError("The recording could not be converted. You can type instead.");
  const frames = Math.min(channels[0].length, VOICE_SAMPLE_RATE * MAX_VOICE_SECONDS);
  const bytes = new Uint8Array(44 + frames * 2), view = new DataView(bytes.buffer);
  const word = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  word(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); word(8, "WAVE"); word(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true); view.setUint32(28, VOICE_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, "data"); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const average = channels.reduce((sum, c) => sum + (Number.isFinite(c[i]) ? c[i] : 0), 0) / channels.length;
    const sample = Math.max(-1, Math.min(1, average));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function validateVoiceWav(bytes: Uint8Array) {
  const invalid = () => { throw new AppError("Use a recording made in this app, between 1 and 30 seconds long.", 400); };
  if (bytes.length < 44 + VOICE_SAMPLE_RATE * 2 || bytes.length > MAX_VOICE_BYTES || bytes.length % 2) return invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), word = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (word(0, 4) !== "RIFF" || word(8, 4) !== "WAVE" || word(12, 4) !== "fmt " || word(36, 4) !== "data" ||
    view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== VOICE_SAMPLE_RATE || view.getUint32(28, true) !== VOICE_SAMPLE_RATE * 2 || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44) return invalid();
  let sound = false; for (let i = 44; i < bytes.length; i += 2) if (view.getInt16(i, true) !== 0) { sound = true; break; }
  if (!sound) throw new AppError("No sound was captured. Check your microphone or type instead.");
  return { durationMs: (bytes.length - 44) / (VOICE_SAMPLE_RATE * 2) * 1000 };
}
export async function voiceFingerprint(bytes: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, b => b.toString(16).padStart(2, "0")).join("");
}
