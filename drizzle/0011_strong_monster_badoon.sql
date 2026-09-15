CREATE TABLE `spend_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`spending_id` text NOT NULL,
	`user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`decision` text NOT NULL,
	`amount` integer,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spend_review_revision` ON `spend_reviews` (`spending_id`,`revision`);
--> statement-breakpoint
CREATE TRIGGER spend_review_immutable BEFORE UPDATE ON spend_reviews
BEGIN
  SELECT RAISE(ABORT, 'Cost review history cannot be changed');
END;
--> statement-breakpoint
CREATE VIEW accounted_spending AS
WITH original AS (
  SELECT spending.*, json_object('status',status,'reserved',reserved,'charged',charged,
    'providerRequest',provider_request,'result',result,'updatedAt',updated_at) AS snapshot
  FROM spending
)
SELECT s.*, r.id AS review_id,
  CASE WHEN r.snapshot=s.snapshot THEN 1 ELSE 0 END AS review_current,
  MAX(COALESCE(s.charged,s.reserved),COALESCE(r.amount,0)) AS effective,
  CASE WHEN s.status='cost_review' AND NOT (COALESCE(r.decision,'')='confirmed' AND COALESCE(r.snapshot,'')=s.snapshot)
    THEN 1 ELSE 0 END AS needs_review
FROM original s LEFT JOIN spend_reviews r ON r.spending_id=s.id
  AND r.revision=(SELECT MAX(revision) FROM spend_reviews WHERE spending_id=s.id);
--> statement-breakpoint
PRAGMA optimize;
