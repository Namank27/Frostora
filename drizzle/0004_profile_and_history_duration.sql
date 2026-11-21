ALTER TABLE `listening_history` ADD COLUMN `duration_sec` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'Naman' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_blob_key` text,
	`updated_at` integer NOT NULL
);
