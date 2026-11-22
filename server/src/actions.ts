// Actions for Frostora.
//
// Music model (same as Echo Music): nothing is stored as audio and there
// is NO seeded/default library. Every song the app shows comes live from
// YouTube Music's InnerTube API (search / browse feeds) or from the
// user's own actions (Liked Songs, listening history). Live search runs
// server-side and returns real video IDs, which the client plays in full
// through the YouTube IFrame player. The only persisted user data is
// Liked Songs (liked_tracks table) and the listening history.

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.js";
import type { BlobStore } from "./blobs.js";

/* Standalone port of the Muse space actions (see SERVER-NOTES.md).
   The Muse action wrapper is gone: each entry is a plain registry
   record { description, request, response, handler }, where handler
   is a plain async function handler(args, ctx). The HTTP layer
   (handler.ts) zod-validates args against `request`, calls the
   handler with an ActionContext, and validates the result against
   `response`. */

export interface ActionContext {
  /** Drizzle client over libsql (local file DB or Turso). */
  db: LibSQLDatabase<typeof schema>;
  /** Blob storage (Vercel Blob when configured, local uploads/ otherwise). */
  blobs: BlobStore;
  /** Per-device scope: every user-data row is owned by one device. */
  deviceId: string;
  /** No-op outside Muse; the client invalidates its own queries. */
  invalidateQueries: () => void;
}

const trackSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  duration: z.string(),
  thumbnail: z.string(),
});

type Track = z.infer<typeof trackSchema>;

/* Bounded twin of trackSchema for REQUEST positions only (like /
   record / radio seeds). Response schemas keep the unbounded shape
   so an unusually long title from YouTube can never fail a response
   check, but anything a caller ASKS the server to store or echo is
   capped at generous real-world sizes — a video id is 11 chars,
   titles/artists/albums stay well under 500, durations are "m:ss",
   thumbnail URLs well under 1000 — so a crafted request cannot
   stuff oversized rows into liked_tracks / listening_history. */
const trackInputSchema = z.object({
  videoId: z.string().trim().min(1).max(64),
  title: z.string().trim().max(500),
  artist: z.string().trim().max(500),
  album: z.string().trim().max(500),
  duration: z.string().trim().max(16),
  thumbnail: z.string().trim().max(1000),
});

function thumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/* Uploaded images arrive as base64 + a caller-DECLARED mime type.
   The declaration alone is not proof: verify the decoded bytes
   actually start with the signature of the declared format before
   the bytes are stored and later served back as that content type.
   Anything else (an HTML file, an executable, random bytes wearing
   an image label) is rejected. */
function imageBytesMatchMime(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  }
  return false;
}

/* The 11 songs seeded in the very first version of this app (Blinding
   Lights, Levitating, Shape of You, Perfect, As It Was, Believer, Stay,
   Espresso, Flowers, Tum Hi Ho, Kesariya) and the 4 playlists built from
   them (Top Hits, Bollywood Romance, Pop Party, Chill Evenings) were
   removed as a default library at the user's request. They must never
   be served as a default, a fallback, or a Library entry again. This
   set exists ONLY as an exclusion filter for default surfaces (home
   feed, Speed Dial, Popular chart): if YouTube Music's live feeds
   happen to return one of these video IDs, it is dropped from those
   default lists so the old seeded set never resurfaces on its own.
   An explicit user search for one of these songs still returns it —
   that is the user asking, not a default — and a copy the user
   genuinely liked/played themselves stays in their own history. */
const STARTER_VIDEO_IDS = new Set<string>([
  "4NRXx6U8ABQ",
  "TUVcZfQe-Kw",
  "JGwWNGJdvx8",
  "2Vv-BfVoq4g",
  "H5v3kku4y6Q",
  "7wtfhZwyrcc",
  "kTJczUoc26U",
  "eVli-tstM5E",
  "G7KNmW9a75Y",
  "IJq0yyWug1k",
  "BddP6PYo2gs",
]);

/* The same eleven songs under a DIFFERENT upload (a lyric video, a
   live version, the album cut) carry a different videoId, so the ID
   set alone lets them slip back into default surfaces — exactly
   what the user kept seeing. Default surfaces therefore also match
   on normalised title + primary artist. Both halves must match, so
   an unrelated song that merely shares a title ("Stay", "Perfect",
   "Flowers") is untouched. An explicit user search is never filtered
   by either rule — that is the user asking, not a default. */
const STARTER_TITLE_ARTISTS: ReadonlyArray<readonly [string, string]> = [
  ["blinding lights", "the weeknd"],
  ["levitating", "dua lipa"],
  ["shape of you", "ed sheeran"],
  ["perfect", "ed sheeran"],
  ["as it was", "harry styles"],
  ["believer", "imagine dragons"],
  ["stay", "kid laroi"],
  ["stay", "justin bieber"],
  ["espresso", "sabrina carpenter"],
  ["flowers", "miley cyrus"],
  ["tum hi ho", "arijit singh"],
  ["kesariya", "arijit singh"],
];

function baseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStarterTrack(t: Track): boolean {
  if (STARTER_VIDEO_IDS.has(t.videoId)) return true;
  const bt = baseTitle(t.title);
  if (!bt) return false;
  const artist = t.artist.toLowerCase();
  return STARTER_TITLE_ARTISTS.some(([title, a]) => bt === title && artist.includes(a));
}

function withoutStarters(tracks: Track[]): Track[] {
  return tracks.filter((t) => !isStarterTrack(t));
}

/* ---------------- Upstream fetch: timeout + short TTL cache -------
   Every live call (YouTube Music search / browse, album search,
   LRCLib) goes through fetchUpstream: a hard timeout so a slow or
   hung upstream fails fast instead of leaving the UI spinning for
   as long as the network feels like it. Parsed results are also
   cached in memory for a few minutes (lyrics longer — a song's
   lyrics don't change), so reopening the app serves the home feed,
   popular chart, collection pages and lyrics from the cache
   instantly instead of re-downloading the same megabyte-sized
   feeds on every open. Only successes are cached — a failure is
   dropped immediately so the next call retries live. The cache
   stores promises, so concurrent identical calls share one
   request. This caches public feed data only, never user rows. */

const UPSTREAM_TIMEOUT_MS = 9000;
const FEED_TTL_MS = 5 * 60 * 1000;
const LYRICS_TTL_MS = 30 * 60 * 1000;

function fetchUpstream(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
}

const promiseCache = new Map<string, { at: number; promise: Promise<unknown> }>();

function bustCache(key: string): void {
  promiseCache.delete(key);
}

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = promiseCache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = load();
  promiseCache.set(key, { at: now, promise: promise as Promise<unknown> });
  promise.catch(() => {
    if (promiseCache.get(key)?.promise === (promise as Promise<unknown>)) {
      promiseCache.delete(key);
    }
  });
  if (promiseCache.size > 300) {
    let extra = promiseCache.size - 300;
    for (const k of promiseCache.keys()) {
      if (extra <= 0) break;
      promiseCache.delete(k);
      extra -= 1;
    }
  }
  return promise;
}

/* ---------------- InnerTube live search ---------------- */

const INNERTUBE_KEY = process.env.INNERTUBE_KEY ?? "";
// params filter: songs only (EgWKAQIIAWoKEAoQAxAEEAkQBQ==)
const SONG_FILTER_PARAMS = "EgWKAQIIAWoKEAoQAxAEEAkQBQ%3D%3D";

type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return typeof v === "object" && v !== null ? (v as Json) : null;
}

function runsText(col: unknown): string {
  const c = asObj(col);
  if (!c) return "";
  const inner = asObj(c["musicResponsiveListItemFlexColumnRenderer"]);
  const text = inner ? asObj(inner["text"]) : null;
  const runs = text?.["runs"];
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => {
      const run = asObj(r);
      return typeof run?.["text"] === "string" ? run["text"] : "";
    })
    .join("");
}

function parseSongItem(item: Json): Track | null {
  const pid = asObj(item["playlistItemData"]);
  const videoId = pid && typeof pid["videoId"] === "string" ? pid["videoId"] : "";
  if (!videoId) return null;
  const cols = item["flexColumns"];
  if (!Array.isArray(cols) || cols.length === 0) return null;
  const title = runsText(cols[0]).trim();
  if (!title) return null;
  const second = cols.length >= 2 ? runsText(cols[1]) : "";
  const parts = second.split("•").map((s) => s.trim());
  const artist = parts[0] ?? "";
  const album = parts.length >= 3 ? (parts[1] ?? "") : "";
  const duration = parts.length >= 3 ? (parts[2] ?? "") : (parts[1] ?? "");

  let thumbnailUrl = thumb(videoId);
  const thumbWrap = asObj(item["thumbnail"]);
  const mtr = thumbWrap ? asObj(thumbWrap["musicThumbnailRenderer"]) : null;
  const th = mtr ? asObj(mtr["thumbnail"]) : null;
  const list = th?.["thumbnails"];
  if (Array.isArray(list) && list.length > 0) {
    const last = asObj(list[list.length - 1]);
    if (last && typeof last["url"] === "string") {
      // Ask googleusercontent for a larger render of the same image.
      thumbnailUrl = last["url"].replace(/=w\d+-h\d+/, "=w540-h540");
    }
  }
  return { videoId, title, artist, album, duration, thumbnail: thumbnailUrl };
}

function collectSongs(node: unknown, out: Track[], seen: Set<string>): void {
  if (out.length >= 20) return;
  if (Array.isArray(node)) {
    for (const v of node) collectSongs(v, out, seen);
    return;
  }
  const obj = asObj(node);
  if (!obj) return;
  const item = asObj(obj["musicResponsiveListItemRenderer"]);
  if (item) {
    const t = parseSongItem(item);
    if (t && !seen.has(t.videoId)) {
      seen.add(t.videoId);
      out.push(t);
    }
  }
  for (const v of Object.values(obj)) collectSongs(v, out, seen);
}

async function searchYouTubeMusic(query: string): Promise<Track[]> {
  // Short-TTL cache: the home feed alone fires a dozen+ searches
  // per build; repeat opens reuse the last few minutes' results
  // (the mixes are re-shuffled per call, so nothing looks frozen).
  // A copy is returned because some callers sort/shuffle in place.
  const tracks = await cached(
    `search:${query.trim().toLowerCase()}`,
    FEED_TTL_MS,
    () => searchYouTubeMusicLive(query),
  );
  return [...tracks];
}

async function searchYouTubeMusicLive(query: string): Promise<Track[]> {
  const res = await fetchUpstream(
    `https://music.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20240101.01.00",
            hl: "en",
            gl: "IN",
          },
        },
        query,
        params: decodeURIComponent(SONG_FILTER_PARAMS),
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`YouTube Music search failed (HTTP ${res.status}). Try again.`);
  }
  const data: unknown = await res.json();
  const out: Track[] = [];
  collectSongs(data, out, new Set<string>());
  return out;
}

/* Song search that KEEPS each song's play count. Song search
   results carry the count as its own flex column ("280M plays" —
   verified live 21 Nov 2026 for English and Hindi artists alike),
   which parseSongItem drops. The Trending Artists top-up sums
   these real counts into an artist's plays total. */
function parseSearchSong(item: Json): PopularSong | null {
  const base = parseSongItem(item);
  if (!base) return null;
  let plays = "";
  const cols = item["flexColumns"];
  if (Array.isArray(cols)) {
    for (const col of cols) {
      for (const part of runsText(col).split("•")) {
        const p = part.trim();
        if (/plays$|views$/i.test(p)) plays = p;
      }
    }
  }
  return { ...base, plays };
}

function collectSearchSongs(node: unknown, out: PopularSong[], seen: Set<string>): void {
  if (out.length >= 20) return;
  if (Array.isArray(node)) {
    for (const v of node) collectSearchSongs(v, out, seen);
    return;
  }
  const obj = asObj(node);
  if (!obj) return;
  const item = asObj(obj["musicResponsiveListItemRenderer"]);
  if (item) {
    const t = parseSearchSong(item);
    if (t && !seen.has(t.videoId)) {
      seen.add(t.videoId);
      out.push(t);
    }
  }
  for (const v of Object.values(obj)) collectSearchSongs(v, out, seen);
}

async function searchArtistSongsLive(query: string): Promise<PopularSong[]> {
  const res = await fetchUpstream(
    `https://music.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20240101.01.00",
            hl: "en",
            gl: "IN",
          },
        },
        query,
        params: decodeURIComponent(SONG_FILTER_PARAMS),
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`YouTube Music search failed (HTTP ${res.status}). Try again.`);
  }
  const data: unknown = await res.json();
  const out: PopularSong[] = [];
  collectSearchSongs(data, out, new Set<string>());
  return out;
}

async function searchArtistSongs(query: string): Promise<PopularSong[]> {
  const tracks = await cached(
    `searchplays:${query.trim().toLowerCase()}`,
    FEED_TTL_MS,
    () => searchArtistSongsLive(query),
  );
  return [...tracks];
}

/* ---------------- Official music video lookup ----------------
   The songs the app plays are YouTube Music uploads — very often
   an audio-only "Topic" upload, not the song's music video. When
   the user taps Video, this lookup finds the song's OFFICIAL music
   video on YouTube: it runs the InnerTube search with the Videos
   filter (same WEB_REMIX client as song search, params verified
   live 21 Nov 2026) for "<title> <artist> official music video"
   and for "<title> <artist>", merges the candidates and ranks
   them. Official means: the title is this song, the uploader is
   the artist / their VEVO / a recognised label channel, and the
   title carries none of the markers of a lyric video, cover,
   remix, live recording, karaoke or fan edit. If nothing clears
   the official bar the status is "none" and NO videoId is
   returned — there is deliberately no fallback to a non-official
   / fan / lyric video: a wrong upload runs on a different
   timeline than the song, which throws the player's scrubber
   and synced lyrics off (the Humsafar case: that song has no
   official video, so Video mode must simply not exist for it).
   Verified live:
   "Blinding Lights" → 4NRXx6U8ABQ (The Weeknd channel, "Official
   Video", 1B views); "Kesariya" → BddP6PYo2gs / W1S9AbHpWFY
   (artist byline, 28M views); "Jaune" by Wale The Sage → no
   candidate carries the song's title, so "none". */

// params filter: videos only (EgWKAQIQAWoKEAoQAxAEEAkQBQ==)
const VIDEO_FILTER_PARAMS = "EgWKAQIQAWoKEAoQAxAEEAkQBQ%3D%3D";

interface VideoCandidate {
  videoId: string;
  title: string;
  // Second flex column split on "•": some mix of channel, upload
  // date, view count and duration, in varying order per item.
  bylineParts: string[];
  views: number; // 0 when the item shows no view count
  durationSec: number; // 0 when the item shows no duration
  // YouTube's own classification of the upload, from the item's
  // watch endpoints: MUSIC_VIDEO_TYPE_OMV (a music video),
  // MUSIC_VIDEO_TYPE_UGC (fan upload), MUSIC_VIDEO_TYPE_ATV
  // (audio), others. "" when the item carries none.
  videoType: string;
}

function findVideoType(node: unknown): string {
  if (Array.isArray(node)) {
    for (const v of node) {
      const t = findVideoType(v);
      if (t) return t;
    }
    return "";
  }
  const obj = asObj(node);
  if (!obj) return "";
  const t = obj["musicVideoType"];
  if (typeof t === "string" && t) return t;
  for (const v of Object.values(obj)) {
    const found = findVideoType(v);
    if (found) return found;
  }
  return "";
}

function parseViews(text: string): number {
  const m = /([\d.]+)\s*([KMB])?\s*views/i.exec(text);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const mult = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  return Math.round(n * mult);
}

function parseVideoItem(item: Json): VideoCandidate | null {
  const pid = asObj(item["playlistItemData"]);
  const videoId = pid && typeof pid["videoId"] === "string" ? pid["videoId"] : "";
  if (!videoId) return null;
  const cols = item["flexColumns"];
  if (!Array.isArray(cols) || cols.length === 0) return null;
  const title = runsText(cols[0]).trim();
  if (!title) return null;
  const second = cols.length >= 2 ? runsText(cols[1]) : "";
  const bylineParts = second
    .split("•")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  let views = 0;
  let durationSec = 0;
  for (const part of bylineParts) {
    if (/views/i.test(part)) views = parseViews(part);
    else if (/^\d+:\d{2}(:\d{2})?$/.test(part)) durationSec = parseDurationSec(part);
  }
  return { videoId, title, bylineParts, views, durationSec, videoType: findVideoType(item) };
}

function collectVideos(node: unknown, out: VideoCandidate[], seen: Set<string>): void {
  if (out.length >= 24) return;
  if (Array.isArray(node)) {
    for (const v of node) collectVideos(v, out, seen);
    return;
  }
  const obj = asObj(node);
  if (!obj) return;
  const item = asObj(obj["musicResponsiveListItemRenderer"]);
  if (item) {
    const c = parseVideoItem(item);
    if (c && !seen.has(c.videoId)) {
      seen.add(c.videoId);
      out.push(c);
    }
  }
  for (const v of Object.values(obj)) collectVideos(v, out, seen);
}

async function searchYouTubeVideosLive(query: string): Promise<VideoCandidate[]> {
  const res = await fetchUpstream(
    `https://music.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20240101.01.00",
            hl: "en",
            gl: "IN",
          },
        },
        query,
        params: decodeURIComponent(VIDEO_FILTER_PARAMS),
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`YouTube Music video search failed (HTTP ${res.status}). Try again.`);
  }
  const data: unknown = await res.json();
  const out: VideoCandidate[] = [];
  collectVideos(data, out, new Set<string>());
  return out;
}

async function searchYouTubeVideos(query: string): Promise<VideoCandidate[]> {
  const found = await cached(
    `videosearch:${query.trim().toLowerCase()}`,
    FEED_TTL_MS,
    () => searchYouTubeVideosLive(query),
  );
  return [...found];
}

/* Markers of everything that is NOT the official music video.
   A word is only disqualifying when the song's own title does not
   contain it (a song actually called "Remix" keeps its videos). */
const NOT_OFFICIAL_MARKERS = [
  "lyric", "karaoke", "cover", "remix", "sped up", "slowed", "reverb",
  "nightcore", "8d audio", "reaction", "teaser", "trailer",
  "behind the scenes", "making of", "dance practice", "dance cover",
  "instrumental", "lofi", "lo-fi", "whatsapp status", "ringtone",
  "terjemahan", "lirik", "mmv", "amv", "fan made", "fanmade",
  "tribute", "mashup", "audio", "live at", "live performance",
  "live concert", "live session", "(live", "live |",
];

/* Label / distributor channels whose upload of a song's video is
   the official one even though the channel is not the artist —
   the norm for film music (T-Series, Sony Music, Zee Music…). */
const LABEL_CHANNEL_HINTS = [
  "t-series", "tseries", "sony music", "zee music", "universal music",
  "warner music", "tips official", "saregama", "yrf", "eros",
  "times music", "speed records", "atlantic records", "interscope",
  "rca records", "columbia records", "capitol records",
  "republic records", "def jam", "parlophone", "island records",
];

function normWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface ScoredVideo {
  candidate: VideoCandidate;
  score: number;
  official: boolean;
  // The artist is actually connected to this upload — named in
  // the title or byline, or it is their / their label's channel.
  artistMention: boolean;
}

function scoreVideoCandidate(
  c: VideoCandidate,
  coreTitle: string,
  artistNorm: string,
  trackDurationSec: number,
  rankBonus: number,
): ScoredVideo | null {
  const rawTitle = c.title.toLowerCase();
  const titleNorm = normWords(c.title);
  // Must actually be this song.
  if (!coreTitle || !titleNorm.includes(coreTitle)) return null;
  for (const marker of NOT_OFFICIAL_MARKERS) {
    if (rawTitle.includes(marker) && !coreTitle.includes(marker)) return null;
  }
  let score = 30 + rankBonus;
  // Uploader signal: a byline part that IS the artist's channel
  // (exact name, or the name + VEVO), a VEVO channel, or a
  // recognised label channel. A part that merely CONTAINS the
  // artist's name inside a longer credits string ("Amitabh
  // Bhattacharya, Arijit Singh & Pritam" — the byline of a fan
  // re-upload) is worth only a small credit bonus: live results
  // showed exactly that string outranking the real official
  // upload when containment counted as the artist's channel.
  let channelSignal = false;
  const artistSquash = artistNorm.replace(/ /g, "");
  for (const part of c.bylineParts) {
    const p = normWords(part);
    if (!p) continue;
    const pSquash = p.replace(/ /g, "");
    if (
      artistSquash.length >= 3 &&
      (pSquash === artistSquash || pSquash === `${artistSquash}vevo`)
    ) {
      channelSignal = true;
      score += 35;
    } else if (p.includes("vevo")) {
      channelSignal = true;
      score += 30;
    } else if (LABEL_CHANNEL_HINTS.some((h) => p.includes(normWords(h)))) {
      channelSignal = true;
      score += 20;
    } else if (artistNorm.length >= 3 && p.includes(artistNorm)) {
      score += 8;
    }
  }
  // Title signal: the upload calls itself the official / full video.
  let titleSignal = false;
  if (rawTitle.includes("official music video")) {
    titleSignal = true;
    score += 35;
  } else if (rawTitle.includes("official video")) {
    titleSignal = true;
    score += 30;
  } else if (rawTitle.includes("official")) {
    titleSignal = true;
    score += 15;
  }
  if (rawTitle.includes("full video")) {
    titleSignal = true;
    score += 20;
  } else if (rawTitle.includes("music video")) {
    score += 10;
  }
  // Popularity: the official upload is usually the most-watched
  // one by orders of magnitude (28M vs a fan re-upload's 281K in
  // the Kesariya results). Log-scaled so it breaks ties without
  // ever outvoting the channel/title signals on its own.
  if (c.views > 0) {
    score += Math.min(20, Math.max(0, (Math.log10(c.views) - 4) * 4));
  }
  // YouTube's own classification: a music-video type supports
  // the pick; a UGC tag marks a fan upload and counts against.
  if (c.videoType === "MUSIC_VIDEO_TYPE_OMV" || c.videoType === "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC") {
    score += 12;
  } else if (c.videoType === "MUSIC_VIDEO_TYPE_UGC") {
    score -= 15;
  }
  // Duration sanity: a music video runs roughly the song's length.
  if (trackDurationSec > 0 && c.durationSec > 0) {
    const ratio = c.durationSec / trackDurationSec;
    if (ratio >= 0.6 && ratio <= 1.6) score += 8;
    else if (ratio < 0.35 || ratio > 2.5) score -= 25;
  }
  // Official = the right uploader (artist / VEVO / label), a
  // strong total score, and not a fan-upload classification. The
  // "official" wording in the title is NOT required: film-song
  // uploads on label channels (the Kesariya case) rarely carry
  // it, and the uploader + score already identify them — the
  // wording only lowers the bar slightly when everything else
  // already points the same way.
  const artistMention =
    channelSignal ||
    (artistNorm.length >= 3 &&
      (titleNorm.includes(artistNorm) ||
        c.bylineParts.some((part) => normWords(part).includes(artistNorm))));
  return {
    candidate: c,
    score,
    artistMention,
    official:
      channelSignal &&
      c.videoType !== "MUSIC_VIDEO_TYPE_UGC" &&
      (score >= 70 || (titleSignal && score >= 65)),
  };
}

async function findOfficialVideo(
  title: string,
  artist: string,
  durationSec: number | null,
): Promise<{
  status: "official" | "none";
  videoId: string | null;
  videoTitle: string;
  videoDurationSec: number;
}> {
  const clean = cleanTrackTitle(title);
  const artist1 = primaryArtist(artist);
  const coreTitle = baseTitle(clean);
  if (!coreTitle) return { status: "none", videoId: null, videoTitle: "", videoDurationSec: 0 };
  const artistNorm = normWords(artist1);
  const queries = [`${clean} ${artist1} official music video`, `${clean} ${artist1}`];
  const lists = await Promise.all(
    queries.map((q) => searchYouTubeVideos(q).catch(() => [] as VideoCandidate[])),
  );
  // Merge both result lists, keeping the best rank bonus per video.
  const merged = new Map<string, { candidate: VideoCandidate; rankBonus: number }>();
  for (const list of lists) {
    list.forEach((candidate, i) => {
      const rankBonus = i < 10 ? (10 - i) * 0.5 : 0;
      const prev = merged.get(candidate.videoId);
      if (!prev || rankBonus > prev.rankBonus) {
        merged.set(candidate.videoId, { candidate, rankBonus });
      }
    });
  }
  let best: ScoredVideo | null = null;
  for (const { candidate, rankBonus } of merged.values()) {
    const scored = scoreVideoCandidate(candidate, coreTitle, artistNorm, durationSec ?? 0, rankBonus);
    if (scored && (!best || scored.score > best.score)) best = scored;
  }
  if (!best) return { status: "none", videoId: null, videoTitle: "", videoDurationSec: 0 };
  if (best.official) {
    return {
      status: "official",
      videoId: best.candidate.videoId,
      videoTitle: best.candidate.title,
      videoDurationSec: best.candidate.durationSec,
    };
  }
  // NOT official → no video at all. Returning a best-guess
  // non-official upload here used to put Video mode on a fan /
  // lyric video whose timeline differs from the song's, which
  // desynced the scrubber and the lyrics. The client hides the
  // Video option entirely for status "none".
  return { status: "none", videoId: null, videoTitle: "", videoDurationSec: 0 };
}

/* ---------------- Non-music segments (SponsorBlock) ----------------
   Music videos often wrap the song in non-music parts — a spoken
   / dialogue intro, a silent lead-in, a mid-video skit, credits
   over the end. SponsorBlock's public API carries crowd-submitted
   segments for exactly this: its "music_offtopic" category IS
   "non-music section in a music video", and its "intro" / "outro"
   categories cover the rest. Verified live 21 Nov 2026:
   GET https://sponsor.ajay.app/api/skipSegments?videoID=4NRXx6U8ABQ
   &categories=["music_offtopic","intro","outro"] → 200 with
   music_offtopic [0, 23.09] and [241.65, 262.52] for the Blinding
   Lights video (263s) — the dialogue intro and the credits outro.
   A video with no submissions returns 404, which simply means
   "no segments known" — the duration comparison below then
   applies. No key is required and nothing is stored. */

interface SkipSegment {
  start: number;
  end: number;
  category: string;
}

async function fetchSkipSegments(videoId: string): Promise<SkipSegment[]> {
  try {
    const cats = encodeURIComponent(JSON.stringify(["music_offtopic", "intro", "outro"]));
    const res = await fetchUpstream(
      `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${cats}`,
    );
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    const out: SkipSegment[] = [];
    for (const item of data) {
      const o = asObj(item);
      if (!o) continue;
      const seg = o["segment"];
      const cat = o["category"];
      if (
        Array.isArray(seg) &&
        typeof seg[0] === "number" &&
        typeof seg[1] === "number" &&
        typeof cat === "string" &&
        seg[1] > seg[0]
      ) {
        out.push({ start: seg[0], end: seg[1], category: cat });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

/* The search byline does not always carry the winning video's
   duration (the Tum Hi Ho official upload shows none). The
   InnerTube player endpoint on the same host returns the real
   lengthSeconds in videoDetails even for UNPLAYABLE music
   responses — verified live 21 Nov 2026 (Blinding Lights →
   lengthSeconds 263). Used only to fill a missing duration. */
async function fetchVideoDurationSec(videoId: string): Promise<number> {
  try {
    const res = await fetchUpstream(
      `https://music.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
        body: JSON.stringify({
          context: {
            client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00", hl: "en", gl: "IN" },
          },
          videoId,
        }),
      },
    );
    if (!res.ok) return 0;
    const data: unknown = await res.json();
    const vd = asObj(asObj(data)?.["videoDetails"]);
    const len = vd?.["lengthSeconds"];
    const n = typeof len === "string" ? Number(len) : typeof len === "number" ? len : 0;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

interface OfficialVideoResult {
  status: "official" | "none";
  videoId: string | null;
  videoTitle: string;
  videoDurationSec: number;
  // The music window inside the video: playback in Video mode
  // starts at musicStartSec and the song is over at musicEndSec.
  // Derived first from the video's own non-music segments
  // (skipSource "segments"); when no segments are known, from
  // comparing the video's duration with the audio track's known
  // duration (skipSource "duration"); "none" = play the video
  // as-is. The window is only ever set when it leaves a plausible
  // song-length window, so actual music is never cut.
  musicStartSec: number;
  musicEndSec: number;
  segments: SkipSegment[];
  skipSource: "segments" | "duration" | "none";
}

async function resolveOfficialVideo(
  title: string,
  artist: string,
  durationSec: number | null,
): Promise<OfficialVideoResult> {
  const base = await findOfficialVideo(title, artist, durationSec);
  const empty: OfficialVideoResult = {
    ...base,
    musicStartSec: 0,
    musicEndSec: 0,
    segments: [],
    skipSource: "none",
  };
  // Only a verified official video gets segments / a music
  // window — anything else returns the bare "none" result so no
  // client path can ever play a non-official upload as the video.
  if (base.status !== "official" || !base.videoId) return empty;
  const videoDur =
    base.videoDurationSec > 0 ? base.videoDurationSec : await fetchVideoDurationSec(base.videoId);
  if (videoDur <= 0) return empty;
  base.videoDurationSec = videoDur;
  const audioDur = durationSec && durationSec > 0 ? durationSec : 0;
  const segments = await fetchSkipSegments(base.videoId);

  let musicStart = 0;
  let musicEnd = videoDur;
  let source: OfficialVideoResult["skipSource"] = "none";

  // Segments that touch the very start / end of the video define
  // the music window directly (walking outward so back-to-back
  // segments chain: intro + a music_offtopic right after it).
  let cur = 0;
  for (const s of segments) {
    if (s.start <= cur + 1.5 && s.end > cur) cur = s.end;
  }
  if (cur > 0) {
    musicStart = cur;
    source = "segments";
  }
  let tail = videoDur;
  for (const s of [...segments].reverse()) {
    if (s.end >= tail - 1.5 && s.start < tail) tail = s.start;
  }
  if (tail < videoDur) {
    musicEnd = tail;
    source = "segments";
  }

  // Duration comparison for whichever edge the segments did not
  // pin down: the song itself runs audioDur seconds, so a known
  // end implies the start (and vice versa); with neither edge
  // known, the whole excess over the audio length is attributed
  // to a non-music intro at the start — the brief's prescribed
  // detection — with a 1s safety margin so playback begins a
  // beat BEFORE the estimated music start, never inside the
  // music. Only applied to a plausible excess (8s…120s).
  if (audioDur > 0) {
    if (musicStart === 0 && musicEnd < videoDur) {
      const implied = musicEnd - audioDur;
      if (implied >= 4) {
        musicStart = Math.max(0, implied - 1);
        source = "segments";
      }
    } else if (musicEnd === videoDur && musicStart > 0) {
      const impliedEnd = musicStart + audioDur;
      if (videoDur - impliedEnd >= 4) {
        musicEnd = Math.min(videoDur, impliedEnd + 1);
        source = "segments";
      }
    } else if (musicStart === 0 && musicEnd === videoDur) {
      const excess = videoDur - audioDur;
      if (excess >= 8 && excess <= 120) {
        musicStart = Math.max(0, excess - 1);
        source = "duration";
      }
    }
  }

  // Sanity: if what remains is not a plausible song window, the
  // data disagrees with itself — play the video untouched rather
  // than risk cutting music.
  if (musicEnd - musicStart < 30) {
    musicStart = 0;
    musicEnd = videoDur;
    source = "none";
  }
  return { ...base, musicStartSec: musicStart, musicEndSec: musicEnd, segments, skipSource: source };
}

/* ---------------- Lyrics (LRCLib) ----------------
   Echo-style model again: lyrics are fetched live, never stored or
   invented. LRCLib returns LRC `syncedLyrics` ([mm:ss.xx] lines) and
   `plainLyrics` as a fallback. Strategy: exact /api/get first, then a
   cleaned-up /api/get, then /api/search ranked by synced-availability
   and duration closeness. If nothing matches, kind "none" — the client
   shows an honest empty state. */

interface LrcLibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  hasWordSync?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  lyricsfile?: string | null;
}

function cleanTrackTitle(t: string): string {
  return t
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, "")
    .replace(/\s+-\s+(official|lyric|audio|video).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function primaryArtist(a: string): string {
  return a
    .split(",")[0]
    ?.replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, "")
    .trim() ?? a;
}

async function lrclibGet(track: string, artist: string): Promise<LrcLibRecord | null> {
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`;
  const res = await fetchUpstream(url, {
    headers: { "User-Agent": "Frostora/1.0 (personal music player)" },
  });
  if (!res.ok) return null;
  return (await res.json()) as LrcLibRecord;
}

async function lrclibSearch(track: string, artist: string): Promise<LrcLibRecord[]> {
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
  const res = await fetchUpstream(url, {
    headers: { "User-Agent": "Frostora/1.0 (personal music player)" },
  });
  if (!res.ok) return [];
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as LrcLibRecord[]) : [];
}

function parseSynced(lrc: string): { time: number; text: string }[] {
  const lines: { time: number; text: string }[] = [];
  for (const raw of lrc.split("\n")) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(raw.trim());
    if (!m) continue;
    const time = Number(m[1]) * 60 + Number(m[2]);
    const text = (m[3] ?? "").trim();
    if (!text) continue; // instrumental gap markers carry no words
    lines.push({ time, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

interface LyricWord {
  time: number;
  text: string;
}
interface LyricLineOut {
  time: number | null;
  text: string;
  words: LyricWord[];
}

type LyricsResult =
  | { kind: "karaoke"; lines: LyricLineOut[] }
  | { kind: "synced"; lines: LyricLineOut[] }
  | { kind: "plain"; lines: LyricLineOut[] }
  | { kind: "none"; lines: LyricLineOut[] };

function recordToLyrics(rec: LrcLibRecord | null): LyricsResult | null {
  if (!rec || rec.instrumental) return null;
  if (rec.syncedLyrics) {
    const lines = parseSynced(rec.syncedLyrics);
    if (lines.length > 0)
      return { kind: "synced", lines: lines.map((l) => ({ ...l, words: [] })) };
  }
  if (rec.plainLyrics) {
    const lines = rec.plainLyrics
      .split("\n")
      .map((text) => ({ time: null, text: text.trim(), words: [] as LyricWord[] }));
    if (lines.some((l) => l.text)) return { kind: "plain", lines };
  }
  return null;
}

/* Karaoke word timings: LRCLib flags word-synced records with
   hasWordSync, but /api/get only returns line-level LRC. The by-id
   endpoint (/api/get/{id}) additionally returns a structured
   `lyricsfile` whose lines carry per-word start_ms values — those
   are the real sung timings, parsed here. No timings are ever
   estimated: if the file is missing or malformed, the caller falls
   back to line-level sync. */

function unquoteYamlText(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

function parseLyricsFile(content: string): LyricLineOut[] | null {
  const out: LyricLineOut[] = [];
  let inLines = false;
  let cur: LyricLineOut | null = null;
  let curWord: LyricWord | null = null;
  let inWords = false;
  for (const rawLine of content.split("\n")) {
    if (/^lines:\s*$/.test(rawLine)) {
      inLines = true;
      continue;
    }
    if (!inLines) continue;
    const lineItem = /^- text:\s?(.*)$/.exec(rawLine);
    if (lineItem) {
      cur = { time: null, text: unquoteYamlText(lineItem[1] ?? ""), words: [] };
      out.push(cur);
      curWord = null;
      inWords = false;
      continue;
    }
    if (!cur) continue;
    const wordItem = /^\s+- text:\s?(.*)$/.exec(rawLine);
    if (wordItem) {
      curWord = { time: 0, text: unquoteYamlText(wordItem[1] ?? "") };
      cur.words.push(curWord);
      continue;
    }
    if (/^\s+words:\s*$/.test(rawLine)) {
      inWords = true;
      continue;
    }
    const startMs = /^\s+start_ms:\s*(\d+)\s*$/.exec(rawLine);
    if (startMs) {
      const sec = Number(startMs[1]) / 1000;
      if (inWords && curWord) curWord.time = sec;
      else if (cur.time === null) cur.time = sec;
    }
  }
  const usable = out.filter((l) => l.text.trim() && l.words.length > 0 && l.time !== null);
  return usable.length > 0 ? usable : null;
}

async function lrclibGetById(id: number): Promise<LrcLibRecord | null> {
  const res = await fetchUpstream(`https://lrclib.net/api/get/${id}`, {
    headers: { "User-Agent": "Frostora/1.0 (personal music player)" },
  });
  if (!res.ok) return null;
  return (await res.json()) as LrcLibRecord;
}

async function recordToLyricsAsync(rec: LrcLibRecord | null): Promise<LyricsResult | null> {
  if (!rec || rec.instrumental) return null;
  if (rec.hasWordSync && typeof rec.id === "number") {
    try {
      const full = await lrclibGetById(rec.id);
      if (full?.lyricsfile) {
        const lines = parseLyricsFile(full.lyricsfile);
        if (lines) return { kind: "karaoke", lines };
      }
    } catch {
      /* fall through to line-level sync */
    }
  }
  return recordToLyrics(rec);
}

async function fetchLyrics(
  title: string,
  artist: string,
  durationSec: number | null,
): Promise<LyricsResult> {
  const cleaned = cleanTrackTitle(title);
  const primary = primaryArtist(artist);
  const attempts: [string, string][] = [
    [title, artist],
    [cleaned, primary],
    [cleaned, artist],
  ];
  const seen = new Set<string>();
  let firstLineSynced: LyricsResult | null = null;
  for (const [t, a] of attempts) {
    const key = `${t}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const got = await recordToLyricsAsync(await lrclibGet(t, a));
    if (!got) continue;
    if (got.kind === "karaoke") return got;
    // Keep looking for a word-synced record, but remember the first
    // usable line-level result in case none exists.
    if (!firstLineSynced) firstLineSynced = got;
  }
  if (firstLineSynced && firstLineSynced.kind !== "plain") return firstLineSynced;
  const results = await lrclibSearch(cleaned, primary);
  const usable: { rec: LrcLibRecord; lyrics: LyricsResult }[] = [];
  for (const r of results) {
    const lyrics = recordToLyrics(r);
    if (lyrics) usable.push({ rec: r, lyrics });
  }
  usable.sort((x, y) => {
    const syncScore = (l: LyricsResult) => (l.kind === "synced" ? 0 : 1);
    const ds = syncScore(x.lyrics) - syncScore(y.lyrics);
    if (ds !== 0) return ds;
    if (durationSec !== null) {
      const dx = Math.abs((x.rec.duration ?? 0) - durationSec);
      const dy = Math.abs((y.rec.duration ?? 0) - durationSec);
      return dx - dy;
    }
    return 0;
  });
  const best = usable[0];
  if (best) {
    // One more chance at karaoke: the best search hit may be a
    // word-synced record even when the exact /get matches were not.
    if (best.rec.hasWordSync && typeof best.rec.id === "number") {
      const upgraded = await recordToLyricsAsync(best.rec);
      if (upgraded?.kind === "karaoke") return upgraded;
    }
    return best.lyrics;
  }
  return firstLineSynced ?? { kind: "none", lines: [] };
}

/* ---------------- Live home feed (InnerTube browse) ----------------
   The homepage is not the fixed starter library: on every load the
   server browses YouTube Music's own home / explore / charts feeds,
   pulls trending songs, new-release albums and playlist cards out of
   them, shuffles everything, and layers recommendations built from
   the user's own listening_history + Liked Songs on top. */

interface Card {
  id: string;
  title: string;
  subtitle: string;
  kind: "album" | "playlist";
  thumbnail: string;
}

const INNERTUBE_CTX = {
  client: { clientName: "WEB_REMIX", clientVersion: "1.20240101.01.00", hl: "en", gl: "IN" },
};

async function innertubeBrowse(browseId: string): Promise<unknown> {
  // Browse payloads run 200 KB–1.1 MB and power the home feed, the
  // popular chart and every collection page — cache them briefly
  // so reopening the app (or a playlist) doesn't re-download them.
  return cached(`browse:${browseId}`, FEED_TTL_MS, () => innertubeBrowseLive(browseId));
}

async function innertubeBrowseLive(browseId: string): Promise<unknown> {
  const res = await fetchUpstream(
    `https://music.youtube.com/youtubei/v1/browse?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: JSON.stringify({ context: INNERTUBE_CTX, browseId }),
    },
  );
  if (!res.ok) throw new Error(`YouTube Music browse failed (HTTP ${res.status})`);
  return res.json();
}

function headerText(col: unknown): string {
  const c = asObj(col);
  if (!c) return "";
  const runs = c["runs"];
  if (!Array.isArray(runs)) return "";
  return runs
    .map((r) => {
      const run = asObj(r);
      return typeof run?.["text"] === "string" ? run["text"] : "";
    })
    .join("");
}

function bestThumbnail(item: Json): string {
  const tr = asObj(item["thumbnailRenderer"]) ?? asObj(item["thumbnail"]);
  const mtr = tr ? asObj(tr["musicThumbnailRenderer"]) : null;
  const th = mtr ? asObj(mtr["thumbnail"]) : null;
  const list = th?.["thumbnails"];
  if (Array.isArray(list) && list.length > 0) {
    const last = asObj(list[list.length - 1]);
    if (last && typeof last["url"] === "string") {
      return last["url"].replace(/=w\d+-h\d+/, "=w540-h540");
    }
  }
  return "";
}

// Song parser for browse contexts (home / explore / playlist pages),
// where the second flex column mixes artist, album, play counts and
// durations, and the length may live in a fixed column instead.
function parseBrowseSong(item: Json): Track | null {
  const pid = asObj(item["playlistItemData"]);
  const videoId = pid && typeof pid["videoId"] === "string" ? pid["videoId"] : "";
  if (!videoId) return null;
  const cols = item["flexColumns"];
  if (!Array.isArray(cols) || cols.length === 0) return null;
  const title = runsText(cols[0]).trim();
  if (!title) return null;
  const second = cols.length >= 2 ? runsText(cols[1]) : "";
  const parts = second
    .split("•")
    .map((s) => s.trim())
    .filter((s) => s && !/plays$|views$/i.test(s));
  const artist = parts[0] ?? "";
  let album = "";
  let duration = "";
  for (const p of parts.slice(1)) {
    if (/^\d+:\d{2}$/.test(p)) duration = p;
    else if (!album) album = p;
  }
  if (!duration) {
    const fixed = item["fixedColumns"];
    if (Array.isArray(fixed) && fixed.length > 0) {
      const fc = asObj(fixed[0]);
      const inner = fc ? asObj(fc["musicResponsiveListItemFixedColumnRenderer"]) : null;
      const text = inner ? asObj(inner["text"]) : null;
      const runs = text?.["runs"];
      if (Array.isArray(runs)) {
        const d = runs
          .map((r) => {
            const run = asObj(r);
            return typeof run?.["text"] === "string" ? run["text"] : "";
          })
          .join("")
          .trim();
        if (/^\d+:\d{2}$/.test(d)) duration = d;
      }
    }
  }
  const thumbnailUrl = bestThumbnail(item) || thumb(videoId);
  return { videoId, title, artist, album, duration, thumbnail: thumbnailUrl };
}

function parseTwoRowCard(item: Json): Card | null {
  const title = headerText(item["title"]).trim();
  if (!title) return null;
  const nav = asObj(item["navigationEndpoint"]);
  const be = nav ? asObj(nav["browseEndpoint"]) : null;
  const browseId = be && typeof be["browseId"] === "string" ? be["browseId"] : "";
  if (!browseId) return null;
  const cfg = be ? asObj(be["browseEndpointContextSupportedConfigs"]) : null;
  const musicCfg = cfg ? asObj(cfg["browseEndpointContextMusicConfig"]) : null;
  const pageType = typeof musicCfg?.["pageType"] === "string" ? musicCfg["pageType"] : "";
  const kind: Card["kind"] | null =
    pageType === "MUSIC_PAGE_TYPE_ALBUM"
      ? "album"
      : pageType === "MUSIC_PAGE_TYPE_PLAYLIST"
        ? "playlist"
        : null;
  if (!kind) return null;
  return {
    id: browseId,
    title,
    subtitle: headerText(item["subtitle"]).trim(),
    kind,
    thumbnail: bestThumbnail(item),
  };
}

interface FeedSections {
  songs: { section: string; track: Track }[];
  cards: { section: string; card: Card }[];
}

function collectFeed(node: unknown, section: string, out: FeedSections): void {
  if (Array.isArray(node)) {
    for (const v of node) collectFeed(v, section, out);
    return;
  }
  const obj = asObj(node);
  if (!obj) return;
  let current = section;
  const carouselHeader = asObj(obj["musicCarouselShelfBasicHeaderRenderer"]);
  const shelfHeader = asObj(obj["musicShelfBasicHeaderRenderer"]);
  const header = carouselHeader ?? shelfHeader;
  if (header) {
    const t = headerText(header["title"]).trim();
    if (t) current = t;
  }
  const twoRow = asObj(obj["musicTwoRowItemRenderer"]);
  if (twoRow) {
    const card = parseTwoRowCard(twoRow);
    if (card) out.cards.push({ section: current, card });
  }
  const listItem = asObj(obj["musicResponsiveListItemRenderer"]);
  if (listItem) {
    const track = parseBrowseSong(listItem);
    if (track) out.songs.push({ section: current, track });
  }
  for (const v of Object.values(obj)) collectFeed(v, current, out);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j] as T;
    a[j] = tmp as T;
  }
  return a;
}

function parseDurationSec(duration: string): number {
  const m = /^(\d+):(\d{2})$/.exec(duration.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of tracks) {
    if (seen.has(t.videoId)) continue;
    seen.add(t.videoId);
    out.push(t);
  }
  return out;
}

function dedupeCards(cards: Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/* ---------------- New releases: famous EN/HI + the user's taste ----
   The raw explore feed's "new albums" shelf is mostly obscure
   international acts (regional Mexican, micro-label country, …) —
   verified live 20 Nov 2026: 24 album cards, none by a famous
   English/Hindi artist. The New releases section therefore only
   keeps an album when (a) its artist is a famous English-language
   or Hindi/Bollywood artist (curated set below), (b) its artist is
   one the user actually listens to, or a similar artist derived
   from their history, or (c) its artist is charting in the same
   live feeds right now. Because the raw shelf rarely passes, the
   section is then topped up with live album searches (InnerTube
   album filter) for the user's own top artists, similar artists
   and a rotating pick of famous EN/HI artists — real YouTube Music
   albums, newest first by the year in their subtitle. */

const normName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const FAMOUS_ENGLISH_ARTISTS: readonly string[] = [
  "Ed Sheeran", "Taylor Swift", "Ariana Grande", "Dua Lipa", "The Weeknd",
  "Billie Eilish", "Bruno Mars", "Justin Bieber", "Harry Styles",
  "Olivia Rodrigo", "Sabrina Carpenter", "Miley Cyrus", "Lady Gaga",
  "Beyonce", "Rihanna", "Drake", "Eminem", "Post Malone", "SZA",
  "Kendrick Lamar", "Adele", "Shawn Mendes", "Camila Cabello",
  "Selena Gomez", "Katy Perry", "Coldplay", "Imagine Dragons",
  "Maroon 5", "OneRepublic", "Charlie Puth", "Sam Smith", "Lana Del Rey",
  "Halsey", "Doja Cat", "The Chainsmokers", "Alan Walker", "Marshmello",
  "Calvin Harris", "David Guetta", "Zayn", "Liam Payne", "Niall Horan",
  "Louis Tomlinson", "One Direction", "Backstreet Boys", "Westlife",
  "Michael Jackson", "Whitney Houston", "Madonna", "Britney Spears",
  "Jennifer Lopez", "Shakira", "Enrique Iglesias", "Pitbull",
  "Linkin Park", "Green Day", "Twenty One Pilots", "Arctic Monkeys",
  "The 1975", "Lorde", "Troye Sivan", "Conan Gray", "Gracie Abrams",
  "Chappell Roan", "Benson Boone", "Teddy Swims", "Shaboozey",
  "Morgan Wallen", "Luke Combs", "Chris Stapleton", "Kacey Musgraves",
  "Travis Scott", "21 Savage", "Future", "J Cole", "Nicki Minaj",
  "Cardi B", "Megan Thee Stallion", "Tyler The Creator", "Frank Ocean",
  "Childish Gambino", "Anderson Paak", "Silk Sonic", "Hozier",
  "Noah Kahan", "Zach Bryan", "Lewis Capaldi", "James Arthur",
  "Ellie Goulding", "Demi Lovato", "Ava Max", "Bebe Rexha",
  "Anne Marie", "Clean Bandit", "Kygo", "Avicii", "Martin Garrix",
  "Ed Sheeran", "Glass Animals", "Tame Impala", "The Neighbourhood",
  "Cigarettes After Sex", "Boygenius", "Phoebe Bridgers",
];

const FAMOUS_HINDI_ARTISTS: readonly string[] = [
  "Arijit Singh", "Shreya Ghoshal", "Sonu Nigam", "Alka Yagnik",
  "Udit Narayan", "Kumar Sanu", "Pritam", "A R Rahman", "AR Rahman",
  "Vishal Shekhar", "Vishal Dadlani", "Shekhar Ravjiani",
  "Amit Trivedi", "Shankar Ehsaan Loy", "Shankar Mahadevan",
  "Salim Sulaiman", "Sachin Jigar", "Mithoon", "Ankit Tiwari",
  "Jeet Gannguli", "Himesh Reshammiya", "Atif Aslam", "Rahat Fateh Ali Khan",
  "Neha Kakkar", "Jubin Nautiyal", "Darshan Raval", "Armaan Malik",
  "Amaal Mallik", "Badshah", "Yo Yo Honey Singh", "Honey Singh",
  "Diljit Dosanjh", "AP Dhillon", "Shubh", "Karan Aujla", "Sidhu Moose Wala",
  "Guru Randhawa", "Harrdy Sandhu", "B Praak", "Jaani", "Asees Kaur",
  "Dhvani Bhanushali", "Jonita Gandhi", "Harshdeep Kaur", "Mohit Chauhan",
  "KK", "Shaan", "Sunidhi Chauhan", "Shilpa Rao", "Vishal Mishra",
  "Sachet Tandon", "Parampara Tandon", "Sachet Parampara", "Stebin Ben",
  "Palak Muchhal", "Tulsi Kumar", "Mika Singh", "Sukhwinder Singh",
  "Daler Mehndi", "Lata Mangeshkar", "Asha Bhosle", "Kishore Kumar",
  "Mohammed Rafi", "Jagjit Singh", "Pankaj Udhas", "Anuradha Paudwal",
  "Kavita Krishnamurthy", "Sadhana Sargam", "Anirudh Ravichander",
  "Devi Sri Prasad", "Tanishk Bagchi", "Rochak Kohli", "Manan Bhardwaj",
  "Raj Barman", "Yasser Desai", "Altamash Faridi", "Mohammed Irfan",
  "Papon", "Rekha Bhardwaj", "Tochi Raina", "Kailash Kher",
  "Lucky Ali", "Euphoria", "Indian Ocean", "The Yellow Diary",
  "Prateek Kuhad", "Anuv Jain", "Zaeden", "Lost Stories",
  "Nucleya", "Ritviz", "King", "Divine", "Raftaar", "Emiway Bantai",
  "Kr$na", "Seedhe Maut", "MC Stan", "Ikka", "Fotty Seven",
];

const FAMOUS_ARTIST_KEYS = new Set(
  [...FAMOUS_ENGLISH_ARTISTS, ...FAMOUS_HINDI_ARTISTS].map(normName),
);
const FAMOUS_ENGLISH_KEYS = new Set(FAMOUS_ENGLISH_ARTISTS.map(normName));
const FAMOUS_HINDI_KEYS = new Set(FAMOUS_HINDI_ARTISTS.map(normName));

/* Split a song's artist billing ("A, B & C feat. D") into names
   and return the first billed name that is a curated famous
   English / Hindi artist — its display name as billed, and which
   list it came from — or null when nobody billed is famous. Used
   by the search tab's Trending Artists, which shows famous
   EN/HI artists only, never whoever tops the raw chart. */
function famousBilling(artistField: string): { name: string; hindi: boolean } | null {
  const names = artistField
    .split(/,|&|\band\b/i)
    .map((s) => primaryArtist(s).trim())
    .filter(Boolean);
  for (const name of names) {
    const key = normName(name);
    if (FAMOUS_HINDI_KEYS.has(key)) return { name, hindi: true };
    if (FAMOUS_ENGLISH_KEYS.has(key)) return { name, hindi: false };
  }
  return null;
}
const FAMOUS_ROTATION: readonly string[] = [
  ...FAMOUS_HINDI_ARTISTS.slice(0, 28),
  ...FAMOUS_ENGLISH_ARTISTS.slice(0, 28),
];

/* Scripts that mark an album as a language other than English /
   Hindi (romanised Hindi is Latin script, Devanagari is Hindi —
   both pass). Used only to keep non-EN/HI albums by merely-famous
   crossover acts out; taste-matched albums are never script-checked. */
const NON_EN_HI_SCRIPT =
  /[\u1100-\u11FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0A80-\u0AFF\u0980-\u09FF\u0900-\u097F]/u;
function hasNonEnHiScript(text: string): boolean {
  // Devanagari (0900–097F) is Hindi — strip it before testing.
  return NON_EN_HI_SCRIPT.test(text.replace(/[\u0900-\u097F]/g, ""));
}

/* Album-card artist: subtitles look like "Album • Arijit Singh •
   2023", "Single • Artist" or "Artist • 2024" — drop the kind word,
   years and view counts; what remains is the artist billing. */
function cardArtists(card: Card): string[] {
  const parts = card.subtitle
    .split("•")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !/^(album|single|ep|playlist|chart)$/i.test(s) &&
        !/^\d{4}$/.test(s) &&
        !/views$|plays$/i.test(s),
    );
  const billing = parts.join(" ");
  if (!billing) return [];
  return billing
    .split(/,|&|\band\b/i)
    .map((s) => primaryArtist(s).trim())
    .filter(Boolean);
}

function cardYear(card: Card): number {
  const m = /\b(19|20)\d{2}\b/.exec(card.subtitle);
  return m ? Number(m[0]) : 0;
}

/* InnerTube album-filtered search (params verified live 20 Nov
   2026: returns album list items whose second column reads
   "Album • Artist • Year" with an MPREb browse id). */
const ALBUM_FILTER_PARAMS = "EgWKAQIYAWoKEAkQAxAEEAkQBQ==";

function parseAlbumItem(item: Json): Card | null {
  const nav = asObj(item["navigationEndpoint"]);
  const be = nav ? asObj(nav["browseEndpoint"]) : null;
  const browseId = be && typeof be["browseId"] === "string" ? be["browseId"] : "";
  if (!browseId) return null;
  const cfg = be ? asObj(be["browseEndpointContextSupportedConfigs"]) : null;
  const musicCfg = cfg ? asObj(cfg["browseEndpointContextMusicConfig"]) : null;
  if (musicCfg?.["pageType"] !== "MUSIC_PAGE_TYPE_ALBUM") return null;
  const cols = item["flexColumns"];
  if (!Array.isArray(cols) || cols.length === 0) return null;
  const title = runsText(cols[0]).trim();
  if (!title) return null;
  const subtitle = cols.length >= 2 ? runsText(cols[1]).trim() : "";
  return { id: browseId, title, subtitle, kind: "album", thumbnail: bestThumbnail(item) };
}

function collectAlbumCards(node: unknown, out: Card[], seen: Set<string>): void {
  if (Array.isArray(node)) {
    for (const v of node) collectAlbumCards(v, out, seen);
    return;
  }
  const obj = asObj(node);
  if (!obj) return;
  const item = asObj(obj["musicResponsiveListItemRenderer"]);
  if (item) {
    const card = parseAlbumItem(item);
    if (card && !seen.has(card.id)) {
      seen.add(card.id);
      out.push(card);
    }
  }
  for (const v of Object.values(obj)) collectAlbumCards(v, out, seen);
}

async function searchAlbumsByArtist(artist: string): Promise<Card[]> {
  const cards = await cached(
    `albums:${artist.trim().toLowerCase()}`,
    FEED_TTL_MS,
    () => searchAlbumsByArtistLive(artist),
  );
  return [...cards];
}

async function searchAlbumsByArtistLive(artist: string): Promise<Card[]> {
  const res = await fetchUpstream(
    `https://music.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: INNERTUBE_CTX,
        query: artist,
        params: ALBUM_FILTER_PARAMS,
      }),
    },
  );
  // Throws (rather than returning []) so a transient failure is
  // never cached — callers already catch and treat it as no albums.
  if (!res.ok) throw new Error(`YouTube Music album search failed (HTTP ${res.status})`);
  const data: unknown = await res.json();
  const out: Card[] = [];
  collectAlbumCards(data, out, new Set<string>());
  return out;
}

/* ---------------- Actions ---------------- */

const libraryResponse = z.object({
  tracks: z.array(trackSchema),
  playlists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      desc: z.string(),
      trackIds: z.array(z.string()),
    }),
  ),
});

const searchResponse = z.object({
  results: z.array(trackSchema),
  error: z.string().nullable(),
});

const likedResponse = z.object({
  liked: z.array(
    trackSchema.extend({ addedAt: z.string() }),
  ),
});

const toggleResponse = z.object({ liked: z.boolean() });

const officialVideoResponse = z.object({
  status: z.enum(["official", "none"]),
  videoId: z.string().nullable(),
  videoTitle: z.string(),
  error: z.string().nullable(),
  // Non-music skipping for Video mode: the video's real duration,
  // the music window inside it, the known non-music segments
  // (SponsorBlock music_offtopic / intro / outro), and where the
  // window came from. Defaults describe "play the video as-is".
  videoDurationSec: z.number(),
  musicStartSec: z.number(),
  musicEndSec: z.number(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), category: z.string() })),
  skipSource: z.enum(["segments", "duration", "none"]),
});

const lyricsResponse = z.object({
  kind: z.enum(["karaoke", "synced", "plain", "none"]),
  lines: z.array(
    z.object({
      time: z.number().nullable(),
      text: z.string(),
      words: z.array(z.object({ time: z.number(), text: z.string() })),
    }),
  ),
  error: z.string().nullable(),
});

const cardSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  kind: z.enum(["album", "playlist"]),
  thumbnail: z.string(),
});

const similarArtistSchema = z.object({
  name: z.string(),
  thumbnail: z.string(),
});

const homeFeedResponse = z.object({
  source: z.enum(["live", "fallback"]),
  trending: z.array(trackSchema),
  albums: z.array(cardSchema),
  releases: z.array(cardSchema),
  playlists: z.array(cardSchema),
  recommended: z.array(trackSchema),
  recommendedBasis: z.string().nullable(),
  similarArtists: z.array(similarArtistSchema),
});

const collectionResponse = z.object({
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  tracks: z.array(trackSchema),
  error: z.string().nullable(),
});

const okResponse = z.object({ ok: z.literal(true) });

/* ---------------- Popular / charts for the search tab ----------------
   The search tab's idle state is a ranked chart, not the starter
   library: the explore feed's Trending shelf lists songs in chart
   order with view counts ("Taylor Swift • 3.6M views"). Order is
   preserved exactly as YouTube Music returns it — no shuffling.
   Trending artists are famous English / Hindi artists only (the
   curated FAMOUS_* sets), matched across all three feeds and
   topped up with live searches when the feeds run short — never
   the raw chart's unknown acts. */

interface PopularSong extends Track {
  plays: string;
}

function parsePopularSong(item: Json): PopularSong | null {
  const pid = asObj(item["playlistItemData"]);
  const videoId = pid && typeof pid["videoId"] === "string" ? pid["videoId"] : "";
  if (!videoId) return null;
  const cols = item["flexColumns"];
  if (!Array.isArray(cols) || cols.length === 0) return null;
  const title = runsText(cols[0]).trim();
  if (!title) return null;
  const second = cols.length >= 2 ? runsText(cols[1]) : "";
  const parts = second
    .split("•")
    .map((s) => s.trim())
    .filter((s) => s);
  const artist = parts[0] ?? "";
  let album = "";
  let duration = "";
  let plays = "";
  for (const p of parts.slice(1)) {
    if (/views$|plays$/i.test(p)) plays = p;
    else if (/^\d+:\d{2}$/.test(p)) duration = p;
    else if (!album) album = p;
  }
  if (!duration) {
    const fixed = item["fixedColumns"];
    if (Array.isArray(fixed) && fixed.length > 0) {
      const fc = asObj(fixed[0]);
      const inner = fc ? asObj(fc["musicResponsiveListItemFixedColumnRenderer"]) : null;
      const text = inner ? asObj(inner["text"]) : null;
      const runs = text?.["runs"];
      if (Array.isArray(runs)) {
        const d = runs
          .map((r) => {
            const run = asObj(r);
            return typeof run?.["text"] === "string" ? run["text"] : "";
          })
          .join("")
          .trim();
        if (/^\d+:\d{2}$/.test(d)) duration = d;
      }
    }
  }
  const thumbnailUrl = bestThumbnail(item) || thumb(videoId);
  return { videoId, title, artist, album, duration, thumbnail: thumbnailUrl, plays };
}

function collectPopular(node: unknown, section: string, out: { section: string; song: PopularSong }[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectPopular(v, section, out);
    return;
  }
  const obj = asObj(node);
  if (!obj) return;
  let current = section;
  const carouselHeader = asObj(obj["musicCarouselShelfBasicHeaderRenderer"]);
  const shelfHeader = asObj(obj["musicShelfBasicHeaderRenderer"]);
  const header = carouselHeader ?? shelfHeader;
  if (header) {
    const t = headerText(header["title"]).trim();
    if (t) current = t;
  }
  const listItem = asObj(obj["musicResponsiveListItemRenderer"]);
  if (listItem) {
    const song = parsePopularSong(listItem);
    if (song) out.push({ section: current, song });
  }
  for (const v of Object.values(obj)) collectPopular(v, current, out);
}

const popularResponse = z.object({
  source: z.enum(["live", "fallback"]),
  songs: z.array(trackSchema.extend({ plays: z.string() })),
  artists: z.array(z.object({ name: z.string(), thumbnail: z.string(), plays: z.string() })),
});

/* Chart view counts arrive as display strings ("3.6M views",
   "987K views", "1.2B views"). Parse one back to a number so an
   artist's counts can be summed across their charting songs, and
   format a total the same compact way for the artist cards. */
function parsePlayCount(s: string): number {
  const m = s.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 0;
  const n = Number.parseFloat(m[1] ?? "0");
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] ?? "").toUpperCase();
  const mult = unit === "B" ? 1e9 : unit === "M" ? 1e6 : unit === "K" ? 1e3 : 1;
  return Math.round(n * mult);
}

function formatPlayCount(n: number): string {
  if (n <= 0) return "";
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (n >= 1e9) return `${trim(n / 1e9)}B plays`;
  if (n >= 1e6) return `${trim(n / 1e6)}M plays`;
  if (n >= 1e3) return `${trim(n / 1e3)}K plays`;
  return `${n} plays`;
}

/* A Trending Artist's plays total derived from a live song search
   for that artist: the search results carry real per-song play
   counts, and the counts of the songs that bill this artist are
   summed. Artwork is their top billed song's real cover.
   totalPlays is 0 when the search yields no countable plays for
   the artist — the caller then omits the artist rather than
   showing a placeholder. Nothing here is estimated or invented. */
async function artistSearchTotals(
  name: string,
): Promise<{ thumbnail: string; totalPlays: number }> {
  const songs = await searchArtistSongs(name).catch(() => [] as PopularSong[]);
  const key = normName(name);
  let totalPlays = 0;
  let thumbnail = "";
  for (const s of songs) {
    const billed = s.artist
      .split(/,|&|\band\b/i)
      .some((part) => normName(primaryArtist(part)) === key);
    if (!billed) continue;
    totalPlays += parsePlayCount(s.plays);
    if (!thumbnail) thumbnail = s.thumbnail;
  }
  if (!thumbnail) thumbnail = songs[0]?.thumbnail ?? "";
  return { thumbnail, totalPlays };
}

/* ---------------- About-page feedback (Web3Forms) ----------------
   The About page's Feedback pill posts through the submitFeedback
   action so this access key never appears in the client bundle.
   Web3Forms keys are form identifiers rather than account secrets,
   but a key visible in shipped JS lets anyone on the internet send
   unlimited fake "feedback" to the creator's inbox; server-side it
   can only be used through this action, with its length cap and
   cooldown. */
// Read from the environment - never hardcode or commit this key.
// When unset, submitFeedback returns { ok: false } without calling Web3Forms.
const WEB3FORMS_ACCESS_KEY = process.env.WEB3FORMS_ACCESS_KEY ?? "";
const FEEDBACK_COOLDOWN_MS = 10 * 1000;
let lastFeedbackAtMs = 0;

const feedbackResponse = z.object({ ok: z.boolean() });

const similarQueueResponse = z.object({
  tracks: z.array(trackSchema),
  basis: z.string().nullable(),
});

const moreSimilarResponse = z.object({
  tracks: z.array(trackSchema),
  basis: z.string().nullable(),
});

/* ---------------- Playlist import (Add Playlist) ----------------
   The Library's Add Playlist can import a PUBLIC playlist from a
   YouTube / YouTube Music link or a Spotify link.

   YouTube: the list id rides in the URL's `list` param; the
   playlist page is the same InnerTube browse (`VL<listId>`) the
   collection pages already use, so title, cover and tracks come
   back as playable YouTube Music tracks directly.

   Spotify: there are no Spotify credentials in this app (and none
   may ship in it), so the tracklist comes from Spotify's own
   public embed page for the playlist — its embedded JSON carries
   the playlist name, cover art and track list (title + artists +
   duration) for public playlists. Each Spotify track is then
   matched to a playable YouTube Music track with a live song
   search, scored on title + artist so a wrong upload is not
   picked; a track with no confident match is skipped and counted,
   never guessed. */

type PlaylistPlatform = "youtube" | "spotify";

function parsePlaylistUrl(raw: string): { platform: PlaylistPlatform; id: string } | null {
  const input = raw.trim();
  if (!input) return null;
  const uriMatch = /^spotify:playlist:([A-Za-z0-9]{10,40})$/.exec(input);
  if (uriMatch?.[1]) return { platform: "spotify", id: uriMatch[1] };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "open.spotify.com" || host === "play.spotify.com") {
    const m = /\/(?:embed\/)?playlist\/([A-Za-z0-9]{10,40})(?:[/?#]|$)/.exec(url.pathname);
    if (m?.[1]) return { platform: "spotify", id: m[1] };
    return null;
  }
  if (
    host === "youtube.com" ||
    host === "music.youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com"
  ) {
    const list = url.searchParams.get("list") ?? "";
    if (/^[A-Za-z0-9_-]{8,90}$/.test(list)) return { platform: "youtube", id: list };
    return null;
  }
  return null;
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function headerThumbnail(h: Json): string {
  const direct = bestThumbnail(h);
  if (direct) return direct;
  const wrap = asObj(h["thumbnail"]);
  const inner = wrap
    ? (asObj(wrap["musicThumbnailRenderer"]) ?? asObj(wrap["croppedSquareThumbnailRenderer"]))
    : null;
  const th = inner ? asObj(inner["thumbnail"]) : null;
  const list = th?.["thumbnails"];
  if (Array.isArray(list) && list.length > 0) {
    const last = asObj(list[list.length - 1]);
    if (last && typeof last["url"] === "string") {
      return last["url"].replace(/=w\d+-h\d+/, "=w540-h540");
    }
  }
  return "";
}

interface FetchedPlaylist {
  title: string;
  thumbnail: string;
  tracks: Track[];
}

async function fetchYouTubePlaylist(listId: string): Promise<FetchedPlaylist> {
  const data = await innertubeBrowse(`VL${listId}`);
  const headers: Json[] = [];
  const collectHeaders = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const v of node) collectHeaders(v);
      return;
    }
    const obj = asObj(node);
    if (!obj) return;
    const h = asObj(obj["musicResponsiveHeaderRenderer"]) ?? asObj(obj["musicDetailHeaderRenderer"]);
    if (h) headers.push(h);
    for (const v of Object.values(obj)) collectHeaders(v);
  };
  collectHeaders(data);
  const h = headers[0];
  const title = h ? headerText(h["title"]).trim() : "";
  const sections: FeedSections = { songs: [], cards: [] };
  collectFeed(data, "", sections);
  const tracks = dedupeTracks(sections.songs.map((s) => s.track)).slice(0, 200);
  if (!title && tracks.length === 0) {
    throw new Error("Playlist not found or not public.");
  }
  const thumbnail = (h ? headerThumbnail(h) : "") || tracks[0]?.thumbnail || "";
  return { title: title || "YouTube playlist", thumbnail, tracks };
}

interface SpotifyTrackSeed {
  title: string;
  artist: string;
  duration: string;
}

interface FetchedSpotifyPlaylist {
  title: string;
  thumbnail: string;
  seeds: SpotifyTrackSeed[];
}

async function fetchSpotifyPlaylistLive(playlistId: string): Promise<FetchedSpotifyPlaylist> {
  const res = await fetchUpstream(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Spotify playlist page failed (HTTP ${res.status})`);
  const html = await res.text();
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) throw new Error("Spotify playlist data not found.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    throw new Error("Spotify playlist data could not be read.");
  }
  const props = asObj(asObj(parsed)?.["props"]);
  const pageProps = props ? asObj(props["pageProps"]) : null;
  const state = pageProps ? asObj(pageProps["state"]) : null;
  const dataObj = state ? asObj(state["data"]) : null;
  const entity = dataObj ? asObj(dataObj["entity"]) : null;
  if (!entity || entity["type"] !== "playlist") {
    throw new Error("That link is not a Spotify playlist.");
  }
  const title = typeof entity["name"] === "string" ? entity["name"].trim() : "";
  let thumbnail = "";
  const cover = asObj(entity["coverArt"]);
  const sources = cover?.["sources"];
  if (Array.isArray(sources)) {
    let bestW = -1;
    for (const s of sources) {
      const so = asObj(s);
      if (!so || typeof so["url"] !== "string") continue;
      const w = typeof so["width"] === "number" ? so["width"] : 0;
      if (w >= bestW) {
        bestW = w;
        thumbnail = so["url"];
      }
    }
  }
  if (!thumbnail) {
    const vis = asObj(entity["visualIdentity"]);
    const images = vis?.["image"];
    if (Array.isArray(images) && images.length > 0) {
      const first = asObj(images[0]);
      if (first && typeof first["url"] === "string") thumbnail = first["url"];
    }
  }
  const seeds: SpotifyTrackSeed[] = [];
  const trackList = entity["trackList"];
  if (Array.isArray(trackList)) {
    for (const item of trackList) {
      const t = asObj(item);
      if (!t || typeof t["title"] !== "string" || !t["title"].trim()) continue;
      const artist = typeof t["subtitle"] === "string" ? t["subtitle"].replace(/ /g, " ").trim() : "";
      const duration = typeof t["duration"] === "number" ? formatDurationMs(t["duration"]) : "";
      seeds.push({ title: t["title"].trim(), artist, duration });
    }
  }
  if (!title && seeds.length === 0) throw new Error("Playlist not found or not public.");
  return { title: title || "Spotify playlist", thumbnail, seeds: seeds.slice(0, 100) };
}

function fetchSpotifyPlaylist(playlistId: string): Promise<FetchedSpotifyPlaylist> {
  return cached(`spotify-playlist:${playlistId}`, FEED_TTL_MS, () => fetchSpotifyPlaylistLive(playlistId));
}

function matchScore(seed: SpotifyTrackSeed, candidate: Track): number {
  const seedTitle = baseTitle(seed.title);
  const candTitle = baseTitle(candidate.title);
  if (!seedTitle || !candTitle) return 0;
  let score = 0;
  if (candTitle === seedTitle) score += 60;
  else if (candTitle.includes(seedTitle) || seedTitle.includes(candTitle)) score += 40;
  else {
    const seedWords = new Set(seedTitle.split(" ").filter((w) => w.length > 2));
    const overlap = candTitle.split(" ").filter((w) => seedWords.has(w)).length;
    score += Math.min(25, overlap * 8);
  }
  const primary = primaryArtist(seed.artist).toLowerCase();
  const candArtist = candidate.artist.toLowerCase();
  if (primary && candArtist) {
    if (candArtist.includes(primary) || primary.includes(candArtist.split(",")[0]?.trim() ?? "")) score += 35;
  }
  return score;
}

async function matchSpotifyTracks(
  seeds: SpotifyTrackSeed[],
): Promise<{ tracks: Track[]; skipped: number }> {
  const tracks: Track[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  // Match in small parallel batches so a 50-track playlist does
  // not fire 50 searches at once (or one at a time).
  for (let i = 0; i < seeds.length; i += 4) {
    const batch = seeds.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (seed) => {
        try {
          const primary = primaryArtist(seed.artist);
          const found = await searchYouTubeMusic(primary ? `${seed.title} ${primary}` : seed.title);
          let best: Track | null = null;
          let bestScore = 0;
          for (const c of found) {
            const s = matchScore(seed, c);
            if (s > bestScore) {
              bestScore = s;
              best = c;
            }
          }
          return best && bestScore >= 45 ? best : null;
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r && !seen.has(r.videoId)) {
        seen.add(r.videoId);
        tracks.push(r);
      } else if (!r) {
        skipped += 1;
      }
    }
  }
  return { tracks, skipped };
}

const playlistImportPreviewResponse = z.object({
  ok: z.boolean(),
  platform: z.enum(["youtube", "spotify"]).nullable(),
  title: z.string(),
  thumbnail: z.string(),
  trackCount: z.number(),
  error: z.string().nullable(),
});

const userPlaylistCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  kind: z.literal("playlist"),
  thumbnail: z.string(),
  trackCount: z.number(),
  totalDurationSec: z.number(),
  source: z.string(),
});

const listUserPlaylistsResponse = z.object({
  playlists: z.array(userPlaylistCardSchema),
});

const importPlaylistResponse = z.object({
  ok: z.boolean(),
  playlist: userPlaylistCardSchema.nullable(),
  skipped: z.number(),
  error: z.string().nullable(),
});

const PLAYLIST_IMPORT_ERROR =
  "Couldn't load this playlist. Please make sure the link is valid and the playlist is set to Public.";

export const Actions = {
  getLibrary: {
    description: "Legacy endpoint kept for type compatibility only: the seeded starter library was removed at the user's request, so this always returns empty lists. All real content comes live from YouTube Music (getHomeFeed / getSpeedDial / searchMusic / getPopular) or from the user's own Liked Songs.",
    request: z.object({}),
    response: libraryResponse,
    async handler(_args: any, _ctx: ActionContext): Promise<z.infer<typeof libraryResponse>> {
      return { tracks: [], playlists: [] };
    },
  },

  searchMusic: {
    description:
      "Live-searches YouTube Music for any song and returns playable results with real YouTube video IDs.",
    request: z.object({ query: z.string().trim().min(1).max(120) }),
    response: searchResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof searchResponse>> {
      try {
        const results = await searchYouTubeMusic(args.query);
        // Remember the search for homepage recommendations (never let
        // bookkeeping break the search itself).
        try {
          const db = ctx.db;
          const last = await db
            .select()
            .from(schema.listeningHistory)
            .where(eq(schema.listeningHistory.deviceId, ctx.deviceId))
            .orderBy(desc(schema.listeningHistory.id))
            .limit(1);
          if (!(last[0]?.kind === "search" && last[0]?.query === args.query)) {
            await db.insert(schema.listeningHistory).values({ deviceId: ctx.deviceId, kind: "search", query: args.query });
          }
        } catch {
          /* history is best-effort */
        }
        return { results, error: null };
      } catch (e) {
        return {
          results: [],
          error: e instanceof Error ? e.message : "Search failed. Try again.",
        };
      }
    },
  },

  listLiked: {
    description: "Lists the user's Liked Songs, most recently liked first.",
    request: z.object({}),
    response: likedResponse,
    async handler(_args: any, ctx: ActionContext): Promise<z.infer<typeof likedResponse>> {
      const db = ctx.db;
      let rows = await db
        .select()
        .from(schema.likedTracks)
        .where(eq(schema.likedTracks.deviceId, ctx.deviceId))
        .orderBy(desc(schema.likedTracks.addedAt));
      // One-time hygiene for the removed seeded library: a starter song
      // sitting in Liked Songs with NO play/like event in the user's own
      // listening history was never chosen by the user, so it is deleted.
      // A starter song the user genuinely played or liked (history row
      // exists) is their own pick and is kept.
      try {
        const starterRows = rows.filter((r) => STARTER_VIDEO_IDS.has(r.videoId));
        if (starterRows.length > 0) {
          const hist = await db
            .select()
            .from(schema.listeningHistory)
            .where(eq(schema.listeningHistory.deviceId, ctx.deviceId))
            .orderBy(desc(schema.listeningHistory.id))
            .limit(5000);
          const evidenced = new Set(
            hist.filter((h) => (h.kind === "play" || h.kind === "like") && h.videoId).map((h) => h.videoId),
          );
          for (const r of starterRows) {
            if (!evidenced.has(r.videoId)) {
              await db.delete(schema.likedTracks).where(and(eq(schema.likedTracks.deviceId, ctx.deviceId), eq(schema.likedTracks.videoId, r.videoId)));
            }
          }
          rows = rows.filter((r) => !STARTER_VIDEO_IDS.has(r.videoId) || evidenced.has(r.videoId));
        }
      } catch {
        /* hygiene is best-effort; never break listing likes */
      }
      return {
        liked: rows.map((r) => ({
          videoId: r.videoId,
          title: r.title,
          artist: r.artist,
          album: r.album,
          duration: r.duration,
          thumbnail: r.thumbnail,
          addedAt: r.addedAt.toISOString(),
        })),
      };
    },
  },

  getLyrics: {
    description:
      "Fetches lyrics for a track live from LRCLib: time-synced LRC lines when available, plain lyrics as a fallback, or kind 'none' when the song has no lyrics there. With forceRefresh, the cached lookup for the song is discarded first and LRCLib is re-queried live (the Lyrics view's Refresh button, for glitched or off-sync lyrics).",
    request: z.object({
      title: z.string().trim().min(1).max(200),
      artist: z.string().trim().min(1).max(200),
      durationSec: z.number().int().min(0).max(3600).optional(),
      forceRefresh: z.boolean().optional(),
    }),
    response: lyricsResponse,
    async handler(args: any, _ctx: ActionContext): Promise<z.infer<typeof lyricsResponse>> {
      try {
        // A song's lyrics don't change — cache the (multi-call,
        // sequential) LRCLib lookup so reopening the lyrics sheet
        // or the desktop panel for the same song is instant. Only
        // successful lookups reach the cache; errors retry live.
        // forceRefresh (the user's Refresh lyrics tap) busts the
        // entry first so the lookup below runs live against
        // LRCLib instead of serving the possibly stale copy.
        const cacheKey = `lyrics:${args.title.trim().toLowerCase()}|${args.artist.trim().toLowerCase()}|${args.durationSec ?? ""}`;
        if (args.forceRefresh) bustCache(cacheKey);
        const r = await cached(
          cacheKey,
          LYRICS_TTL_MS,
          () => fetchLyrics(args.title, args.artist, args.durationSec ?? null),
        );
        return { kind: r.kind, lines: r.lines, error: null };
      } catch (e) {
        return {
          kind: "none",
          lines: [],
          error: e instanceof Error ? e.message : "Lyrics could not be loaded.",
        };
      }
    },
  },

  getOfficialVideo: {
    description:
      "Finds the VERIFIED official YouTube music video for a song (the Video view in the player): ranks live YouTube Music video-search results for the title + artist, accepting only the artist's / VEVO / label channel's official upload. Returns status 'official' with that video, or 'none' with no videoId — never a non-official / fan / lyric fallback, because a wrong upload's timeline desyncs the scrubber and lyrics. Also returns the official video's non-music segments (SponsorBlock music_offtopic / intro / outro) and the music window inside the video — from those segments when known, otherwise from comparing the video's duration with the audio track's — so Video mode can skip spoken intros, dialogue and credits without cutting music.",
    request: z.object({
      title: z.string().trim().min(1).max(200),
      artist: z.string().trim().min(1).max(200),
      durationSec: z.number().int().min(0).max(3600).optional(),
    }),
    response: officialVideoResponse,
    async handler(args: any, _ctx: ActionContext): Promise<z.infer<typeof officialVideoResponse>> {
      try {
        const r = await cached(
          `officialvideo:${args.title.trim().toLowerCase()}|${args.artist.trim().toLowerCase()}`,
          LYRICS_TTL_MS,
          () => resolveOfficialVideo(args.title, args.artist, args.durationSec ?? null),
        );
        return {
          status: r.status,
          videoId: r.videoId,
          videoTitle: r.videoTitle,
          error: null,
          videoDurationSec: r.videoDurationSec,
          musicStartSec: r.musicStartSec,
          musicEndSec: r.musicEndSec,
          segments: r.segments,
          skipSource: r.skipSource,
        };
      } catch (e) {
        return {
          status: "none",
          videoId: null,
          videoTitle: "",
          error: e instanceof Error ? e.message : "The video lookup failed. Try again.",
          videoDurationSec: 0,
          musicStartSec: 0,
          musicEndSec: 0,
          segments: [],
          skipSource: "none",
        };
      }
    },
  },

  toggleLike: {
    description:
      "Likes a track if it is not liked yet, or removes the like if it already is. Returns the new liked state.",
    request: z.object({ track: trackInputSchema }),
    response: toggleResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof toggleResponse>> {
      const db = ctx.db;
      const t = args.track;
      const existing = await db
        .select({ videoId: schema.likedTracks.videoId })
        .from(schema.likedTracks)
        .where(and(eq(schema.likedTracks.deviceId, ctx.deviceId), eq(schema.likedTracks.videoId, t.videoId)));
      if (existing.length > 0) {
        await db
          .delete(schema.likedTracks)
          .where(and(eq(schema.likedTracks.deviceId, ctx.deviceId), eq(schema.likedTracks.videoId, t.videoId)));
        ctx.invalidateQueries();
        return { liked: false };
      }
      await db.insert(schema.likedTracks).values({
        deviceId: ctx.deviceId,
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        thumbnail: t.thumbnail,
      });
      try {
        await db.insert(schema.listeningHistory).values({
          deviceId: ctx.deviceId,
          kind: "like",
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
        });
      } catch {
        /* history is best-effort */
      }
      ctx.invalidateQueries();
      return { liked: true };
    },
  },

  recordPlay: {
    description:
      "Records that the user played a track, into listening_history, so the homepage can recommend more in the same styles.",
    request: z.object({ track: trackInputSchema }),
    response: okResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof okResponse>> {
      try {
        const db = ctx.db;
        const last = await db
          .select()
          .from(schema.listeningHistory)
          .where(eq(schema.listeningHistory.deviceId, ctx.deviceId))
          .orderBy(desc(schema.listeningHistory.id))
          .limit(1);
        if (!(last[0]?.kind === "play" && last[0]?.videoId === args.track.videoId)) {
          await db.insert(schema.listeningHistory).values({
            deviceId: ctx.deviceId,
            kind: "play",
            videoId: args.track.videoId,
            title: args.track.title,
            artist: args.track.artist,
            durationSec: parseDurationSec(args.track.duration),
          });
        }
      } catch {
        /* history is best-effort */
      }
      return { ok: true as const };
    },
  },

  hidePlaylist: {
    description:
      "Removes a live-feed playlist from All Playlists for good: remembers its browse id in hidden_playlists so getHomeFeed filters it out on every future load. Idempotent — hiding the same playlist twice is a no-op.",
    request: z.object({
      id: z.string().trim().min(1).max(300),
      title: z.string().trim().max(300).optional(),
    }),
    response: okResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db;
      const existing = await db
        .select({ playlistId: schema.hiddenPlaylists.playlistId })
        .from(schema.hiddenPlaylists)
        .where(and(eq(schema.hiddenPlaylists.deviceId, ctx.deviceId), eq(schema.hiddenPlaylists.playlistId, args.id)));
      if (existing.length === 0) {
        await db.insert(schema.hiddenPlaylists).values({
          deviceId: ctx.deviceId,
          playlistId: args.id,
          title: args.title ?? "",
        });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  },

  previewPlaylistImport: {
    description:
      "Checks a YouTube / YouTube Music / Spotify playlist link for the Add Playlist import sheet: detects the platform from the URL and, for a public playlist, returns its real title, cover art and track count so the sheet can auto-fill the playlist name. No tracks are matched or saved here.",
    request: z.object({ url: z.string().trim().min(8).max(2000) }),
    response: playlistImportPreviewResponse,
    async handler(args: any, _ctx: ActionContext): Promise<z.infer<typeof playlistImportPreviewResponse>> {
      const parsed = parsePlaylistUrl(args.url);
      if (!parsed) {
        return { ok: false, platform: null, title: "", thumbnail: "", trackCount: 0, error: PLAYLIST_IMPORT_ERROR };
      }
      try {
        if (parsed.platform === "youtube") {
          const fetched = await fetchYouTubePlaylist(parsed.id);
          if (fetched.tracks.length === 0) {
            return { ok: false, platform: parsed.platform, title: "", thumbnail: "", trackCount: 0, error: PLAYLIST_IMPORT_ERROR };
          }
          return {
            ok: true,
            platform: parsed.platform,
            title: fetched.title,
            thumbnail: fetched.thumbnail,
            trackCount: fetched.tracks.length,
            error: null,
          };
        }
        const fetched = await fetchSpotifyPlaylist(parsed.id);
        if (fetched.seeds.length === 0) {
          return { ok: false, platform: parsed.platform, title: "", thumbnail: "", trackCount: 0, error: PLAYLIST_IMPORT_ERROR };
        }
        return {
          ok: true,
          platform: parsed.platform,
          title: fetched.title,
          thumbnail: fetched.thumbnail,
          trackCount: fetched.seeds.length,
          error: null,
        };
      } catch {
        return { ok: false, platform: parsed.platform, title: "", thumbnail: "", trackCount: 0, error: PLAYLIST_IMPORT_ERROR };
      }
    },
  },

  importPlaylist: {
    description:
      "Imports a public YouTube / YouTube Music / Spotify playlist into the user's own Library (user_playlists + user_playlist_tracks). YouTube tracks are stored as fetched; Spotify tracks are matched to playable YouTube Music tracks first (unmatchable tracks are skipped and counted in `skipped`). An optional user-supplied name overrides the fetched playlist title. Importing the same source link again replaces the earlier import instead of duplicating it.",
    request: z.object({
      url: z.string().trim().min(8).max(2000),
      name: z.string().trim().max(120).optional(),
    }),
    response: importPlaylistResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof importPlaylistResponse>> {
      const parsed = parsePlaylistUrl(args.url);
      if (!parsed) {
        return { ok: false, playlist: null, skipped: 0, error: PLAYLIST_IMPORT_ERROR };
      }
      try {
        let fetchedTitle = "";
        let thumbnail = "";
        let tracks: Track[] = [];
        let skipped = 0;
        if (parsed.platform === "youtube") {
          const fetched = await fetchYouTubePlaylist(parsed.id);
          fetchedTitle = fetched.title;
          thumbnail = fetched.thumbnail;
          tracks = fetched.tracks;
        } else {
          const fetched = await fetchSpotifyPlaylist(parsed.id);
          fetchedTitle = fetched.title;
          thumbnail = fetched.thumbnail;
          const matched = await matchSpotifyTracks(fetched.seeds);
          tracks = matched.tracks;
          skipped = matched.skipped;
        }
        if (tracks.length === 0) {
          return { ok: false, playlist: null, skipped, error: PLAYLIST_IMPORT_ERROR };
        }
        const title = (args.name ?? "").trim() || fetchedTitle || "Imported playlist";
        if (!thumbnail) thumbnail = tracks[0]?.thumbnail ?? "";
        const db = ctx.db;
        // Re-importing the same link replaces the earlier import.
        const existing = await db
          .select()
          .from(schema.userPlaylists)
          .where(and(eq(schema.userPlaylists.deviceId, ctx.deviceId), eq(schema.userPlaylists.sourceId, parsed.id)));
        const dupe = existing.find((r) => r.source === parsed.platform);
        let playlistId = dupe?.id ?? "";
        if (dupe) {
          await db.delete(schema.userPlaylistTracks).where(and(eq(schema.userPlaylistTracks.deviceId, ctx.deviceId), eq(schema.userPlaylistTracks.playlistId, dupe.id)));
          await db
            .update(schema.userPlaylists)
            .set({ title, sourceUrl: args.url, thumbnail })
            .where(and(eq(schema.userPlaylists.deviceId, ctx.deviceId), eq(schema.userPlaylists.id, dupe.id)));
        } else {
          playlistId = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
          await db.insert(schema.userPlaylists).values({
            deviceId: ctx.deviceId,
            id: playlistId,
            title,
            source: parsed.platform,
            sourceUrl: args.url,
            sourceId: parsed.id,
            thumbnail,
          });
        }
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          if (!t) continue;
          await db.insert(schema.userPlaylistTracks).values({
            deviceId: ctx.deviceId,
            playlistId,
            position: i,
            videoId: t.videoId,
            title: t.title,
            artist: t.artist,
            album: t.album,
            duration: t.duration,
            thumbnail: t.thumbnail,
          });
        }
        const totalDurationSec = tracks.reduce((a, t) => a + parseDurationSec(t.duration), 0);
        ctx.invalidateQueries();
        return {
          ok: true,
          playlist: {
            id: `user:${playlistId}`,
            title,
            subtitle:
              parsed.platform === "spotify"
                ? "Imported from Spotify"
                : parsed.platform === "youtube"
                  ? "Imported from YouTube"
                  : "Your playlist",
            kind: "playlist" as const,
            thumbnail,
            trackCount: tracks.length,
            totalDurationSec,
            source: parsed.platform,
          },
          skipped,
          error: null,
        };
      } catch {
        return { ok: false, playlist: null, skipped: 0, error: PLAYLIST_IMPORT_ERROR };
      }
    },
  },

  createPlaylist: {
    description:
      "Creates a new blank playlist of the user's own (Add Playlist → Create New) with the given name and no tracks yet, saved to user_playlists. Returns its Library card.",
    request: z.object({ name: z.string().trim().min(1).max(120) }),
    response: importPlaylistResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof importPlaylistResponse>> {
      const db = ctx.db;
      const playlistId = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      await db.insert(schema.userPlaylists).values({
        deviceId: ctx.deviceId,
        id: playlistId,
        title: args.name,
        source: "created",
        sourceUrl: "",
        sourceId: "",
        thumbnail: "",
      });
      ctx.invalidateQueries();
      return {
        ok: true,
        playlist: {
          id: `user:${playlistId}`,
          title: args.name,
          subtitle: "Your playlist",
          kind: "playlist" as const,
          thumbnail: "",
          trackCount: 0,
          totalDurationSec: 0,
          source: "created",
        },
        skipped: 0,
        error: null,
      };
    },
  },

  listUserPlaylists: {
    description:
      "Lists the user's own playlists (created + imported) as Library cards, newest first, with real track counts and total durations from their stored tracks.",
    request: z.object({}),
    response: listUserPlaylistsResponse,
    async handler(_args: any, ctx: ActionContext): Promise<z.infer<typeof listUserPlaylistsResponse>> {
      const db = ctx.db;
      const rows = await db
        .select()
        .from(schema.userPlaylists)
        .where(eq(schema.userPlaylists.deviceId, ctx.deviceId))
        .orderBy(desc(schema.userPlaylists.createdAt));
      const out: z.infer<typeof listUserPlaylistsResponse>["playlists"] = [];
      for (const r of rows) {
        const trackRows = await db
          .select()
          .from(schema.userPlaylistTracks)
          .where(and(eq(schema.userPlaylistTracks.deviceId, ctx.deviceId), eq(schema.userPlaylistTracks.playlistId, r.id)));
        out.push({
          id: `user:${r.id}`,
          title: r.title,
          subtitle:
            r.source === "spotify"
              ? "Imported from Spotify"
              : r.source === "youtube"
                ? "Imported from YouTube"
                : "Your playlist",
          kind: "playlist" as const,
          thumbnail: r.thumbnail || trackRows[0]?.thumbnail || "",
          trackCount: trackRows.length,
          totalDurationSec: trackRows.reduce((a, t) => a + parseDurationSec(t.duration), 0),
          source: r.source,
        });
      }
      return { playlists: out };
    },
  },

  getUserPlaylist: {
    description:
      "Opens one of the user's own playlists (created or imported) in the collection page shape: its title, a source subtitle, and its stored tracks in playlist order.",
    request: z.object({ playlistId: z.string().trim().min(1).max(120) }),
    response: collectionResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof collectionResponse>> {
      const db = ctx.db;
      const rawId = args.playlistId.startsWith("user:") ? args.playlistId.slice(5) : args.playlistId;
      const rows = await db.select().from(schema.userPlaylists).where(and(eq(schema.userPlaylists.deviceId, ctx.deviceId), eq(schema.userPlaylists.id, rawId)));
      const row = rows[0];
      if (!row) {
        return { title: "", subtitle: "", description: "", tracks: [], error: "This playlist could not be found." };
      }
      const trackRows = await db
        .select()
        .from(schema.userPlaylistTracks)
        .where(and(eq(schema.userPlaylistTracks.deviceId, ctx.deviceId), eq(schema.userPlaylistTracks.playlistId, row.id)))
        .orderBy(schema.userPlaylistTracks.position);
      return {
        title: row.title,
        subtitle:
          row.source === "spotify"
            ? "Imported from Spotify"
            : row.source === "youtube"
              ? "Imported from YouTube"
              : "Your playlist",
        description: "",
        tracks: trackRows.map((t) => ({
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          thumbnail: t.thumbnail,
        })),
        error: null,
      };
    },
  },

  deleteUserPlaylist: {
    description:
      "Deletes one of the user's own playlists (created or imported) and all of its stored tracks. Used by the All Playlists long-press removal for user playlists; live-feed playlists are removed via hidePlaylist instead.",
    request: z.object({ id: z.string().trim().min(1).max(300) }),
    response: okResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db;
      const rawId = args.id.startsWith("user:") ? args.id.slice(5) : args.id;
      await db.delete(schema.userPlaylistTracks).where(and(eq(schema.userPlaylistTracks.deviceId, ctx.deviceId), eq(schema.userPlaylistTracks.playlistId, rawId)));
      await db.delete(schema.userPlaylists).where(and(eq(schema.userPlaylists.deviceId, ctx.deviceId), eq(schema.userPlaylists.id, rawId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  },

  getHomeFeed: {
    description:
      "Builds the live homepage from YouTube Music browse feeds (home / explore / charts): top-5 trending songs, album and playlist cards, plus a top-5 recommendation mix built from the user's full play/like/search history — their artists, their songs, and similar artists and songs beyond them — with the similar-artists list. The separate 'releases' list (the New releases section) is filtered to famous English/Hindi artists and artists matching the user's taste (their own + similar artists), topped up with live album searches for those artists, newest first. source 'fallback' means YouTube Music was unreachable and the client must show an honest empty / try-again state (there is no starter library to fall back to).",
    request: z.object({}),
    response: homeFeedResponse,
    async handler(_args: any, ctx: ActionContext): Promise<z.infer<typeof homeFeedResponse>> {
      const empty: z.infer<typeof homeFeedResponse> = {
        source: "fallback",
        trending: [],
        albums: [],
        releases: [],
        playlists: [],
        recommended: [],
        recommendedBasis: null,
        similarArtists: [],
      };
      const db = ctx.db;

      // --- the user's own taste profile ---
      let historyRows: (typeof schema.listeningHistory.$inferSelect)[] = [];
      let likedRows: (typeof schema.likedTracks.$inferSelect)[] = [];
      let hiddenPlaylistIds = new Set<string>();
      try {
        historyRows = await db
          .select()
          .from(schema.listeningHistory)
          .where(eq(schema.listeningHistory.deviceId, ctx.deviceId))
          .orderBy(desc(schema.listeningHistory.id))
          .limit(120);
        likedRows = await db.select().from(schema.likedTracks).where(eq(schema.likedTracks.deviceId, ctx.deviceId));
      } catch {
        /* no history yet — recommendations fall back to trending */
      }
      try {
        const hiddenRows = await db.select().from(schema.hiddenPlaylists).where(eq(schema.hiddenPlaylists.deviceId, ctx.deviceId));
        hiddenPlaylistIds = new Set(hiddenRows.map((r) => r.playlistId));
      } catch {
        /* no hidden playlists yet */
      }
      const artistScores = new Map<string, number>();
      const queryScores = new Map<string, number>();
      const seenIds = new Set<string>();
      const bump = (m: Map<string, number>, k: string, w: number) => {
        const key = k.trim();
        if (key) m.set(key, (m.get(key) ?? 0) + w);
      };
      let lastPlayedTitle: string | null = null;
      for (const r of historyRows) {
        if (r.kind === "play") {
          bump(artistScores, primaryArtist(r.artist), 1);
          if (r.videoId) seenIds.add(r.videoId);
          if (!lastPlayedTitle && r.title) lastPlayedTitle = r.title;
        } else if (r.kind === "like") {
          bump(artistScores, primaryArtist(r.artist), 3);
          if (r.videoId) seenIds.add(r.videoId);
        } else if (r.kind === "search") {
          bump(queryScores, r.query, 2);
        }
      }
      for (const l of likedRows) {
        bump(artistScores, primaryArtist(l.artist), 3);
        seenIds.add(l.videoId);
      }
      // The full taste profile — every artist the user has played,
      // liked or searched around, not just the single top one.
      const topArtists = [...artistScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([a]) => a);
      const topQueries = [...queryScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([q]) => q);
      // Recent distinct songs the user actually played — seeds for
      // "songs like the ones you play", not only artist searches.
      const recentSongs: { title: string; artist: string }[] = [];
      {
        const seenSong = new Set<string>();
        for (const r of historyRows) {
          if (r.kind !== "play" && r.kind !== "like") continue;
          if (!r.title || !r.artist) continue;
          const key = `${r.title}|${r.artist}`.toLowerCase();
          if (seenSong.has(key)) continue;
          seenSong.add(key);
          recentSongs.push({ title: r.title, artist: primaryArtist(r.artist) });
          if (recentSongs.length >= 3) break;
        }
      }

      // --- live browse feeds ---
      const feedIds = ["FEmusic_home", "FEmusic_explore", "FEmusic_charts"] as const;
      const settled = await Promise.allSettled(feedIds.map((id) => innertubeBrowse(id)));
      const sections: FeedSections = { songs: [], cards: [] };
      let anyLive = false;
      for (const s of settled) {
        if (s.status === "fulfilled") {
          anyLive = true;
          collectFeed(s.value, "", sections);
        }
      }
      if (!anyLive) return empty;

      const allSongs = withoutStarters(dedupeTracks(sections.songs.map((s) => s.track)));
      const trending = shuffle(allSongs).slice(0, 5);
      // Raw feed albums stay available to the Library Albums page;
      // the New releases section gets its own filtered list below.
      const feedAlbums = dedupeCards(
        sections.cards.filter((c) => c.card.kind === "album").map((c) => c.card),
      );
      const albums = shuffle(feedAlbums).slice(0, 10);
      const playlists = shuffle(
        dedupeCards(sections.cards.filter((c) => c.card.kind === "playlist").map((c) => c.card)).filter(
          (c) => !hiddenPlaylistIds.has(c.id),
        ),
      ).slice(0, 10);
      // Artists charting in these same live feeds right now — a
      // real-time fame signal for the releases filter.
      const chartArtistKeys = new Set<string>();
      {
        const counts = new Map<string, number>();
        for (const t of allSongs) {
          const k = normName(primaryArtist(t.artist));
          if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        for (const [k, n] of counts) if (n >= 2) chartArtistKeys.add(k);
      }

      // --- recommendations from the user's full taste profile ---
      // Stage 1: search every seed — all of the user's artists, their
      // searches, and "<song> <artist>" for songs they actually played.
      // Stage 2: the artists who keep showing up in those results but
      // are NOT already the user's own artists are the similar
      // artists; search them too, so the mix reaches beyond the one
      // artist the user already knows.
      let recommended: Track[] = [];
      let recommendedBasis: string | null = null;
      let similarArtists: { name: string; thumbnail: string }[] = [];
      const ownArtistKeys = new Set(topArtists.map((a) => a.toLowerCase()));
      if (topArtists.length > 0 || topQueries.length > 0 || recentSongs.length > 0) {
        const seedQueries = [
          ...topArtists,
          ...topQueries,
          ...recentSongs.map((s) => `${s.title} ${s.artist}`),
        ];
        const stage1 = await Promise.all(
          seedQueries.map((q) => searchYouTubeMusic(q).catch(() => [] as Track[])),
        );
        const perSource: Track[][] = stage1.map((r) =>
          r.filter((t) => !seenIds.has(t.videoId) && !isStarterTrack(t)),
        );

        // Similar artists: ranked by how often they appear across the
        // seed results, excluding the user's own artists.
        const simScores = new Map<string, { name: string; thumbnail: string; score: number }>();
        for (const list of stage1) {
          const countedInList = new Set<string>();
          for (const t of list) {
            const name = primaryArtist(t.artist);
            const key = name.toLowerCase();
            if (!name || ownArtistKeys.has(key) || countedInList.has(key)) continue;
            countedInList.add(key);
            const cur = simScores.get(key);
            if (cur) cur.score += 1;
            else simScores.set(key, { name, thumbnail: t.thumbnail, score: 1 });
          }
        }
        const similarRanked = [...simScores.values()].sort((a, b) => b.score - a.score);
        similarArtists = similarRanked
          .slice(0, 8)
          .map(({ name, thumbnail }) => ({ name, thumbnail }));

        // Stage 2: pull songs from the top similar artists as well.
        const stage2 = await Promise.all(
          similarRanked.slice(0, 4).map((s) => searchYouTubeMusic(s.name).catch(() => [] as Track[])),
        );
        for (const r of stage2) perSource.push(r.filter((t) => !seenIds.has(t.videoId) && !isStarterTrack(t)));

        // Round-robin across every source so no single artist floods
        // the row, then cap per artist in the final five.
        const pool: Track[] = [];
        let added = true;
        for (let round = 0; added && pool.length < 40; round++) {
          added = false;
          for (const list of perSource) {
            const t = list[round];
            if (t) {
              pool.push(t);
              added = true;
            }
          }
        }
        const mixed = dedupeTracks(pool);
        const picked: Track[] = [];
        const perArtist = new Map<string, number>();
        for (const t of mixed) {
          if (picked.length >= 5) break;
          const key = primaryArtist(t.artist).toLowerCase();
          if ((perArtist.get(key) ?? 0) >= 2) continue;
          perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
          picked.push(t);
        }
        if (picked.length < 5) {
          for (const t of mixed) {
            if (picked.length >= 5) break;
            if (!picked.some((p) => p.videoId === t.videoId)) picked.push(t);
          }
        }
        recommended = picked;
        if (recommended.length > 0) {
          const names = topArtists.slice(0, 3);
          recommendedBasis =
            names.length >= 2
              ? `Built from ${names.join(", ")} — plus artists and songs similar to your taste`
              : names.length === 1
                ? `Built from ${names[0]} — plus artists and songs similar to your taste`
                : lastPlayedTitle
                  ? `Built from songs like ${lastPlayedTitle} — plus similar artists`
                  : "Built from your searches — plus similar artists and songs";
        }
      }
      if (recommended.length === 0) {
        // No history yet (or nothing new found): fall back to trending
        // and surface its artists as the similar-artists row.
        recommended = trending.slice(0, 5);
        recommendedBasis = null;
        if (similarArtists.length === 0) {
          const fromTrending = new Map<string, { name: string; thumbnail: string }>();
          for (const t of allSongs) {
            const name = primaryArtist(t.artist);
            const key = name.toLowerCase();
            if (name && !fromTrending.has(key)) {
              fromTrending.set(key, { name, thumbnail: t.thumbnail });
            }
            if (fromTrending.size >= 8) break;
          }
          similarArtists = [...fromTrending.values()];
        }
      }

      // --- New releases: famous English/Hindi artists, or the
      // user's own taste (their artists + similar artists) only ---
      const similarKeys = new Set(similarArtists.map((a) => normName(a.name)));
      const releaseAllowed = (card: Card): boolean => {
        const artists = cardArtists(card);
        if (artists.length === 0) return false;
        const keys = artists.map(normName);
        // The user's taste always passes, any language.
        if (keys.some((k) => ownArtistKeys.has(k) || similarKeys.has(k))) return true;
        // A curated famous English/Hindi artist passes on their own.
        if (keys.some((k) => FAMOUS_ARTIST_KEYS.has(k))) return true;
        // Otherwise the artist must be charting in these same live
        // feeds right now, and the album must be English/Hindi — no
        // other-language script in its title or billing.
        if (hasNonEnHiScript(`${card.title} ${card.subtitle}`)) return false;
        return keys.some((k) => chartArtistKeys.has(k));
      };
      const byYearDesc = (a: Card, b: Card): number => cardYear(b) - cardYear(a);
      let releases = dedupeCards(feedAlbums.filter(releaseAllowed)).sort(byYearDesc).slice(0, 10);
      if (releases.length < 10) {
        // The raw shelf rarely passes, so top up with live album
        // searches: the user's own artists first, then similar
        // artists, then a rotating pick of famous EN/HI artists.
        const rot = Math.floor(Date.now() / 86400000) % FAMOUS_ROTATION.length;
        const rotatedFamous = FAMOUS_ROTATION.map(
          (_, i) => FAMOUS_ROTATION[(rot + i) % FAMOUS_ROTATION.length] as string,
        );
        const searchArtists: string[] = [];
        const seenArtist = new Set<string>();
        for (const a of [
          ...topArtists,
          ...similarArtists.map((s) => s.name),
          ...rotatedFamous,
        ]) {
          const k = normName(a);
          if (!k || seenArtist.has(k)) continue;
          seenArtist.add(k);
          searchArtists.push(a);
        }
        const have = new Set(releases.map((c) => c.id));
        for (let i = 0; i < searchArtists.length && releases.length < 10; i += 4) {
          const batch = searchArtists.slice(i, i + 4);
          const found = await Promise.all(
            batch.map((a) => searchAlbumsByArtist(a).catch(() => [] as Card[])),
          );
          const fresh = dedupeCards(found.flat().filter(releaseAllowed)).filter(
            (c) => !have.has(c.id),
          );
          fresh.sort(byYearDesc);
          for (const c of fresh) {
            if (releases.length >= 10) break;
            have.add(c.id);
            releases.push(c);
          }
        }
        releases.sort(byYearDesc);
      }

      return {
        source: "live",
        trending,
        albums,
        releases,
        playlists,
        recommended,
        recommendedBasis,
        similarArtists,
      };
    },
  },

  getPopular: {
    description:
      "Returns the search tab's ranked Popular Songs — the full YouTube Music chart (up to 100 songs, in chart order, with view counts; the client pages through it 5 at a time) — and Trending Artists: famous English/Hindi artists only (the curated famous EN/HI sets, matched against every billed artist in the live explore/charts/home feeds, topped up with live searches for rotating famous artists when the feeds carry fewer than 6; both languages guaranteed at least 2 of the 6 slots when available). Every returned artist carries a real plays total: summed from their feed songs' view counts, or — when the feed songs carried no counts, as is also the case for top-up artists — from the real per-song play counts in a live song search for that artist. An artist with no derivable real total is omitted, never shown with a placeholder. source 'fallback' means the feeds were unreachable and the client should show an honest retry state, not the starter library.",
    request: z.object({}),
    response: popularResponse,
    async handler(_args: any, _ctx: ActionContext): Promise<z.infer<typeof popularResponse>> {
      const empty: z.infer<typeof popularResponse> = { source: "fallback", songs: [], artists: [] };
      const feedIds = ["FEmusic_explore", "FEmusic_charts", "FEmusic_home"] as const;
      const settled = await Promise.allSettled(feedIds.map((id) => innertubeBrowse(id)));
      const collected: { section: string; song: PopularSong }[] = [];
      let anyLive = false;
      for (const s of settled) {
        if (s.status === "fulfilled") {
          anyLive = true;
          collectPopular(s.value, "", collected);
        }
      }
      if (!anyLive) return empty;
      // Prefer the Trending shelf's own order; otherwise keep the
      // overall feed order. Either way: no shuffle — this is a chart.
      const trendingOnly = collected.filter((c) => /trend/i.test(c.section));
      const ordered = withoutStarters(dedupeTracks((trendingOnly.length >= 5 ? trendingOnly : collected).map((c) => c.song)));
      const playsById = new Map<string, string>();
      for (const c of collected) if (c.song.plays) playsById.set(c.song.videoId, c.song.plays);
      const songs = ordered.slice(0, 100).map((t) => ({ ...t, plays: playsById.get(t.videoId) ?? "" }));
      if (songs.length === 0) return empty;
      // Trending artists: FAMOUS English / Hindi artists only —
      // never whoever happens to top the raw chart (the raw US
      // chart is full of acts the user has never heard of).
      // Candidates come from every song the feeds returned — the
      // chart first, then the rest of the feeds in feed order,
      // where the home feed's shelves are where the Hindi names
      // chart — matched against the same curated famous EN/HI
      // sets the New releases filter uses (any billed artist on
      // a song can qualify it). A card carries the famous name,
      // the artwork of their top song in these feeds, and a
      // plays total summed from the real view counts of their
      // songs here. Artists whose feed songs carried no view
      // counts get their total from a live song search instead
      // (below); an artist with no derivable real total is
      // omitted — a card never shows a placeholder in place of
      // a plays total.
      type ArtistCandidate = { name: string; thumbnail: string; hindi: boolean; totalPlays: number };
      const byVideo = new Map<string, PopularSong>();
      for (const c of collected) if (!byVideo.has(c.song.videoId)) byVideo.set(c.song.videoId, c.song);
      const inChart = new Set(ordered.map((t) => t.videoId));
      const pool: Track[] = [...ordered];
      for (const s of byVideo.values()) if (!inChart.has(s.videoId)) pool.push(s);
      const famousMap = new Map<string, ArtistCandidate>();
      for (const t of pool) {
        const hit = famousBilling(t.artist);
        if (!hit) continue;
        const key = normName(hit.name);
        const plays = parsePlayCount(playsById.get(t.videoId) ?? "");
        const cur = famousMap.get(key);
        if (cur) cur.totalPlays += plays;
        else famousMap.set(key, { name: hit.name, thumbnail: t.thumbnail, hindi: hit.hindi, totalPlays: plays });
      }
      let candidates: ArtistCandidate[] = [...famousMap.values()];
      // Feed songs do not always carry view counts (only chart
      // rows do), so a feed artist can end up with no total.
      // Give each such artist one chance at a real total from a
      // live song search, whose results carry real play counts;
      // anyone still without one is dropped from the row.
      const zeros = candidates.filter((a) => a.totalPlays <= 0);
      if (zeros.length > 0) {
        const fills = await Promise.allSettled(zeros.map((a) => artistSearchTotals(a.name)));
        fills.forEach((r, j) => {
          const cand = zeros[j];
          if (cand && r.status === "fulfilled" && r.value.totalPlays > 0) {
            cand.totalPlays = r.value.totalPlays;
          }
        });
        candidates = candidates.filter((a) => a.totalPlays > 0);
      }
      // Top up from live song searches for a rotating pick of
      // famous EN/HI artists when fewer than 6 famous names carry
      // a real total, so the row is never short and never falls
      // back to random chart acts. Each top-up artist's total is
      // summed from the real play counts in their search results
      // and their artwork is their top billed song's real cover;
      // a name whose search yields no countable plays is skipped
      // and the next rotating name is tried.
      if (candidates.length < 6) {
        const have = new Set(candidates.map((a) => normName(a.name)));
        const rot = Math.floor(Date.now() / 86400000) % FAMOUS_ROTATION.length;
        const rotated = FAMOUS_ROTATION.map((_, i) => FAMOUS_ROTATION[(rot + i) % FAMOUS_ROTATION.length] as string);
        const poolNames = rotated.filter((n) => {
          const k = normName(n);
          return k !== "" && !have.has(k);
        });
        let cursor = 0;
        while (candidates.length < 6 && cursor < poolNames.length) {
          const batch = poolNames.slice(cursor, cursor + (6 - candidates.length) + 2);
          cursor += batch.length;
          const found = await Promise.allSettled(batch.map((n) => artistSearchTotals(n)));
          found.forEach((r, i) => {
            if (candidates.length >= 6) return;
            if (r.status !== "fulfilled" || r.value.totalPlays <= 0 || !r.value.thumbnail) return;
            const name = batch[i] as string;
            candidates.push({
              name,
              thumbnail: r.value.thumbnail,
              hindi: FAMOUS_HINDI_KEYS.has(normName(name)),
              totalPlays: r.value.totalPlays,
            });
          });
        }
      }
      // Pick 6 in feed order, but guarantee both languages a real
      // presence when candidates allow: at least 2 Hindi and at
      // least 2 English slots, swapping the tail of the
      // over-represented side for the next artists of the other.
      // The final order stays feed order.
      const chosen = candidates.slice(0, 6);
      const ensureLanguage = (hindi: boolean) => {
        let have = chosen.filter((a) => a.hindi === hindi).length;
        for (const cand of candidates) {
          if (have >= 2) break;
          if (cand.hindi !== hindi || chosen.includes(cand)) continue;
          const swapIdx = chosen.map((a, idx) => (a.hindi !== hindi ? idx : -1)).filter((idx) => idx >= 0).pop();
          if (swapIdx === undefined) break;
          chosen[swapIdx] = cand;
          have++;
        }
      };
      ensureLanguage(true);
      ensureLanguage(false);
      const artists = candidates
        .filter((a) => chosen.includes(a))
        .map((a) => ({ name: a.name, thumbnail: a.thumbnail, plays: formatPlayCount(a.totalPlays) }))
        // Belt and braces: an artist with no real plays total
        // never reaches the client.
        .filter((a) => a.plays !== "");
      return { source: "live", songs, artists };
    },
  },


  getSpeedDial: {
    description:
      "Returns the Speed Dial carousel: exactly 20 songs the USER has actually played, built only from their own listening_history and Liked Songs — never generic trending, never starter songs, never live-search discoveries. The first 10 are their most-played songs ranked by play count; the other 10 are a random pick (shuffled per request nonce) from the rest of what they have listened to (played or liked), excluding the top 10, with no duplicates. If the user has fewer than 20 distinct listened songs, the dial honestly returns only what exists; source 'fallback' with an empty list means they have no plays or likes yet and the client shows an honest empty state.",
    request: z.object({ nonce: z.number().int().min(0).max(1000000000).optional() }),
    response: z.object({
      source: z.enum(["live", "fallback"]),
      tracks: z.array(trackSchema),
    }),
    async handler(args: any, ctx: ActionContext): Promise<{ source: "live" | "fallback"; tracks: Track[] }> {
      const db = ctx.db;
      let historyRows: (typeof schema.listeningHistory.$inferSelect)[] = [];
      let likedRows: (typeof schema.likedTracks.$inferSelect)[] = [];
      try {
        historyRows = await db
          .select()
          .from(schema.listeningHistory)
          .where(eq(schema.listeningHistory.deviceId, ctx.deviceId))
          .orderBy(desc(schema.listeningHistory.id))
          .limit(1000);
        likedRows = await db.select().from(schema.likedTracks).where(eq(schema.likedTracks.deviceId, ctx.deviceId));
      } catch {
        /* no history yet — Speed Dial stays honestly empty */
      }
      const likedById = new Map(likedRows.map((l) => [l.videoId, l]));

      // Every distinct song the user has listened to: play counts
      // from listening_history, plus their Liked Songs. Only these
      // songs may appear in the dial — nothing is fetched live.
      const heard = new Map<string, { title: string; artist: string; plays: number }>();
      const note = (videoId: string, title: string, artist: string, plays: number) => {
        if (!videoId) return;
        const cur = heard.get(videoId);
        if (cur) {
          cur.plays += plays;
          if (!cur.title && title) cur.title = title;
          if (!cur.artist && artist) cur.artist = artist;
        } else {
          heard.set(videoId, { title, artist, plays });
        }
      };
      for (const r of historyRows) {
        if (r.kind === "play" || r.kind === "like") {
          note(r.videoId, r.title, r.artist, r.kind === "play" ? 1 : 0);
        }
      }
      for (const l of likedRows) note(l.videoId, l.title, l.artist, 0);

      const toTrack = (videoId: string, title: string, artist: string): Track => {
        const liked = likedById.get(videoId);
        return {
          videoId,
          title: liked?.title || title,
          artist: liked?.artist || artist,
          album: liked?.album ?? "",
          duration: liked?.duration ?? "",
          thumbnail: liked?.thumbnail || thumb(videoId),
        };
      };

      // Top 10 — the user's most-played songs, ranked by play
      // count (ties: more total history entries first is already
      // encoded in the count; stable order keeps it honest).
      const ranked = [...heard.entries()].sort((a, b) => b[1].plays - a[1].plays);
      const top = ranked.slice(0, 10);
      const topIds = new Set(top.map(([id]) => id));

      // Random 10 — a shuffle of everything else they have
      // listened to, seeded by the request nonce so each Refresh
      // tap (and each fresh mount) produces a visibly new pick.
      const rest = ranked.filter(([id]) => !topIds.has(id)).map(([id]) => id);
      let seed = (args.nonce ?? 0) * 2654435761 + 97;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = rest[i] as string;
        rest[i] = rest[j] as string;
        rest[j] = tmp;
      }
      const randomPick = rest.slice(0, 10);

      const tracks = [...top.map(([id, s]) => toTrack(id, s.title, s.artist)),
        ...randomPick.map((id) => {
          const s = heard.get(id) as { title: string; artist: string; plays: number };
          return toTrack(id, s.title, s.artist);
        })];
      if (tracks.length === 0) return { source: "fallback", tracks: [] };
      return { source: "live", tracks };
    },
  },

  getSimilarQueue: {
    description:
      "Builds the radio queue that follows a song the user played on its own (a single tap, a shuffle pick, a Speed Dial / hero / search pick — not a playlist): songs similar to that seed song, never the remaining search results in order. Order: the user's own Liked Songs by the same artist, then more songs by the seed artist live from YouTube Music, then songs by similar artists (artists who keep appearing across the seed artist's search results), with a per-artist cap so nobody floods the queue. The removed starter songs are excluded. An empty list means nothing similar could be found and the client falls back to the tapped list.",
    request: z.object({ track: trackInputSchema }),
    response: similarQueueResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof similarQueueResponse>> {
      const seed = args.track;
      const seedArtist = primaryArtist(seed.artist).trim();
      // Discovery tiers never queue karaoke / backing-track /
      // slowed-sped remix uploads — they flood song-title searches
      // and are not "similar songs" in any useful sense. (The
      // user's own Liked Songs tier is exempt: those are theirs.)
      const isJunk = (t: Track): boolean =>
        /karaoke|backing track|made popular by|originally perfom|in the style of|slowed|sped up|nightcore|8-bit|reverb/i.test(
          t.title,
        ) || /karaoke/i.test(t.artist);
      const byArtist = (t: Track, artist: string): boolean => {
        const a = normName(primaryArtist(t.artist));
        const b = normName(artist);
        return a !== "" && b !== "" && (a === b || a.includes(b) || b.includes(a));
      };

      const out: Track[] = [];
      const inOut = new Set<string>([seed.videoId]);
      const perArtist = new Map<string, number>();
      const push = (t: Track, cap: number) => {
        if (out.length >= 15 || inOut.has(t.videoId) || isStarterTrack(t)) return;
        const key = normName(primaryArtist(t.artist));
        if ((perArtist.get(key) ?? 0) >= cap) return;
        perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
        inOut.add(t.videoId);
        out.push(t);
      };

      // Tier 0 — the user's own Liked Songs by the seed artist:
      // similar by definition, and already theirs.
      if (seedArtist) {
        try {
          const db = ctx.db;
          const likedRows = await db
            .select()
            .from(schema.likedTracks)
            .where(eq(schema.likedTracks.deviceId, ctx.deviceId))
            .orderBy(desc(schema.likedTracks.addedAt));
          for (const l of likedRows) {
            if (!byArtist(l, seedArtist)) continue;
            push(
              {
                videoId: l.videoId,
                title: l.title,
                artist: l.artist,
                album: l.album,
                duration: l.duration,
                thumbnail: l.thumbnail,
              },
              3,
            );
            if (out.length >= 3) break;
          }
        } catch {
          /* likes are a bonus tier — never break the radio */
        }
      }

      // Tier 1 — live searches around the seed: the artist, the
      // song itself, and the artist's songs. Songs actually BY the
      // seed artist go first.
      const queries = seedArtist
        ? [seedArtist, `${seed.title} ${seedArtist}`, `${seedArtist} songs`]
        : [seed.title];
      // A radio queue never repeats the seed song itself — not
      // another upload of it, and not a cover / remix version of
      // it by somebody else (those flood the song-title search).
      const seedBase = baseTitle(seed.title);
      const notSameSong = (t: Track): boolean => baseTitle(t.title) !== seedBase;
      const stage1 = (
        await Promise.all(
          queries.map((q) => searchYouTubeMusic(q).catch(() => [] as Track[])),
        )
      ).map((list) => list.filter((t) => !isJunk(t) && notSameSong(t)));
      const sameArtist = dedupeTracks(stage1.flat()).filter(
        (t) => !seedArtist || byArtist(t, seedArtist),
      );
      for (const t of sameArtist) push(t, 6);

      // Tier 2 — similar artists: artists who keep appearing across
      // the seed searches without being the seed artist, ranked by
      // cross-search frequency (the same derivation the home feed
      // and Speed Dial use), then their own songs.
      if (out.length < 15) {
        const seedKey = normName(seedArtist);
        const simScores = new Map<string, { name: string; score: number }>();
        for (const list of stage1) {
          const counted = new Set<string>();
          for (const t of list) {
            const name = primaryArtist(t.artist).trim();
            const key = normName(name);
            if (!name || !key || key === seedKey || counted.has(key)) continue;
            counted.add(key);
            const cur = simScores.get(key);
            if (cur) cur.score += 1;
            else simScores.set(key, { name, score: 1 });
          }
        }
        // Only artists surfacing across at least two of the seed
        // searches count as similar — a one-off appearance is
        // usually a compilation / remix channel, not a neighbour.
        const simArtists = [...simScores.values()]
          .filter((s) => s.score >= 2)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        if (simArtists.length > 0) {
          const stage2 = (
            await Promise.all(
              simArtists.map((s) => searchYouTubeMusic(s.name).catch(() => [] as Track[])),
            )
          ).map((list) => list.filter((t) => !isJunk(t) && notSameSong(t)));
          const perSource = stage2.map((list, i) => {
            const s = simArtists[i];
            return s ? list.filter((t) => byArtist(t, s.name)) : [];
          });
          let added = true;
          for (let round = 0; added && out.length < 15; round++) {
            added = false;
            for (const list of perSource) {
              const t = list[round];
              if (t) {
                const before = out.length;
                push(t, 3);
                if (out.length > before) added = true;
              }
            }
          }
        }
      }

      // Tier 3 — the last gaps fill from the ARTIST searches only
      // (same genre / language neighbourhood). The song-title
      // search is deliberately not a fill source: what it mostly
      // holds beyond the seed artist is covers and remixes.
      if (out.length < 15) {
        const artistLists = [stage1[0] ?? [], stage1[2] ?? []];
        for (const t of dedupeTracks(artistLists.flat())) push(t, 3);
      }

      return {
        tracks: out,
        basis:
          out.length > 0
            ? seedArtist
              ? `Similar to ${seed.title} — more from ${seedArtist} and artists like them`
              : `Similar to ${seed.title}`
            : null,
      };
    },
  },

  getMoreSimilarSongs: {
    description:
      "Fetches up to 10 NEW songs similar to the currently playing song for the Queue view's 'Add more similar songs' button: same artist, similar artists and the same genre/language neighbourhood, live from YouTube Music. Every videoId and every same-title/same-artist copy already in the caller's queue (queue tracks are passed in full) and the playing song itself are excluded, duplicates are removed, and karaoke / remix / cover / backing-track versions are filtered out. The client appends the result at the end of its queue; the playing song and existing order are never touched by this action.",
    request: z.object({
      track: trackInputSchema,
      queue: z.array(trackInputSchema).max(300),
    }),
    response: moreSimilarResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof moreSimilarResponse>> {
      const seed = args.track;
      const seedArtist = primaryArtist(seed.artist).trim();
      const TARGET = 10;

      // Exclusion sets built from the FULL queue the client passes:
      // videoIds (exact copies) plus title+artist keys (the same
      // song under a different upload) plus the seed's base title
      // alone (any cover of the playing song, by anyone).
      const excludeIds = new Set<string>([seed.videoId]);
      const excludeKeys = new Set<string>();
      const keyOf = (t: Track): string =>
        `${baseTitle(t.title)}|${normName(primaryArtist(t.artist))}`;
      excludeKeys.add(keyOf(seed));
      for (const q of args.queue) {
        excludeIds.add(q.videoId);
        excludeKeys.add(keyOf(q));
      }
      const seedBase = baseTitle(seed.title);

      const isJunk = (t: Track): boolean =>
        /karaoke|remix|cover|backing track|made popular by|originally performed|in the style of|slowed|sped up|nightcore|8-bit|reverb|tribute/i.test(
          t.title,
        ) || /karaoke|tribute/i.test(t.artist);
      const byArtist = (t: Track, artist: string): boolean => {
        const a = normName(primaryArtist(t.artist));
        const b = normName(artist);
        return a !== "" && b !== "" && (a === b || a.includes(b) || b.includes(a));
      };
      // A candidate is usable only when it is genuinely new: not an
      // excluded id, not the same song under another upload, not a
      // cover of the seed song, and not a junk version.
      const isNew = (t: Track): boolean =>
        !excludeIds.has(t.videoId) &&
        !excludeKeys.has(keyOf(t)) &&
        baseTitle(t.title) !== seedBase &&
        !isJunk(t) &&
        !isStarterTrack(t);

      const out: Track[] = [];
      const inOut = new Set<string>();
      const inOutKeys = new Set<string>();
      const perArtist = new Map<string, number>();
      const push = (t: Track, cap: number): boolean => {
        if (out.length >= TARGET) return false;
        if (!isNew(t) || inOut.has(t.videoId) || inOutKeys.has(keyOf(t))) return false;
        const key = normName(primaryArtist(t.artist));
        if ((perArtist.get(key) ?? 0) >= cap) return false;
        perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
        inOut.add(t.videoId);
        inOutKeys.add(keyOf(t));
        out.push(t);
        return true;
      };

      // Tier 0 — the user's own Liked Songs by the seed artist that
      // are not already queued: similar by definition, already theirs.
      if (seedArtist) {
        try {
          const db = ctx.db;
          const likedRows = await db
            .select()
            .from(schema.likedTracks)
            .where(eq(schema.likedTracks.deviceId, ctx.deviceId))
            .orderBy(desc(schema.likedTracks.addedAt));
          for (const l of likedRows) {
            const t: Track = {
              videoId: l.videoId,
              title: l.title,
              artist: l.artist,
              album: l.album,
              duration: l.duration,
              thumbnail: l.thumbnail,
            };
            if (!byArtist(t, seedArtist)) continue;
            // Liked songs are exempt from the junk filter (they are
            // the user's own picks) but never from the exclusion sets.
            if (excludeIds.has(t.videoId) || excludeKeys.has(keyOf(t))) continue;
            if (out.length >= TARGET || inOut.has(t.videoId)) continue;
            const key = normName(primaryArtist(t.artist));
            if ((perArtist.get(key) ?? 0) >= 3) continue;
            perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
            inOut.add(t.videoId);
            inOutKeys.add(keyOf(t));
            out.push(t);
            if (out.length >= 3) break;
          }
        } catch {
          /* likes are a bonus tier — never break the fetch */
        }
      }

      // Tier 1 — live searches around the seed artist with varied
      // phrasings, because each phrasing returns a different slice
      // of the artist's catalogue — essential when the queue
      // already holds the obvious top results (the screenshot case:
      // eight songs by the same artist already queued).
      const queries = seedArtist
        ? [
            seedArtist,
            `${seedArtist} songs`,
            `${seedArtist} hits`,
            `${seed.title} ${seedArtist}`,
            `${seedArtist} popular songs`,
            `best of ${seedArtist}`,
          ]
        : [seed.title, `${seed.title} songs`];
      const stage1 = (
        await Promise.all(
          queries.map((q) => searchYouTubeMusic(q).catch(() => [] as Track[])),
        )
      ).map((list) => list.filter(isNew));
      const sameArtist = dedupeTracks(stage1.flat()).filter(
        (t) => !seedArtist || byArtist(t, seedArtist),
      );
      for (const t of sameArtist) {
        push(t, 7);
        if (out.length >= TARGET) break;
      }

      // Tier 2 — similar artists: artists who keep appearing across
      // the seed searches without being the seed artist, ranked by
      // cross-search frequency, then their own songs round-robin.
      if (out.length < TARGET) {
        const seedKey = normName(seedArtist);
        const simScores = new Map<string, { name: string; score: number }>();
        for (const list of stage1) {
          const counted = new Set<string>();
          for (const t of list) {
            const name = primaryArtist(t.artist).trim();
            const key = normName(name);
            if (!name || !key || key === seedKey || counted.has(key)) continue;
            counted.add(key);
            const cur = simScores.get(key);
            if (cur) cur.score += 1;
            else simScores.set(key, { name, score: 1 });
          }
        }
        let simArtists = [...simScores.values()]
          .filter((s) => s.score >= 2)
          .sort((a, b) => b.score - a.score)
          .slice(0, 4);
        if (simArtists.length === 0) {
          simArtists = [...simScores.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
        }
        if (simArtists.length > 0) {
          const stage2 = (
            await Promise.all(
              simArtists.flatMap((s) => [
                searchYouTubeMusic(s.name).catch(() => [] as Track[]),
                searchYouTubeMusic(`${s.name} songs`).catch(() => [] as Track[]),
              ]),
            )
          ).map((list) => list.filter(isNew));
          // stage2 is [artist0, artist0-songs, artist1, artist1-songs, …]
          const perSource: Track[][] = simArtists.map((s, i) => {
            const merged = dedupeTracks([
              ...(stage2[i * 2] ?? []),
              ...(stage2[i * 2 + 1] ?? []),
            ]);
            return merged.filter((t) => byArtist(t, s.name));
          });
          let added = true;
          for (let round = 0; added && out.length < TARGET; round++) {
            added = false;
            for (const list of perSource) {
              const t = list[round];
              if (t && push(t, 4)) added = true;
            }
          }
        }
      }

      // Tier 3 — fill from every seed search result (same genre /
      // language neighbourhood), per-artist capped.
      if (out.length < TARGET) {
        for (const t of dedupeTracks(stage1.flat())) {
          push(t, 3);
          if (out.length >= TARGET) break;
        }
      }

      // Tier 4 — last resort: broader phrasings that surface songs
      // the direct artist searches missed.
      if (out.length < TARGET && seedArtist) {
        const extraQueries = [
          `songs like ${seed.title} ${seedArtist}`,
          `${seedArtist} album songs`,
        ];
        const extra = (
          await Promise.all(
            extraQueries.map((q) => searchYouTubeMusic(q).catch(() => [] as Track[])),
          )
        ).map((list) => list.filter(isNew));
        for (const t of dedupeTracks(extra.flat())) {
          push(t, 4);
          if (out.length >= TARGET) break;
        }
      }

      return {
        tracks: out.slice(0, TARGET),
        basis:
          out.length > 0
            ? seedArtist
              ? `10 more like ${seed.title} — ${seedArtist} and similar artists`
              : `More like ${seed.title}`
            : null,
      };
    },
  },

  getProfile: {
    description:
      "Returns the user's My Profile: display name, bio, and avatar URL (null until they set one). The row is created with the default name 'user' on first read.",
    request: z.object({}),
    response: z.object({
      displayName: z.string(),
      bio: z.string(),
      avatarUrl: z.string().nullable(),
    }),
    async handler(_args: any, ctx: ActionContext) {
      const db = ctx.db;
      const rows = await db.select().from(schema.profile).where(eq(schema.profile.deviceId, ctx.deviceId));
      let row = rows[0];
      if (!row) {
        await db.insert(schema.profile).values({ deviceId: ctx.deviceId, displayName: "user", bio: "" });
        const again = await db.select().from(schema.profile).where(eq(schema.profile.deviceId, ctx.deviceId));
        row = again[0];
      }
      return {
        displayName: row?.displayName ?? "user",
        bio: row?.bio ?? "",
        avatarUrl: row?.avatarBlobKey ? await ctx.blobs.getUrl(row.avatarBlobKey) : null,
      };
    },
  },

  updateProfile: {
    description: "Saves the user's editable profile bio. The display name is NOT stored here — it lives only on the user's own device (localStorage, default 'user'); displayName is still accepted for compatibility but is ignored.",
    request: z.object({
      displayName: z.string().trim().min(1).max(40),
      bio: z.string().trim().max(160),
    }),
    response: okResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db;
      const rows = await db.select().from(schema.profile).where(eq(schema.profile.deviceId, ctx.deviceId));
      if (rows.length === 0) {
        await db.insert(schema.profile).values({ deviceId: ctx.deviceId, displayName: "user", bio: args.bio });
      } else {
        await db
          .update(schema.profile)
          .set({ bio: args.bio, updatedAt: new Date() })
          .where(eq(schema.profile.deviceId, ctx.deviceId));
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  },

  setAvatar: {
    description:
      "Stores a new profile avatar image (sent downscaled by the client as base64) as an owned blob and points the profile at it.",
    request: z.object({
      dataBase64: z.string().min(10).max(700000),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    }),
    response: z.object({ avatarUrl: z.string().nullable() }),
    async handler(args: any, ctx: ActionContext) {
      const bytes = Buffer.from(args.dataBase64, "base64");
      if (!imageBytesMatchMime(bytes, args.mimeType)) {
        throw new Error("That file isn't a valid image of the chosen type. Pick a JPEG, PNG or WebP photo.");
      }
      const key = `profile/${ctx.deviceId}/avatar`;
      await ctx.blobs.put(key, bytes, args.mimeType);
      const db = ctx.db;
      const rows = await db.select().from(schema.profile).where(eq(schema.profile.deviceId, ctx.deviceId));
      if (rows.length === 0) {
        await db.insert(schema.profile).values({ deviceId: ctx.deviceId, displayName: "user", bio: "", avatarBlobKey: key });
      } else {
        await db
          .update(schema.profile)
          .set({ avatarBlobKey: key, updatedAt: new Date() })
          .where(eq(schema.profile.deviceId, ctx.deviceId));
      }
      ctx.invalidateQueries();
      return { avatarUrl: await ctx.blobs.getUrl(key) };
    },
  },

  getWallpaper: {
    description:
      "Returns the user's chosen app wallpaper: kind 'url' with the image link they pasted, kind 'upload' with a URL for the image they uploaded from their device, or kind 'none' for the default dark background.",
    request: z.object({}),
    response: z.object({
      kind: z.enum(["none", "url", "upload"]),
      url: z.string().nullable(),
    }),
    async handler(_args: any, ctx: ActionContext) {
      const db = ctx.db;
      const rows = await db.select().from(schema.profile).where(eq(schema.profile.deviceId, ctx.deviceId));
      const row = rows[0];
      if (row?.wallpaperBlobKey) {
        return { kind: "upload" as const, url: await ctx.blobs.getUrl(row.wallpaperBlobKey) };
      }
      if (row?.wallpaperUrl) {
        return { kind: "url" as const, url: row.wallpaperUrl };
      }
      return { kind: "none" as const, url: null };
    },
  },

  setWallpaperUrl: {
    description:
      "Sets the app wallpaper from an image link the user pasted. Clears any uploaded wallpaper image.",
    request: z.object({
      url: z
        .string()
        .trim()
        .url()
        .max(2000)
        // The link is rendered as an <img> source: only web URLs may
        // be stored, never javascript: / data: / file: style values.
        .refine(
          (u) => {
            try {
              const p = new URL(u).protocol;
              return p === "https:" || p === "http:";
            } catch {
              return false;
            }
          },
          { message: "Wallpaper link must be an http(s) image URL." },
        ),
    }),
    response: okResponse,
    async handler(args: any, ctx: ActionContext): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db;
      const rows = await db.select().from(schema.profile).where(eq(schema.profile.deviceId, ctx.deviceId));
      if (rows.length === 0) {
        await db
          .insert(schema.profile)
          .values({ deviceId: ctx.deviceId, displayName: "user", bio: "", wallpaperUrl: args.url, wallpaperBlobKey: null });
      } else {
        await db
          .update(schema.profile)
          .set({ wallpaperUrl: args.url, wallpaperBlobKey: null, updatedAt: new Date() })
          .where(eq(schema.profile.deviceId, ctx.deviceId));
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  },

  setWallpaperImage: {
    description:
      "Stores a wallpaper image the user uploaded from their own device (sent downscaled by the client as base64) as an owned blob and makes it the app wallpaper. Clears any pasted wallpaper link.",
    request: z.object({
      dataBase64: z.string().min(10).max(4000000),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    }),
    response: z.object({ wallpaperUrl: z.string().nullable() }),
    async handler(args: any, ctx: ActionContext) {
      const bytes = Buffer.from(args.dataBase64, "base64");
      if (!imageBytesMatchMime(bytes, args.mimeType)) {
        throw new Error("That file isn't a valid image of the chosen type. Pick a JPEG, PNG or WebP photo.");
      }
      const key = `wallpaper/${ctx.deviceId}/image`;
      await ctx.blobs.put(key, bytes, args.mimeType);
      const db = ctx.db;
      const rows = await db.select().from(schema.profile).where(eq(schema.profile.deviceId, ctx.deviceId));
      if (rows.length === 0) {
        await db
          .insert(schema.profile)
          .values({ deviceId: ctx.deviceId, displayName: "user", bio: "", wallpaperUrl: null, wallpaperBlobKey: key });
      } else {
        await db
          .update(schema.profile)
          .set({ wallpaperUrl: null, wallpaperBlobKey: key, updatedAt: new Date() })
          .where(eq(schema.profile.deviceId, ctx.deviceId));
      }
      ctx.invalidateQueries();
      return { wallpaperUrl: await ctx.blobs.getUrl(key) };
    },
  },

  resetWallpaper: {
    description: "Clears the user's wallpaper choice, back to the default restrained dark background.",
    request: z.object({}),
    response: okResponse,
    async handler(_args: any, ctx: ActionContext): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db;
      await db
        .update(schema.profile)
        .set({ wallpaperUrl: null, wallpaperBlobKey: null, updatedAt: new Date() })
        .where(eq(schema.profile.deviceId, ctx.deviceId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  },

  getProfileStats: {
    description:
      "Computes My Profile stats from the user's real listening_history play rows since startMs (a client-computed window start: today / this week / this month / this semester): total listened seconds (summed song lengths of recorded plays), distinct songs, distinct artists, most listened artist, ranked most listened songs with play counts and minutes, and most listened artists. Small histories return honestly small numbers.",
    request: z.object({ startMs: z.number().int().min(0) }),
    response: z.object({
      totalListenedSec: z.number(),
      totalPlays: z.number(),
      distinctSongs: z.number(),
      distinctArtists: z.number(),
      likedCount: z.number(),
      mostArtist: z
        .object({ name: z.string(), plays: z.number(), thumbnail: z.string() })
        .nullable(),
      topSongs: z.array(
        z.object({
          videoId: z.string(),
          title: z.string(),
          artist: z.string(),
          album: z.string(),
          duration: z.string(),
          thumbnail: z.string(),
          plays: z.number(),
          minutes: z.number(),
        }),
      ),
      topArtists: z.array(
        z.object({ name: z.string(), plays: z.number(), thumbnail: z.string() }),
      ),
    }),
    async handler(args: any, ctx: ActionContext) {
      const db = ctx.db;
      const since = new Date(args.startMs);
      const allPlays = await db
        .select()
        .from(schema.listeningHistory)
        .where(eq(schema.listeningHistory.deviceId, ctx.deviceId))
        .orderBy(desc(schema.listeningHistory.id))
        .limit(5000);
      const plays = allPlays.filter((r) => r.kind === "play" && r.createdAt >= since && r.videoId);
      const likedRows = await db.select().from(schema.likedTracks).where(eq(schema.likedTracks.deviceId, ctx.deviceId));
      const likedById = new Map(likedRows.map((l) => [l.videoId, l]));

      let totalListenedSec = 0;
      const songMap = new Map<
        string,
        { videoId: string; title: string; artist: string; plays: number; sec: number }
      >();
      const artistMap = new Map<string, { name: string; plays: number; topVideoId: string }>();
      for (const r of plays) {
        const sec = r.durationSec || parseDurationSec(likedById.get(r.videoId)?.duration ?? "");
        totalListenedSec += sec;
        const s = songMap.get(r.videoId);
        if (s) {
          s.plays += 1;
          s.sec += sec;
        } else {
          songMap.set(r.videoId, { videoId: r.videoId, title: r.title, artist: r.artist, plays: 1, sec });
        }
        const name = primaryArtist(r.artist);
        if (name) {
          const a = artistMap.get(name.toLowerCase());
          if (a) a.plays += 1;
          else artistMap.set(name.toLowerCase(), { name, plays: 1, topVideoId: r.videoId });
        }
      }
      const topSongs = [...songMap.values()]
        .sort((a, b) => b.plays - a.plays || b.sec - a.sec)
        .slice(0, 8)
        .map((s) => {
          const liked = likedById.get(s.videoId);
          return {
            videoId: s.videoId,
            title: s.title,
            artist: s.artist,
            album: liked?.album ?? "",
            duration: liked?.duration ?? "",
            thumbnail: liked?.thumbnail || thumb(s.videoId),
            plays: s.plays,
            minutes: Math.round(s.sec / 60),
          };
        });
      const topArtists = [...artistMap.values()]
        .sort((a, b) => b.plays - a.plays)
        .slice(0, 8)
        .map((a) => ({
          name: a.name,
          plays: a.plays,
          thumbnail: likedById.get(a.topVideoId)?.thumbnail || thumb(a.topVideoId),
        }));
      return {
        totalListenedSec,
        totalPlays: plays.length,
        distinctSongs: songMap.size,
        distinctArtists: artistMap.size,
        likedCount: likedRows.length,
        mostArtist: topArtists[0] ?? null,
        topSongs,
        topArtists,
      };
    },
  },

  getCollection: {
    description:
      "Opens a YouTube Music album or playlist card: browses its page and returns its real track list.",
    request: z.object({ browseId: z.string().trim().min(3).max(120) }),
    response: collectionResponse,
    async handler(args: any, _ctx: ActionContext): Promise<z.infer<typeof collectionResponse>> {
      try {
        const data = await innertubeBrowse(args.browseId);
        let title = "";
        let subtitle = "";
        const headers: Json[] = [];
        const collectHeaders = (node: unknown): void => {
          if (Array.isArray(node)) {
            for (const v of node) collectHeaders(v);
            return;
          }
          const obj = asObj(node);
          if (!obj) return;
          const h = asObj(obj["musicResponsiveHeaderRenderer"]) ?? asObj(obj["musicDetailHeaderRenderer"]);
          if (h) headers.push(h);
          for (const v of Object.values(obj)) collectHeaders(v);
        };
        collectHeaders(data);
        const h = headers[0];
        let description = "";
        if (h) {
          title = headerText(h["title"]).trim();
          subtitle = headerText(h["subtitle"]).trim();
          description = headerText(h["secondSubtitle"]).trim();
        }
        const sections: FeedSections = { songs: [], cards: [] };
        collectFeed(data, "", sections);
        return {
          title: title || "Collection",
          subtitle,
          description,
          tracks: dedupeTracks(sections.songs.map((s) => s.track)),
          error: null,
        };
      } catch (e) {
        return {
          title: "",
          subtitle: "",
          description: "",
          tracks: [],
          error: e instanceof Error ? e.message : "This collection could not be loaded.",
        };
      }
    },
  },

  submitFeedback: {
    description:
      "Sends one About-page feedback note to the creator's email via Web3Forms. The Web3Forms access key lives ONLY here on the server — it is never shipped in the client bundle, where anyone could extract it and spam the form or impersonate the app. No sender email is collected or sent; the message is all that goes out. A short cooldown between sends keeps a stuck or scripted caller from flooding the inbox.",
    request: z.object({ message: z.string().trim().min(1).max(2000) }),
    response: feedbackResponse,
    async handler(args: any, _ctx: ActionContext): Promise<z.infer<typeof feedbackResponse>> {
      // No key configured (e.g. local dev without env) - fail closed
      // without calling Web3Forms and without claiming the cooldown slot.
      if (!WEB3FORMS_ACCESS_KEY) {
        return { ok: false };
      }
      const now = Date.now();
      if (now - lastFeedbackAtMs < FEEDBACK_COOLDOWN_MS) {
        return { ok: false };
      }
      // Claim the slot before the network call so concurrent sends
      // cannot slip past the cooldown together.
      lastFeedbackAtMs = now;
      try {
        const res = await fetchUpstream("https://api.web3forms.com/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            access_key: WEB3FORMS_ACCESS_KEY,
            subject: "New Frostora Feedback",
            message: args.message,
          }),
        });
        const data: unknown = await res.json().catch(() => null);
        const ok =
          res.ok &&
          typeof data === "object" &&
          data !== null &&
          (data as { success?: unknown }).success === true;
        return { ok };
      } catch {
        return { ok: false };
      }
    },
  },
};

/** Map of action name -> handler function type. The client derives
 *  response types from these, e.g. `Awaited<ReturnType<Actions["getLibrary"]>>`. */
export type Actions = {
  [K in keyof typeof Actions]: (typeof Actions)[K]["handler"];
};
