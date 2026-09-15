CREATE TABLE `plan_deliveries` (
	`user_id` text NOT NULL,
	`week` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `week`)
);
