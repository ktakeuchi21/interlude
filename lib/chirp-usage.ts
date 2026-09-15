import { AppError } from "./errors";
import { CHIRP_LIMIT, CHIRP_WINDOW, type ChirpAudio, type ChirpState, type ChirpVoice } from "./chirp-voices";

export async function chirpSummary(db: D1Database, configured: boolean, now = Date.now()): Promise<ChirpState> {
  const month = new Date(now).toISOString().slice(0, 7), monthStart = Date.parse(`${month}-01T00:00:00Z`);
  const [usage, setting, previews, pending] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(CASE WHEN created_at>=? THEN characters ELSE 0 END),0) AS used, COALESCE(SUM(CASE WHEN created_at>=? THEN characters ELSE 0 END),0) AS monthUsed, COALESCE(SUM(CASE WHEN status!='complete' THEN 1 ELSE 0 END),0) AS held FROM chirp_requests").bind(now - CHIRP_WINDOW, monthStart).first<{ used: number; monthUsed: number; held: number }>(),
    db.prepare("SELECT voice FROM chirp_settings WHERE id=1").first<{ voice: ChirpVoice }>(),
    db.prepare("SELECT id,voice,kind,lesson_key,object_key,bytes,duration FROM chirp_audio WHERE kind IN ('sample','pilot') ORDER BY kind,voice").all<ChirpAudio>(),
    db.prepare("SELECT id,voice,kind,lesson_key,object_key,bytes,duration FROM chirp_audio WHERE kind='lesson' AND object_key IS NULL ORDER BY created_at LIMIT 24").all<ChirpAudio>(),
  ]);
  return { configured, voice: setting?.voice ?? null, used: usage?.used ?? 0, monthUsed: usage?.monthUsed ?? 0, held: usage?.held ?? 0, month, limit: CHIRP_LIMIT, previews: previews.results, pending: pending.results };
}

export async function reserveChirp(db: D1Database, id: string, audioId: string, fingerprint: string, characters: number, now = Date.now()) {
  if (!Number.isSafeInteger(characters) || characters < 1 || characters > 3800) throw new AppError("Invalid narration size.");
  const result = await db.prepare(`INSERT OR IGNORE INTO chirp_requests(id,audio_id,input_sha256,characters,status,created_at)
    SELECT ?,?,?,?,'reserved',? WHERE (SELECT COALESCE(SUM(characters),0) FROM chirp_requests WHERE created_at>=?)+?<=?
    AND NOT EXISTS(SELECT id FROM chirp_requests WHERE status!='complete') AND (SELECT COUNT(*) FROM chirp_requests)<12000`)
    .bind(id, audioId, fingerprint, characters, now, now - CHIRP_WINDOW, characters, CHIRP_LIMIT).run();
  if (result.meta.changes !== 1) throw new AppError("Chirp narration is paused: its allowance is full, or an earlier attempt needs recovery. This request was not sent to Google.", 409);
}
export async function settleChirp(db: D1Database, id: string, fingerprint: string, characters: number) {
  const result = await db.prepare("UPDATE chirp_requests SET status='complete' WHERE id=? AND input_sha256=? AND characters=?").bind(id, fingerprint, characters).run();
  if (result.meta.changes !== 1) throw new AppError("Saved Chirp usage needs reconciliation.", 409);
}
