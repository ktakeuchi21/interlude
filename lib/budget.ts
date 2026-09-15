import { AppError } from "./errors";
export const MONTHLY_LIMIT = 8_000_000; // Integer millionths of a dollar.
export function billingMonth(now = Date.now()) { return new Date(now).toISOString().slice(0, 7); }
export async function budgetSummary(db: D1Database) {
  const month = billingMonth();
  const row = await db.prepare("SELECT COALESCE(SUM(effective),0) AS total FROM accounted_spending WHERE month=? AND status != 'released'").bind(month).first<{ total: number }>();
  const paused = Boolean(await db.prepare("SELECT id FROM accounted_spending WHERE needs_review=1 LIMIT 1").first());
  return { month, limit: MONTHLY_LIMIT, committed: row?.total ?? 0, paused };
}
export async function reserveSpend(db: D1Database, id: string, kind: string, amount: number, basis: string, jobToken: string | null = null, replacementId: string | null = null) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MONTHLY_LIMIT) throw new AppError("Invalid spending reservation.");
  if (id.startsWith("replacement:") !== Boolean(replacementId)) throw new AppError("A replacement request requires its saved permission.", 409);
  const now = Date.now(), month = billingMonth(now);
  const result = await db.prepare(`INSERT OR IGNORE INTO spending (id,month,kind,status,reserved,basis,job_token,created_at,updated_at)
    SELECT ?,?,?,'reserved',?,?,?,?,? WHERE
    (SELECT COALESCE(SUM(effective),0) FROM accounted_spending WHERE month=? AND status!='released') + ? <= ?
    AND NOT EXISTS(SELECT id FROM accounted_spending WHERE needs_review=1)
    AND (? IS NULL OR EXISTS(SELECT r.id FROM narration_replacements r JOIN accounted_spending p ON p.id=r.parent_id
      WHERE r.id=? AND r.operation_id=? AND r.max_cost>=? AND p.review_current=1 AND p.review_id IS NOT NULL AND p.needs_review=0))`)
    .bind(id, month, kind, amount, basis, jobToken, now, now, month, amount, MONTHLY_LIMIT, replacementId, replacementId, id, amount).run();
  if (result.meta.changes === 1) return;
  const previous = await db.prepare("SELECT status FROM spending WHERE id=?").bind(id).first<{ status: string }>();
  if (previous) throw new AppError("This generation was already started. Its saved result or cost needs reconciliation before another attempt.", 409);
  if (await db.prepare("SELECT id FROM accounted_spending WHERE needs_review=1 LIMIT 1").first()) throw new AppError("New paid work is paused while an unexpected usage amount is reviewed. Saved lessons remain available.", 402);
  if (replacementId && !await db.prepare(`SELECT r.id FROM narration_replacements r JOIN accounted_spending p ON p.id=r.parent_id WHERE r.id=? AND r.operation_id=? AND r.max_cost>=? AND p.review_current=1 AND p.review_id IS NOT NULL AND p.needs_review=0`).bind(replacementId, id, amount).first()) throw new AppError("This replacement needs a current cost check before a new request can start.", 409);
  throw new AppError("This month's generation allowance is used. Your saved lessons are still available.", 402);
}
export async function settleSpend(db: D1Database, id: string, charged: number, providerRequest: string | null, result: string) {
  const reservation = await db.prepare("SELECT reserved,status,charged,provider_request,result FROM spending WHERE id=?").bind(id).first<{ reserved: number; status: string; charged: number | null; provider_request: string | null; result: string | null }>();
  if (!Number.isSafeInteger(charged) || charged < 0 || !reservation || charged > reservation.reserved) throw new AppError("This cost needs reconciliation before it can be settled.", 409);
  if (reservation.status === "complete") {
    if (reservation.charged !== charged || reservation.provider_request !== providerRequest || reservation.result !== result) throw new AppError("A settled cost cannot be silently replaced.", 409);
    return;
  }
  if (!["reserved", "uncertain"].includes(reservation.status)) throw new AppError("This cost needs review before settlement.", 409);
  await db.prepare("UPDATE spending SET status='complete',charged=?,provider_request=?,result=?,updated_at=? WHERE id=? AND status IN ('reserved','uncertain')")
    .bind(charged, providerRequest, result, Date.now(), id).run();
}
export async function uncertainSpend(db: D1Database, id: string) {
  await db.prepare("UPDATE spending SET status='uncertain',updated_at=? WHERE id=? AND status='reserved'").bind(Date.now(), id).run();
}
