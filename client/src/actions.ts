// Client-side type mirror of the server's `Actions` map (standalone
// port — TEMPORARY, see below).
//
// In the Muse original, `api`'s types came straight from
// `server/src/actions.ts` via `createActionClient<typeof Actions>()`.
// The ported server (`../../server/src/actions`) does not exist yet —
// the server port is running in parallel — so this file transcribes
// the 29 actions' request/response shapes from the original server's
// zod schemas (response shapes in `server/src/actions.ts`, lines
// 15–24, 1632–1875, 2133–2157 and the inline `response:` objects in
// each `defineAction`). Nothing here is invented: every field, enum
// and nullability matches the server schema it mirrors.
//
// WHEN THE SERVER PORT LANDS, delete this file and restore the typed
// import in `api.ts`:
//
//   import type { Actions } from "../../server/src/actions";
//   export const api = createApiClient<Actions>();
//
// `api.ts`'s `ApiResponse` / `ApiRequest` already match the SDK's
// definitions, so App.tsx needs no change when the import is restored.
// Until then, `api` is typed from this mirror, which is what keeps
// `npm run build` (tsc + vite) green: the loose
// `Record<string, (args: any) => Promise<any>>` fallback made every
// `api.<action>` possibly-undefined under `noUncheckedIndexedAccess`
// and dropped all contextual types in App.tsx (67 type errors).

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  thumbnail: string;
}

/** Request-side track (same fields as Track; the server caps lengths). */
export type TrackInput = Track;

export interface LibraryPlaylist {
  id: string;
  name: string;
  desc: string;
  trackIds: string[];
}

export interface LibraryResponse {
  tracks: Track[];
  playlists: LibraryPlaylist[];
}

export interface SearchResponse {
  results: Track[];
  error: string | null;
}

export interface LikedResponse {
  liked: (Track & { addedAt: string })[];
}

export type LyricsKind = "karaoke" | "synced" | "plain" | "none";

export interface LyricsResponse {
  kind: LyricsKind;
  lines: {
    time: number | null;
    text: string;
    words: { time: number; text: string }[];
  }[];
  error: string | null;
}

export interface OfficialVideoResponse {
  status: "official" | "none";
  videoId: string | null;
  videoTitle: string;
  error: string | null;
  videoDurationSec: number;
  musicStartSec: number;
  musicEndSec: number;
  segments: { start: number; end: number; category: string }[];
  skipSource: "segments" | "duration" | "none";
}

export interface ToggleResponse {
  liked: boolean;
}

export interface OkResponse {
  ok: true;
}

export interface Card {
  id: string;
  title: string;
  subtitle: string;
  kind: "album" | "playlist";
  thumbnail: string;
}

export interface HomeFeedResponse {
  source: "live" | "fallback";
  trending: Track[];
  albums: Card[];
  releases: Card[];
  playlists: Card[];
  recommended: Track[];
  recommendedBasis: string | null;
  similarArtists: { name: string; thumbnail: string }[];
}

export interface CollectionResponse {
  title: string;
  subtitle: string;
  description: string;
  tracks: Track[];
  error: string | null;
}

export interface PopularResponse {
  source: "live" | "fallback";
  songs: (Track & { plays: string })[];
  artists: { name: string; thumbnail: string; plays: string }[];
}

export interface SpeedDialResponse {
  source: "live" | "fallback";
  tracks: Track[];
}

export interface SimilarResponse {
  tracks: Track[];
  basis: string | null;
}

export interface ProfileResponse {
  displayName: string;
  bio: string;
  avatarUrl: string | null;
}

export interface AvatarResponse {
  avatarUrl: string | null;
}

export interface WallpaperResponse {
  kind: "none" | "url" | "upload";
  url: string | null;
}

export interface WallpaperImageResponse {
  wallpaperUrl: string | null;
}

export interface ProfileStatsResponse {
  totalListenedSec: number;
  totalPlays: number;
  distinctSongs: number;
  distinctArtists: number;
  likedCount: number;
  mostArtist: { name: string; plays: number; thumbnail: string } | null;
  topSongs: (Track & { plays: number; minutes: number })[];
  topArtists: { name: string; plays: number; thumbnail: string }[];
}

export interface PlaylistImportPreviewResponse {
  ok: boolean;
  platform: "youtube" | "spotify" | null;
  title: string;
  thumbnail: string;
  trackCount: number;
  error: string | null;
}

export interface UserPlaylistCard {
  id: string;
  title: string;
  subtitle: string;
  kind: "playlist";
  thumbnail: string;
  trackCount: number;
  totalDurationSec: number;
  source: string;
}

export interface ListUserPlaylistsResponse {
  playlists: UserPlaylistCard[];
}

export interface ImportPlaylistResponse {
  ok: boolean;
  playlist: UserPlaylistCard | null;
  skipped: number;
  error: string | null;
}

export interface FeedbackResponse {
  ok: boolean;
}

/**
 * The 29 server actions as a map of action name -> handler function,
 * matching the shape the ported server's `export const Actions` will
 * have. The fetch client in `api.ts` is typed from this map.
 */
export interface Actions {
  getLibrary: (args: Record<string, never>) => Promise<LibraryResponse>;
  searchMusic: (args: { query: string }) => Promise<SearchResponse>;
  listLiked: (args: Record<string, never>) => Promise<LikedResponse>;
  getLyrics: (args: {
    title: string;
    artist: string;
    durationSec?: number;
    forceRefresh?: boolean;
  }) => Promise<LyricsResponse>;
  getOfficialVideo: (args: {
    title: string;
    artist: string;
    durationSec?: number;
  }) => Promise<OfficialVideoResponse>;
  toggleLike: (args: { track: TrackInput }) => Promise<ToggleResponse>;
  recordPlay: (args: { track: TrackInput }) => Promise<OkResponse>;
  hidePlaylist: (args: { id: string; title?: string }) => Promise<OkResponse>;
  previewPlaylistImport: (args: { url: string }) => Promise<PlaylistImportPreviewResponse>;
  importPlaylist: (args: { url: string; name?: string }) => Promise<ImportPlaylistResponse>;
  createPlaylist: (args: { name: string }) => Promise<ImportPlaylistResponse>;
  listUserPlaylists: (args: Record<string, never>) => Promise<ListUserPlaylistsResponse>;
  getUserPlaylist: (args: { playlistId: string }) => Promise<CollectionResponse>;
  deleteUserPlaylist: (args: { id: string }) => Promise<OkResponse>;
  getHomeFeed: (args: Record<string, never>) => Promise<HomeFeedResponse>;
  getPopular: (args: Record<string, never>) => Promise<PopularResponse>;
  getSpeedDial: (args: { nonce?: number }) => Promise<SpeedDialResponse>;
  getSimilarQueue: (args: { track: TrackInput }) => Promise<SimilarResponse>;
  getMoreSimilarSongs: (args: {
    track: TrackInput;
    queue: TrackInput[];
  }) => Promise<SimilarResponse>;
  getProfile: (args: Record<string, never>) => Promise<ProfileResponse>;
  updateProfile: (args: { displayName: string; bio: string }) => Promise<OkResponse>;
  setAvatar: (args: {
    dataBase64: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  }) => Promise<AvatarResponse>;
  getWallpaper: (args: Record<string, never>) => Promise<WallpaperResponse>;
  setWallpaperUrl: (args: { url: string }) => Promise<OkResponse>;
  setWallpaperImage: (args: {
    dataBase64: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
  }) => Promise<WallpaperImageResponse>;
  resetWallpaper: (args: Record<string, never>) => Promise<OkResponse>;
  getProfileStats: (args: { startMs: number }) => Promise<ProfileStatsResponse>;
  getCollection: (args: { browseId: string }) => Promise<CollectionResponse>;
  submitFeedback: (args: { message: string }) => Promise<FeedbackResponse>;
}
