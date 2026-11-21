CREATE TABLE `hidden_playlists` (
	`playlist_id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`hidden_at` integer NOT NULL
);
