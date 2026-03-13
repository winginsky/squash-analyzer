CREATE TABLE `suggestion_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoId` int NOT NULL,
	`suggestionIdx` int NOT NULL,
	`vote` enum('up','down') NOT NULL,
	`sessionKey` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `suggestion_feedback_id` PRIMARY KEY(`id`)
);
