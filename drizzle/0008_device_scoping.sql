-- 0008_device_scoping: per-device ownership for every user-data table.
--
-- The standalone app has no login, so each device gets its own scope:
-- every user-data row carries device_id, and every handler filters by
-- it. Existing rows (from a Muse-era export, if one was ever imported)
-- get device_id '' — they belong to no device and are invisible until
-- re-created under a real device id. Fresh installs get the columns
-- from 0001-0008 as a whole.
--
-- liked_tracks and hidden_playlists need more than ADD COLUMN: their
-- primary keys were a single content key (video_id / playlist_id),
-- which would collide across devices. Both tables are rebuilt with a
-- composite (device_id, <content key>) primary key in SQLite-safe
-- steps (create new table, copy, drop, rename). The other four tables
-- already have surrogate keys (autoincrement id / random text id), so
-- ADD COLUMN is enough for them.

ALTER TABLE `listening_history` ADD COLUMN `device_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile` ADD COLUMN `device_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_playlists` ADD COLUMN `device_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_playlist_tracks` ADD COLUMN `device_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `liked_tracks_new` (
	`device_id` text DEFAULT '' NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`album` text DEFAULT '' NOT NULL,
	`duration` text DEFAULT '' NOT NULL,
	`thumbnail` text DEFAULT '' NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY (`device_id`, `video_id`)
);
--> statement-breakpoint
INSERT INTO `liked_tracks_new` (`device_id`, `video_id`, `title`, `artist`, `album`, `duration`, `thumbnail`, `added_at`)
  SELECT '' AS `device_id`, `video_id`, `title`, `artist`, `album`, `duration`, `thumbnail`, `added_at`
  FROM `liked_tracks`;
--> statement-breakpoint
DROP TABLE `liked_tracks`;
--> statement-breakpoint
ALTER TABLE `liked_tracks_new` RENAME TO `liked_tracks`;
--> statement-breakpoint
CREATE TABLE `hidden_playlists_new` (
	`device_id` text DEFAULT '' NOT NULL,
	`playlist_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`hidden_at` integer NOT NULL,
	PRIMARY KEY (`device_id`, `playlist_id`)
);
--> statement-breakpoint
INSERT INTO `hidden_playlists_new` (`device_id`, `playlist_id`, `title`, `hidden_at`)
  SELECT '' AS `device_id`, `playlist_id`, `title`, `hidden_at`
  FROM `hidden_playlists`;
--> statement-breakpoint
DROP TABLE `hidden_playlists`;
--> statement-breakpoint
ALTER TABLE `hidden_playlists_new` RENAME TO `hidden_playlists`;
