# Frostora — porting plan: Muse fullstack artifact → standalone GitHub repo

Prepared 22 Nov 2026. Source of truth for the current app: Muse
fullstack artifact `liquid-metal-music`, v52 (finalised 21 Nov 2026).

## 1. Where the source is — and why it was not copied

- Live source on disk: `~/workspace/ts-spaces/liquid-metal-music/`
  - `client/src/App.tsx` — 8,326 lines (whole UI)
  - `client/src/theme.css` — 1,497 lines
  - `server/src/actions.ts` — 4,003 lines, **29 actions**
  - `server/src/schema.ts` — Drizzle SQLite schema (6 tables)
  - `drizzle/0001–0007` — migrations
  - `client/src/assets/frostora-icon.webp` — crystal icon
  - `package.json` — Bun 1.3.10, React 19, Tailwind 4, Drizzle 0.45.2
- It was **not** copied into `frostora-github/` because:
  - `~/workspace/ts-spaces/liquid-metal-music/AGENTS.md` says: build,
    audit and ship only through the web-artifact tools; do not build
    from this directory and do not hand-edit it.
  - `artifact.export` refuses this artifact (fullstack, "bun-space-manifest-v1"):
    *"its behavior lives outside the page, so it cannot be exported to
    one .html file"* — and `share` can give a public link only to an
    artifact with no server actions.
  - A verbatim copy would leak a secret (see §4) and would not run
    outside Muse (see §2).

## 2. What is Muse-locked (must be replaced in the port)

| Muse piece | Where | Standalone replacement (suggested) |
| --- | --- | --- |
| `@hatch/space-sdk` (`file:/opt/hatch/.../space-sdk.tgz`, not on npm) | `server/src/actions.ts`, `client/src/api.ts`, `client/src/main.tsx`, `client/src/App.tsx` | Remove entirely |
| `defineAction({ request, response, handler })` + `ActionsModule` | all 29 server actions | A thin HTTP layer: `POST /api/actions` with `{ action, args }`, zod-validated, returning the same typed responses. Vercel serverless functions, or a small Express/Hono server |
| `ctx.db<typeof schema>()` (Drizzle over Muse-managed libsql) | every DB action | Drizzle + a real libsql host — **Turso** is the closest fit (same SQLite dialect, same migrations in `drizzle/`) |
| `ctx.blobs.put/getUrl` (avatar + wallpaper uploads) | `setAvatar`, `setWallpaperImage`, `getProfile`, `getWallpaper` | Vercel Blob / S3-compatible storage; store only the key/URL in the DB, as today |
| `ctx.invalidateQueries()` | after every mutation | Client-side React Query invalidation on mutation success |
| `createActionClient` / `spaceQueryClient` | `client/src/api.ts`, `client/src/main.tsx` | A small `fetch`-based typed client posting to `/api/actions`; keep the same `api.<action>(args)` call shape so `App.tsx` barely changes |
| `SafeAreaTopScrim` | `client/src/App.tsx` | A plain CSS safe-area scrim / `env(safe-area-inset-top)` |
| `actionFields` macro (`@hatch/space-sdk/fields`) | `client/src/App.tsx` | Remove; inline the fields it generated (check what it expands to during the port) |
| `space.json` / `bunfig.toml` / Bun build scripts | repo root, `client/build.mjs` | Standard Vite config (`vite.config.ts`); `npm run dev/build/preview`. Keep Tailwind 4 + React 19 |
| `app.db` (Muse-managed SQLite file) | `ts-spaces/liquid-metal-music/app.db` | **Never copy.** Fresh DB on Turso; run `drizzle/0001–0007` migrations there. The user's liked songs/history stay in Muse unless he explicitly exports them |

## 3. The 29 server actions (all must survive the port)

From `server/src/actions.ts` (`export const Actions`):

`getLibrary`, `searchMusic`, `listLiked`, `getLyrics`, `getOfficialVideo`,
`toggleLike`, `recordPlay`, `hidePlaylist`, `previewPlaylistImport`,
`importPlaylist`, `createPlaylist`, `listUserPlaylists`, `getUserPlaylist`,
`deleteUserPlaylist`, `getHomeFeed`, `getPopular`, `getSpeedDial`,
`getSimilarQueue`, `getMoreSimilarSongs`, `getProfile`, `updateProfile`,
`setAvatar`, `getWallpaper`, `setWallpaperUrl`, `setWallpaperImage`,
`resetWallpaper`, `getProfileStats`, `getCollection`, `submitFeedback`.

Notes for the porter:
- Upstream calls are plain `fetch` with a hard timeout (`fetchUpstream`):
  YouTube Music InnerTube, LRCLib lyrics, SponsorBlock, Spotify embed
  pages (for playlist import). No Muse-only networking — these work
  from any server.
- `getPopular` / `getHomeFeed` / `getSpeedDial` carry the curated
  famous-artist rules and the starter-song exclusion filter
  (`STARTER_VIDEO_IDS` / `STARTER_TITLE_ARTISTS`) — keep both, they are
  user decisions.
- `importPlaylist` resolves Spotify tracks to YouTube Music tracks
  server-side; keep that logic intact.
- Validation caps from the security pass must be kept: request-side
  track fields capped (videoId ≤ 64, titles/artists ≤ 500, etc.),
  feedback message 1–2000 chars with a 10-second cooldown, wallpaper
  URLs http/https only, uploads verified as real JPEG/PNG/WebP bytes.
- No auth exists in the app today (single-user, no login). On a public
  host that means **anyone with the URL shares one library** unless the
  porter adds auth or per-device scoping. Flag this to Naman before
  deploying publicly — it is the biggest behaviour change of leaving
  Muse, where the app was private to him.

## 4. Secrets — what must never be in git

- **Web3Forms access key**: currently a hardcoded literal in
  `server/src/actions.ts` (~line 1864, `WEB3FORMS_ACCESS_KEY`). It is
  safe in Muse (never in the client bundle) but **must be replaced with
  `process.env.WEB3FORMS_ACCESS_KEY`** (or the port's env system)
  before any public push. The key value itself is NOT written anywhere
  in this scaffold — set it in Vercel env vars / GitHub secrets.
- No other keys were found in `client/src` or `server/src` (grep for the
  key returns exactly 1 hit, server-only). Re-grep before pushing.
- `.env.example` lists the names only. `.gitignore` excludes `.env*`,
  `*.db`, `blobs/`, `node_modules/`, `dist/`, Android `build/`.

## 5. Data that must never be copied

- `app.db` — Naman's liked tracks + listening history (168 history rows
  at last check). Personal data; never in git, never in a public repo.
- `blobs/` — uploaded avatar/wallpaper bytes.
- `audits/`, `.harness/`, `.space-build/`, `.bun-cache/`, `node_modules/`,
  `client/dist/`, `server/dist/` — build/audit artefacts, not source.

## 6. Suggested repo layout after the port

```
frostora/
├── client/            # Vite + React 19 + Tailwind 4 (from client/src)
│   ├── src/           # App.tsx, theme.css, components, lib, assets
│   └── index.html
├── server/            # API layer (the 29 actions as HTTP handlers)
│   └── src/actions.ts # ported, space-sdk imports removed
├── drizzle/           # 0001–0007 migrations (unchanged)
├── frostora-android/  # Capacitor 7 wrapper (copy from workspace/frostora-android)
├── .github/workflows/android-apk.yml   # already in this scaffold
├── .env.example       # already in this scaffold
├── .gitignore         # already in this scaffold
├── vercel.json        # to be written by the port (rewrites /api/*)
├── package.json       # single root package (npm, not Bun-only)
└── README.md          # this scaffold's README, updated with run instructions
```

## 7. Verification checklist (before calling the port done)

- [ ] `npm install && npm run build` passes from a clean checkout
- [ ] No secret in git history: `git grep -i "access_key"` returns
      nothing; `.env` files untracked
- [ ] App boots on Vercel preview URL; Home feed, Search (Popular
      Songs pager, Trending Artists), Library, playlist import
      (YouTube + Spotify), player, lyrics, Feedback pill all work
- [ ] Feedback sends to Naman's email (test message) with no key in
      the client bundle (check built JS)
- [ ] Likes/history persist across reloads (Turso wired, not in-memory)
- [ ] Avatar/wallpaper upload + display work
- [ ] Phone viewport: no horizontal overflow, sticky playlist top bar,
      remove-dialog anchored to the held card
- [ ] APK: GitHub Actions workflow builds `app-debug.apk` from the
      deployed URL and it installs + plays on Naman's phone

## 8. Exact next step

Ask the artifact builder (the agent that owns `liquid-metal-music`) to
produce the standalone port described above — or authorise a dedicated
porting pass with this file as its brief. Do **not** ask it to "copy the
source to GitHub": the copy is the easy part and the wrong one. The work
is the space-sdk replacement in §2, the secret move in §4, and the
public-host auth decision in §3.
