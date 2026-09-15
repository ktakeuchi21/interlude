CREATE TABLE `transcriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_key` text NOT NULL,
	`purpose` text NOT NULL,
	`audio_hash` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`result` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transcriptions_user_lesson` ON `transcriptions` (`user_id`,`lesson_key`);