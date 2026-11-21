CREATE TABLE `user_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source` text DEFAULT 'created' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`thumbnail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_playlist_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`album` text DEFAULT '' NOT NULL,
	`duration` text DEFAULT '' NOT NULL,
	`thumbnail` text DEFAULT '' NOT NULL
);
