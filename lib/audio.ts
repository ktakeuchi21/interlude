import { AppError } from "./errors";
export function splitNarration(text: string, limit = 3800) {
  const chunks: string[] = []; let current = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > limit) throw new AppError("The narration contains an oversized word.");
    if (current && current.length + word.length + 1 > limit) { chunks.push(current); current = ""; }
    current += (current ? " " : "") + word;
  }
  if (current) chunks.push(current);
  return chunks;
}
export function waveHeader(bytes: number) {
  const buffer = new ArrayBuffer(44), view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, bytes, true); return new Uint8Array(buffer);
}
export function parseRange(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new AppError("Invalid audio range.", 416);
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new AppError("Audio range is outside the file.", 416);
  return { offset: start, length: end - start + 1, end };
}
