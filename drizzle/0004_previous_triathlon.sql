CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_key` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `questions_user_lesson` ON `questions` (`user_id`,`lesson_key`);--> statement-breakpoint
ALTER TABLE `generation_lock` ADD `token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_lock` ADD `expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `spending` ADD `job_token` text;