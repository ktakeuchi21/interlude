ALTER TABLE `lesson_versions` ADD `release_info` text;--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_identity_version` ON `lesson_versions` (`lesson_id`,`version`);
--> statement-breakpoint
-- Published versions are immutable. Corrections are appended as new versions.
CREATE TRIGGER lesson_ready_immutable BEFORE UPDATE ON lesson_versions
WHEN OLD.status = 'ready'
BEGIN
  SELECT RAISE(ABORT, 'Published lesson versions cannot be changed');
END;
