// Drizzle schema for Frostora (standalone port).
//
// Ported verbatim from the Muse space schema, plus one column on every
// user-data table: `device_id`. The app has no login; on a public host
// each device gets its own scope (see SERVER-NOTES.md), so every
// user-data row is owned by exactly one device. Fresh installs get
// these columns from migrations 0001-0008; existing databases pick
// them up from 0008_device_scoping.sql.
//
// liked_tracks: the user's Liked Songs. One row per liked YouTube video.
// The primary key is now composite (device_id, video_id) so the same
// song can be liked on two devices independently, while liking stays
// idempotent per device. Track metadata is stored with the like so a
// liked search result still renders (and plays) later without
// re-searching YouTube.

import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// listening_history: what the user actually plays, likes and searches
// for. Append-only event log used to build homepage recommendations.
// kind is "play" | "like" | "search"; track fields are filled for
// play/like rows, `query` for search rows.
export const listeningHistory = sqliteTable("listening_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull().default(""),
  kind: text("kind").notNull(),
  videoId: text("video_id").notNull().default(""),
  title: text("title").notNull().default(""),
  artist: text("artist").notNull().default(""),
  query: text("query").notNull().default(""),
  // Song length in seconds for play rows (0 when unknown, e.g. rows
  // recorded before this column existed) — powers the profile's
  // honest "time listened" totals.
  durationSec: integer("duration_sec").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// profile: one row per device (queried by device_id, never by the old
// fixed id 1 — two devices must not share or collide on one row).
// Display name and bio are user-editable; the avatar is stored as a
// blob and only its key lives here.
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  deviceId: text("device_id").notNull().default(""),
  displayName: text("display_name").notNull().default("Naman"),
  bio: text("bio").notNull().default(""),
  avatarBlobKey: text("avatar_blob_key"),
  // Wallpaper behind the frosted panels (Album/Playlist/Library
  // pages): either an external image link the user pasted
  // (wallpaper_url) or an image they uploaded from their own
  // device (wallpaper_blob_key, bytes in the blob store). Both null =
  // the default restrained dark background.
  wallpaperUrl: text("wallpaper_url"),
  wallpaperBlobKey: text("wallpaper_blob_key"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// hidden_playlists: playlists from the live YouTube Music feed that
// the user has removed from All Playlists (long-press → confirm).
// The feed itself is live and stateless, so a removal has to be
// remembered here by the card's browse id or the playlist would
// simply reappear on the next load. getHomeFeed filters these ids
// out of its playlists list.
//
// NOTE (port decision, same reasoning as liked_tracks): the original
// primary key was playlist_id alone. Two devices hiding the same
// feed playlist would collide on that key, so the PK is composite
// (device_id, playlist_id) — see migration 0008.
export const hiddenPlaylists = sqliteTable(
  "hidden_playlists",
  {
    deviceId: text("device_id").notNull().default(""),
    playlistId: text("playlist_id").notNull(),
    title: text("title").notNull().default(""),
    hiddenAt: integer("hidden_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.playlistId] })],
);

// user_playlists: the user's OWN playlists — created blank in the
// app ("Create New") or imported from a public YouTube / YouTube
// Music / Spotify playlist link ("Import from Link"). Imported
// tracks are stored already resolved to playable YouTube Music
// tracks (see user_playlist_tracks), so an imported playlist plays
// exactly like any other collection in the app. source is
// "created" | "youtube" | "spotify"; source_url / source_id keep
// the link it came from (empty for created playlists).
export const userPlaylists = sqliteTable("user_playlists", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull().default(""),
  title: text("title").notNull(),
  source: text("source").notNull().default("created"),
  sourceUrl: text("source_url").notNull().default(""),
  sourceId: text("source_id").notNull().default(""),
  thumbnail: text("thumbnail").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// user_playlist_tracks: the resolved tracks of a user playlist, in
// playlist order (position). Same track shape as liked_tracks.
export const userPlaylistTracks = sqliteTable("user_playlist_tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull().default(""),
  playlistId: text("playlist_id").notNull(),
  position: integer("position").notNull().default(0),
  videoId: text("video_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull().default(""),
  album: text("album").notNull().default(""),
  duration: text("duration").notNull().default(""),
  thumbnail: text("thumbnail").notNull().default(""),
});

export const likedTracks = sqliteTable(
  "liked_tracks",
  {
    deviceId: text("device_id").notNull().default(""),
    videoId: text("video_id").notNull(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    album: text("album").notNull().default(""),
    duration: text("duration").notNull().default(""),
    thumbnail: text("thumbnail").notNull().default(""),
    addedAt: integer("added_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.videoId] })],
);
