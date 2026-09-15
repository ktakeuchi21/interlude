CREATE TABLE `activity` (
	`user_id` text NOT NULL,
	`minute` integer NOT NULL,
	`low` integer DEFAULT 0 NOT NULL,
	`high` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `minute`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_user_time` ON `events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lesson_versions` (
	`key` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`version` integer NOT NULL,
	`course_id` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lesson_course` ON `lesson_versions` (`course_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`lesson_key` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`duration` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_key` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_user_lesson` ON `notes` (`user_id`,`lesson_key`);--> statement-breakpoint
CREATE TABLE `owner` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `progress` (
	`user_id` text NOT NULL,
	`lesson_key` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`section` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`observed_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`user_id`, `lesson_key`)
);
--> statement-breakpoint
CREATE TABLE `spending` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`reserved` integer NOT NULL,
	`charged` integer,
	`basis` text NOT NULL,
	`provider_request` text,
	`result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spending_month` ON `spending` (`month`);