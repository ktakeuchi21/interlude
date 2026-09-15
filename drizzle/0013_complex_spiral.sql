CREATE TABLE `narration_replacements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`root_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`parent_id` text NOT NULL,
	`review_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`lesson_key` text NOT NULL,
	`part` integer NOT NULL,
	`attempt` integer NOT NULL,
	`input_sha256` text NOT NULL,
	`max_cost` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `narration_replacement_parent` ON `narration_replacements` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `narration_replacement_operation` ON `narration_replacements` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `narration_replacement_attempt` ON `narration_replacements` (`root_id`,`attempt`);
--> statement-breakpoint
CREATE TRIGGER narration_replacement_immutable BEFORE UPDATE ON narration_replacements
BEGIN SELECT RAISE(ABORT, 'Narration replacement history cannot be changed'); END;
--> statement-breakpoint
PRAGMA optimize;
