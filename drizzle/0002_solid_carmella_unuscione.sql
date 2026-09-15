CREATE TABLE `generation_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`detail` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_user` ON `library_items` (`user_id`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
