-- A current, explicit final-cost check reconciles the reservation without changing
-- the original provider ledger. Stale evidence falls back to conservative amounts.
DROP VIEW accounted_spending;
--> statement-breakpoint
CREATE VIEW accounted_spending AS
WITH original AS (
  SELECT spending.*, json_object('id',id,'month',month,'kind',kind,'basis',basis,
    'status',status,'reserved',reserved,'charged',charged,'providerRequest',provider_request,
    'result',result,'jobToken',job_token,'createdAt',created_at,'updatedAt',updated_at) AS snapshot
  FROM spending
)
SELECT s.*, r.id AS review_id,
  CASE WHEN r.snapshot=s.snapshot THEN 1 ELSE 0 END AS review_current,
  CASE WHEN r.decision='confirmed' AND r.snapshot=s.snapshot THEN r.amount
    ELSE MAX(COALESCE(s.charged,s.reserved),COALESCE((SELECT amount FROM spend_reviews
      WHERE spending_id=s.id AND decision='confirmed' ORDER BY revision DESC LIMIT 1),0)) END AS effective,
  CASE WHEN (s.status='cost_review' OR COALESCE(r.decision,'')='confirmed')
    AND NOT (COALESCE(r.decision,'')='confirmed' AND COALESCE(r.snapshot,'')=s.snapshot)
    THEN 1 ELSE 0 END AS needs_review
FROM original s LEFT JOIN spend_reviews r ON r.spending_id=s.id
  AND r.revision=(SELECT MAX(revision) FROM spend_reviews WHERE spending_id=s.id);
--> statement-breakpoint
PRAGMA optimize;
