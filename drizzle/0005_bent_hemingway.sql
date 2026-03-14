ALTER TABLE `users` MODIFY COLUMN `role` enum('user','coach','admin') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `video_analyses` ADD `shareToken` varchar(64);