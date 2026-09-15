import { z } from "zod";
import { AppError } from "./errors";
import { withGenerationLock } from "./jobs";
import { textFingerprint } from "./narration-records";
import type { CostReview, SpendingRecord } from "./contracts";

export const reviewCostRequest = z.object({
  id: z.string().uuid(), spendingId: z.string().min(1).max(200),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/), previousReviewId: z.string().uuid().nullable(),
  decision: z.enum(["confirmed", "keep_reserved"]), amount: z.number().int().min(0).max(100_000_000).nullable(),
  evidence: z.string().trim().min(20).max(2000), confirmedFinalOutcome: z.boolean(),
}).strict().refine(v => v.decision === "confirmed" ? v.amount !== null && v.confirmedFinalOutcome : v.amount === null && !v.confirmedFinalOutcome, "Confirm a final provider cost, or keep the amount reserved.");
export type AccountedSpend = { id: string; month: string; kind: string; status: string; reserved: number; charged: number | null; basis: string; provider_request: string | null; result: string | null; job_token: string | null; created_at: number; updated_at: number; snapshot: string; effective: number; review_id: string | null; review_current: number; needs_review: number };
export async function publicSpend(row: AccountedSpend): Promise<SpendingRecord> {
  return { id: row.id, month: row.month, kind: row.kind, status: row.status, reserved: row.reserved, charged: row.charged, basis: row.basis, provider_request: row.provider_request, created_at: row.created_at,
    effective: row.effective, fingerprint: await textFingerprint(row.snapshot), reviewId: row.review_id, reviewCurrent: Boolean(row.review_current), needsReview: Boolean(row.needs_review),
  };
}

/** Records an owner's evidence; it is not an automatic provider invoice check. */
export async function recordCostReview(db: D1Database, userId: string, input: z.input<typeof reviewCostRequest>) {
  const data = reviewCostRequest.parse(input);
  const owner = await db.prepare("SELECT user_id FROM owner WHERE id=1").first<{ user_id: string }>();
  if (owner?.user_id !== userId) throw new AppError("Only the owner can review this app's costs.", 403);
  async function existing() {
    const row = await db.prepare("SELECT * FROM spend_reviews WHERE id=?").bind(data.id).first<CostReview & { user_id: string; snapshot: string }>();
    if (!row) return null;
    const previous = row.revision > 1 ? await db.prepare("SELECT id FROM spend_reviews WHERE spending_id=? AND revision=?").bind(data.spendingId, row.revision - 1).first<{ id: string }>() : null;
    if (row.user_id !== userId || row.spending_id !== data.spendingId || row.decision !== data.decision || row.amount !== data.amount || row.evidence !== data.evidence || await textFingerprint(row.snapshot) !== data.expectedFingerprint || (previous?.id ?? null) !== data.previousReviewId) throw new AppError("This cost-check ID already has different details. Refresh before saving a correction.", 409);
    return { id: row.id, spending_id: row.spending_id, revision: row.revision, decision: row.decision, amount: row.amount, evidence: row.evidence, created_at: row.created_at };
  }
  const saved = await existing(); if (saved) return saved;
  return withGenerationLock(db, `cost-review:${data.id}`, async claim => {
    const saved = await existing(); if (saved) return saved;
    const row = await db.prepare("SELECT * FROM accounted_spending WHERE id=?").bind(data.spendingId).first<AccountedSpend>();
    if (!row) throw new AppError("That app request was not found.", 404);
    if (row.status === "released") throw new AppError("This legacy released record needs operator inspection.", 409);
    if (await textFingerprint(row.snapshot) !== data.expectedFingerprint || row.review_id !== data.previousReviewId) throw new AppError("The request or its cost check changed. Refresh usage before reviewing it.", 409);
    const previous = row.review_id ? await db.prepare("SELECT revision FROM spend_reviews WHERE id=?").bind(row.review_id).first<{ revision: number }>() : null;
    const revision = (previous?.revision ?? 0) + 1, now = Date.now();
    await claim.assertActive();
    const inserted = await db.prepare(`INSERT OR IGNORE INTO spend_reviews(id,spending_id,user_id,revision,snapshot,decision,amount,evidence,created_at)
      SELECT ?,?,?,?,?,?,?,?,? FROM accounted_spending WHERE id=? AND snapshot=? AND review_id IS ?
      AND (SELECT COUNT(*) FROM spend_reviews)<2000`)
      .bind(data.id, data.spendingId, userId, revision, row.snapshot, data.decision, data.amount, data.evidence, now, data.spendingId, row.snapshot, data.previousReviewId).run();
    if (inserted.meta.changes !== 1) throw new AppError("This request changed during the check or the 2,000-record cost history is full. Nothing was replaced.", 409);
    return (await existing())!;
  });
}
