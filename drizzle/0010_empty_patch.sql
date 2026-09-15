CREATE TABLE `lesson_preparations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`inputs` text NOT NULL,
	`inspection` text,
	`draft` text,
	`review` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `preparations_user_topic` ON `lesson_preparations` (`user_id`,`topic_id`);--> statement-breakpoint
CREATE INDEX `preparations_created` ON `lesson_preparations` (`created_at`);
--> statement-breakpoint
CREATE TRIGGER preparation_evidence_immutable BEFORE UPDATE ON lesson_preparations
WHEN OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id OR OLD.topic_id IS NOT NEW.topic_id
  OR OLD.inputs IS NOT NEW.inputs OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.inspection IS NOT NULL AND OLD.inspection IS NOT NEW.inspection)
  OR (OLD.draft IS NOT NULL AND OLD.draft IS NOT NEW.draft)
  OR (OLD.review IS NOT NULL AND OLD.review IS NOT NEW.review)
BEGIN
  SELECT RAISE(ABORT, 'Saved preparation inputs and completed steps cannot be changed');
END;
--> statement-breakpoint
PRAGMA optimize;
