DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE liked_tracks (
  video_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  thumbnail TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL
);
