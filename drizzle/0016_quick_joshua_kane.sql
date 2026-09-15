CREATE TABLE `weekly_batches` (
	`user_id` text NOT NULL,
	`week` text NOT NULL,
	`origin` text NOT NULL,
	`items` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `week`)
);
--> statement-breakpoint
CREATE TABLE `weekly_choices` (
	`user_id` text NOT NULL,
	`week` text NOT NULL,
	`item_id` text NOT NULL,
	`dismissed` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `week`, `item_id`)
);
--> statement-breakpoint
CREATE TRIGGER `weekly_batch_immutable` BEFORE UPDATE ON `weekly_batches`
BEGIN SELECT RAISE(ABORT, 'Saved weekly suggestions cannot be changed'); END;
