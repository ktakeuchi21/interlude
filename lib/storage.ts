import { AppError } from "./errors";
export const STORAGE_LIMIT = 2_000_000_000;
export async function reserveStorage(db: D1Database, id: string, bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > STORAGE_LIMIT) throw new AppError("Invalid storage allocation.");
  const previous = await db.prepare("SELECT bytes FROM storage_allocations WHERE id=?").bind(id).first<{ bytes: number }>();
  if (previous) { if (previous.bytes >= bytes) return; throw new AppError("This audio allocation needs recovery before expanding.", 409); }
  const result = await db.prepare("INSERT OR IGNORE INTO storage_allocations(id,bytes,status,updated_at) SELECT ?,?,'reserved',? WHERE (SELECT COALESCE(SUM(bytes),0) FROM storage_allocations)+?<=?")
    .bind(id, bytes, Date.now(), bytes, STORAGE_LIMIT).run();
  if (result.meta.changes !== 1) throw new AppError("Audio storage allowance reached. Your saved lessons remain available.", 402);
}
export async function settleStorage(db: D1Database, id: string, bytes: number) {
  const result = await db.prepare("UPDATE storage_allocations SET bytes=?,status='complete',updated_at=? WHERE id=? AND bytes>=?").bind(bytes, Date.now(), id, bytes).run();
  if (result.meta.changes !== 1) throw new AppError("The stored file allocation needs reconciliation.", 409);
}
