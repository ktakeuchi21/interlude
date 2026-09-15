CREATE TABLE `chirp_audio` (
	`id` text PRIMARY KEY NOT NULL,
	`voice` text NOT NULL,
	`kind` text NOT NULL,
	`lesson_key` text,
	`input_sha256` text NOT NULL,
	`object_key` text,
	`bytes` integer,
	`duration` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chirp_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_id` text NOT NULL,
	`input_sha256` text NOT NULL,
	`characters` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chirp_requests_created` ON `chirp_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `chirp_requests_status` ON `chirp_requests` (`status`);--> statement-breakpoint
CREATE TABLE `chirp_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`voice` text NOT NULL
);
