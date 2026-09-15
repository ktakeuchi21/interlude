CREATE TABLE `weekly_refreshes` (
	`user_id` text NOT NULL,
	`week` text NOT NULL,
	`origin` text NOT NULL,
	`lesson_key` text,
	`lesson_title` text,
	`reason` text NOT NULL,
	`topic_id` text NOT NULL,
	`research_id` text NOT NULL,
	`preparation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `week`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_refresh_topic` ON `weekly_refreshes` (`topic_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_refresh_research` ON `weekly_refreshes` (`research_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_refresh_preparation` ON `weekly_refreshes` (`preparation_id`);
--> statement-breakpoint
CREATE TRIGGER weekly_refresh_immutable BEFORE UPDATE ON weekly_refreshes
BEGIN SELECT RAISE(ABORT, 'A weekly refresh keeps its original target and request identities'); END;
--> statement-breakpoint
PRAGMA optimize;
