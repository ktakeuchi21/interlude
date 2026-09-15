CREATE TABLE `question_research` (
	`question_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lesson_key` text NOT NULL,
	`question` text NOT NULL,
	`topic_id` text NOT NULL,
	`research_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`source_capture_ids` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `question_research_topic` ON `question_research` (`topic_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_research_run` ON `question_research` (`research_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `question_research_answer` ON `question_research` (`answer_id`);--> statement-breakpoint
CREATE INDEX `question_research_user` ON `question_research` (`user_id`);--> statement-breakpoint
CREATE TRIGGER question_research_immutable BEFORE UPDATE ON question_research
WHEN OLD.question_id IS NOT NEW.question_id OR OLD.user_id IS NOT NEW.user_id
 OR OLD.lesson_key IS NOT NEW.lesson_key OR OLD.question IS NOT NEW.question
 OR OLD.topic_id IS NOT NEW.topic_id OR OLD.research_id IS NOT NEW.research_id
 OR OLD.answer_id IS NOT NEW.answer_id OR OLD.created_at IS NOT NEW.created_at
 OR (OLD.source_capture_ids IS NOT NULL AND OLD.source_capture_ids IS NOT NEW.source_capture_ids)
BEGIN SELECT RAISE(ABORT, 'Question research keeps its original question, requests and selected sources'); END;
--> statement-breakpoint
PRAGMA optimize;
