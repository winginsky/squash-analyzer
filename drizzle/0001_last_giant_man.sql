CREATE TABLE `video_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`title` varchar(255) NOT NULL,
	`videoUrl` varchar(1024) NOT NULL,
	`thumbnailUrl` varchar(1024),
	`status` enum('pending','analyzing','complete','failed') NOT NULL DEFAULT 'pending',
	`analysisResults` json,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_analyses_id` PRIMARY KEY(`id`)
);
