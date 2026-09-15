CREATE TABLE `topic_research` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`search` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `research_user_topic` ON `topic_research` (`user_id`,`topic_id`);--> statement-breakpoint
CREATE INDEX `research_created` ON `topic_research` (`created_at`);
--> statement-breakpoint
CREATE TRIGGER research_search_immutable BEFORE UPDATE ON topic_research
WHEN OLD.search IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Saved research results cannot be changed');
END;
