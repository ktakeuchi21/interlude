ALTER TABLE `library_items` ADD `refresh_of` text;--> statement-breakpoint
ALTER TABLE `library_items` ADD `refresh_hash` text;--> statement-breakpoint
CREATE INDEX `library_refresh` ON `library_items` (`refresh_of`,`user_id`);
--> statement-breakpoint
CREATE TRIGGER refresh_request_valid BEFORE INSERT ON library_items
WHEN (NEW.refresh_of IS NULL) <> (NEW.refresh_hash IS NULL)
  OR (NEW.refresh_of IS NOT NULL AND (NEW.kind <> 'topic' OR length(NEW.refresh_hash) <> 64))
BEGIN SELECT RAISE(ABORT, 'An update request needs a complete original lesson reference'); END;
--> statement-breakpoint
CREATE TRIGGER refresh_request_immutable BEFORE UPDATE ON library_items
WHEN OLD.refresh_of IS NOT NEW.refresh_of OR OLD.refresh_hash IS NOT NEW.refresh_hash
  OR (OLD.refresh_of IS NOT NULL AND (OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id
    OR OLD.title IS NOT NEW.title OR OLD.detail IS NOT NEW.detail OR OLD.kind IS NOT NEW.kind OR OLD.created_at IS NOT NEW.created_at))
BEGIN SELECT RAISE(ABORT, 'The original lesson and update request cannot be changed'); END;
--> statement-breakpoint
PRAGMA optimize;
