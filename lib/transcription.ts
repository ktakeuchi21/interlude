import { z } from "zod";
import { AppError } from "./errors";
import { reserveSpend, settleSpend, uncertainSpend } from "./budget";
import { boundedBytes, withGenerationLock } from "./jobs";
import { validateVoiceWav, voiceFingerprint } from "./voice-audio";
import type { VoiceDraft, VoicePurpose, VoiceResult } from "./contracts";

export const TRANSCRIPTION_RESERVATION = 6000;
const costBasis = "whisper-1, $0.006/minute; one full minute reserved for at most 30 seconds of validated audio; upper bound, not provider invoice; verified 2026-09-13";
export type VoiceRow = { id: string; user_id: string; lesson_key: string; purpose: VoicePurpose; audio_hash: string; duration_ms: number; result: string | null; created_at: number };
export function voiceFromRow(row: VoiceRow): VoiceDraft { return { id: row.id, lesson_key: row.lesson_key, purpose: row.purpose, duration_ms: row.duration_ms, result: row.result ? JSON.parse(row.result) as VoiceResult : null, created_at: row.created_at }; }

export async function getVoiceDraft(db: D1Database, userId: string, id: string) {
  const row = await db.prepare("SELECT * FROM transcriptions WHERE id=? AND user_id=?").bind(id, userId).first<VoiceRow>();
  if (!row) throw new AppError("This voice draft has not been saved yet.", 404);
  const draft = voiceFromRow(row);
  if (draft.result) await settleSpend(db, `transcribe:${id}`, draft.result.cost, draft.result.providerRequest, JSON.stringify({ voiceDraftId: id, basis: costBasis }));
  return draft;
}
export async function transcribeVoice(db: D1Database, userId: string, data: { id: string; key: string; purpose: VoicePurpose; bytes: Uint8Array<ArrayBuffer> }, services: { apiKey?: string; fetch?: typeof fetch }) {
  const { durationMs } = validateVoiceWav(data.bytes), hash = await voiceFingerprint(data.bytes);
  const existing = async () => {
    const row = await db.prepare("SELECT * FROM transcriptions WHERE id=?").bind(data.id).first<VoiceRow>();
    if (!row) return null;
    if (row.user_id !== userId || row.lesson_key !== data.key || row.purpose !== data.purpose || row.audio_hash !== hash) throw new AppError("This recording ID belongs to different audio. A saved attempt cannot be replaced.", 409);
    return getVoiceDraft(db, userId, data.id);
  };
  const saved = await existing(); if (saved?.result) return saved;
  if (!services.apiKey) throw new AppError("Transcription is awaiting secure AI setup. You can type your question or note.", 503);
  if (Date.now() > Date.UTC(2026, 10, 13)) throw new AppError("New transcription is paused until its pricing is checked again. Saved text remains available.", 402);
  return withGenerationLock(db, `transcribe:${data.id}`, async claim => {
    const repeated = await existing(); if (repeated?.result) return repeated;
    await db.prepare("INSERT OR IGNORE INTO transcriptions(id,user_id,lesson_key,purpose,audio_hash,duration_ms,created_at) VALUES(?,?,?,?,?,?,?)").bind(data.id, userId, data.key, data.purpose, hash, Math.ceil(durationMs), Date.now()).run();
    const operation = `transcribe:${data.id}`;
    await claim.assertActive();
    await reserveSpend(db, operation, "voice transcription", TRANSCRIPTION_RESERVATION, costBasis, claim.token);
    try {
      const form = new FormData();
      form.set("model", "whisper-1"); form.set("response_format", "verbose_json");
      form.set("file", new Blob([data.bytes], { type: "audio/wav" }), "voice-draft.wav");
      await claim.assertActive();
      const response = await (services.fetch ?? fetch)("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${services.apiKey}` }, body: form, signal: AbortSignal.timeout(90_000) });
      const providerRequest = response.headers.get("x-request-id");
      await db.prepare("UPDATE spending SET provider_request=? WHERE id=? AND status='reserved'").bind(providerRequest, operation).run();
      if (!response.ok) throw new AppError("Transcription did not finish. Its cost stays reserved; the recording will not be sent again automatically.", 502);
      const result = z.object({ text: z.string().max(5000), duration: z.number().finite().nonnegative() }).parse(JSON.parse(new TextDecoder().decode(await boundedBytes(response, 64_000))));
      if (result.duration > 60) {
        await db.prepare("UPDATE spending SET status='cost_review',charged=?,result=?,updated_at=? WHERE id=?").bind(Math.ceil(result.duration / 60) * TRANSCRIPTION_RESERVATION, JSON.stringify({ reason: "Transcription duration exceeded reservation", seconds: result.duration }), Date.now(), operation).run();
        throw new AppError("Unexpected transcription usage needs review. New paid work is paused.", 502);
      }
      const voiceResult: VoiceResult = { text: result.text.trim(), cost: TRANSCRIPTION_RESERVATION, costBasis, providerRequest, model: "whisper-1", transcribedAt: Date.now() };
      await claim.assertActive();
      await db.prepare("UPDATE transcriptions SET result=? WHERE id=? AND user_id=? AND result IS NULL").bind(JSON.stringify(voiceResult), data.id, userId).run();
      await settleSpend(db, operation, TRANSCRIPTION_RESERVATION, providerRequest, JSON.stringify({ voiceDraftId: data.id, basis: costBasis }));
      return getVoiceDraft(db, userId, data.id);
    } catch (error) {
      await uncertainSpend(db, operation);
      if (error instanceof AppError) throw error;
      throw new AppError("The transcript was interrupted or unreadable. Its cost is reserved; check the saved result before making another recording.", 502);
    }
  });
}
