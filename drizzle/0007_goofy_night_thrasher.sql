CREATE TABLE `source_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`library_item_id` text NOT NULL,
	`requested_url` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`material` text,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `source_captures_user_item` ON `source_captures` (`user_id`,`library_item_id`);--> statement-breakpoint
CREATE INDEX `source_captures_created` ON `source_captures` (`created_at`);
--> statement-breakpoint
CREATE TRIGGER source_capture_immutable BEFORE UPDATE ON source_captures
WHEN OLD.status IN ('retrieved','unavailable')
BEGIN
  SELECT RAISE(ABORT, 'Finished source retrievals cannot be changed');
END;
