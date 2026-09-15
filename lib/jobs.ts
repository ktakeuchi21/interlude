import { AppError } from "./errors";
export const JOB_DURATION = 10 * 60_000;
export type GenerationClaim = { token: string; assertActive: () => Promise<void> };
export async function withGenerationLock<T>(db: D1Database, jobId: string, work: (claim: GenerationClaim) => Promise<T>, clock = Date.now): Promise<T> {
  const token = crypto.randomUUID(), now = clock(), expires = now + JOB_DURATION;
  const claim = await db.prepare("INSERT OR IGNORE INTO generation_lock(id,job_id,created_at,token,expires_at) VALUES(1,?,?,?,?)").bind(jobId, now, token, expires).run();
  if (claim.meta.changes !== 1) throw new AppError("Another preparation is running or needs recovery. Saved lessons remain available.", 409);
  const assertActive = async () => {
    if (clock() >= expires || !await db.prepare("SELECT token FROM generation_lock WHERE id=1 AND token=?").bind(token).first()) throw new AppError("This preparation expired. Saved results and reserved costs are retained. Open Settings to check its recovery state.", 409);
  };
  // An explicit recovery fences the old worker. Its deterministic spending IDs
  // remain permanently reserved, so releasing a lock cannot resend a paid call.
  try { return await work({ token, assertActive }); }
  finally { await db.prepare("DELETE FROM generation_lock WHERE id=1 AND token=?").bind(token).run(); }
}
export async function recoverGenerationLock(db: D1Database, token: string, now = Date.now()) {
  const lock = await db.prepare("SELECT token,expires_at FROM generation_lock WHERE id=1").first<{ token: string; expires_at: number }>();
  if (!lock) return;
  if (!token || lock.token !== token || lock.expires_at > now) throw new AppError("This preparation is still active, or its recovery state changed. Refresh before trying again.", 409);
  await db.batch([
    db.prepare("UPDATE spending SET status='uncertain',updated_at=? WHERE job_token=? AND status='reserved'").bind(now, token),
    db.prepare("DELETE FROM generation_lock WHERE id=1 AND token=? AND expires_at<=?").bind(token, now),
  ]);
}
export async function boundedBytes(response: Response, maximum: number) {
  if (!response.body) throw new AppError("The service returned an empty file.", 502);
  if (Number(response.headers.get("content-length") ?? 0) > maximum) { await response.body.cancel(); throw new AppError("The service returned an oversized file.", 502); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.length;
      if (total > maximum) { await reader.cancel(); throw new AppError("The service returned an oversized file.", 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
