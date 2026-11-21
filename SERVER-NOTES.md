# Frostora server — standalone port notes

Ported 22 Nov 2026 from the Muse fullstack artifact `liquid-metal-music`
(`server/src/actions.ts`, 4,003 lines, 29 actions). The source was ported
mechanically (scripted transform with per-replacement hit-count asserts),
not retyped: all handler logic, comments, validation caps, timeouts,
in-memory caches, `STARTER_*` exclusion filters, famous-artist rules and
the feedback 10 s cooldown are unchanged. Only the Muse wrapper, the
secret, and the data scoping changed — see "What changed vs the original".

## Layout (this port)

```
frostora-github/
├── server/src/
│   ├── actions.ts   # the 29 actions as a plain registry (ported)
│   ├── schema.ts    # Drizzle schema + device_id columns
│   ├── db.ts        # libsql client (file DB or Turso) + migrate()
│   ├── blobs.ts     # blob abstraction (Vercel Blob or local uploads/)
│   ├── handler.ts   # POST /api/actions dispatcher
│   └── index.ts     # Express dev server
├── drizzle/
│   ├── 0001-0007*.sql        # copied unchanged from the Muse artifact
│   ├── 0008_device_scoping.sql
│   └── meta/_journal.json    # 0008 entry appended
└── SERVER-NOTES.md  # this file
```

The root `package.json`, `client/`, `vercel.json` and `api/` belong to the
integrator (see PORTING-PLAN.md §6) and are deliberately not created here.

## Dependencies

Install in the repo root (the integrator's `package.json`):

| Package | Why |
| --- | --- |
| `drizzle-orm` | Queries + migrations (same version family as the artifact, 0.45.x) |
| `@libsql/client` | SQLite driver: local file DBs and Turso |
| `zod` | Request/response schemas (was re-exported by the Muse SDK; now direct) |
| `express` | Dev server only (`server/src/index.ts`); works with v4 and v5 |
| `@vercel/blob` | Avatar/wallpaper storage when `BLOB_READ_WRITE_TOKEN` is set |
| `@types/express`, `@types/node` | Dev-only types (`typescript` itself is also needed to build) |

No other runtime dependencies. Upstream calls (YouTube Music InnerTube,
LRCLib, SponsorBlock, Spotify embed pages) are plain `fetch` and need
nothing extra.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `file:./frostora.db` for local dev; `libsql://<db>.turso.io` for Turso |
| `DATABASE_AUTH_TOKEN` | Turso only | Turso auth token. Missing with a non-`file:` URL fails fast at startup |
| `WEB3FORMS_ACCESS_KEY` | for Feedback | Was a hardcoded literal in the Muse source; now env-only. When unset, `submitFeedback` returns `{ ok: false }` without calling Web3Forms |
| `BLOB_READ_WRITE_TOKEN` | for Vercel Blob | When unset, uploads go to a local `uploads/` dir (never committed) |
| `BLOB_LOCAL_DIR` | no | Overrides the local uploads dir (default `<cwd>/uploads`) |
| `MIGRATIONS_DIR` | no | Overrides migration-folder discovery (default: `<cwd>/drizzle`, else `server/../../drizzle` relative to the module) |
| `PORT` | no | Dev server port (default `3000`) |

`.env.example` (in the repo scaffold) lists the names only — never put a
real value in git. `.gitignore` already excludes `.env*`, `*.db`, `blobs/`,
`uploads/`, `node_modules/`, `dist/`.

## Running locally

```sh
npm install
DATABASE_URL=file:./frostora.db PORT=3000 npx tsx server/src/index.ts
# or, once built:  DATABASE_URL=file:./frostora.db node server/dist/index.js
```

On startup the server creates the file DB if needed and applies
`drizzle/0001-0008` automatically (local file DBs only). Then:

- `POST /api/actions` with `{ "action": "listLiked", "args": {}, "deviceId": "device-<random>" }`
- `GET /api/blobs/<key>` serves locally stored uploads.
- If `client/dist` exists it is served statically with an SPA fallback;
  otherwise the server answers API-only on `/`.

## Migrations on Turso

`migrate()` deliberately does **not** auto-migrate a remote database:
auto-migrating shared production data on every server start is how a bad
deploy locks or corrupts it. Apply migrations explicitly instead, e.g.:

```sh
# Option A — drizzle-kit (from the repo root, with DATABASE_URL/AUTH set):
npx drizzle-kit migrate

# Option B — the Turso CLI, file by file in order (0001 -> 0008):
turso db shell <db-name> < drizzle/0001_initial.sql
# ... repeat through 0008_device_scoping.sql
```

`drizzle/meta/_journal.json` lists all eight migrations in order, so
drizzle-kit picks them up. Verify with
`turso db shell <db-name> "SELECT * FROM __drizzle_migrations;"` —
expect 8 rows. Fresh Turso databases start empty; the old Muse `app.db`
was **never copied** (personal data: liked tracks + listening history).

## Device scoping (the auth replacement)

The Muse app was private to one user, so it had no auth and one shared
library. A public host needs *some* isolation, and the port uses
per-device scoping instead of accounts:

- The client generates one random `deviceId` per device (persist it in
  `localStorage`, e.g. `crypto.randomUUID()`), and sends it with every
  `/api/actions` call. Valid shape: 8–64 chars, `[A-Za-z0-9_-]`
  (enforced in `handler.ts`; anything else is a 400).
- Every user-data table has a `device_id TEXT NOT NULL DEFAULT ''`
  column, and every DB read/write in every handler filters by
  `ctx.deviceId` (selects add `.where(eq(table.deviceId, deviceId))`,
  combined with existing conditions via `and()`; inserts set it;
  deletes filter by it).
- Handlers that are purely upstream (`getLyrics`, `getOfficialVideo`,
  `getLibrary`, `getCollection`, `previewPlaylistImport`) need no
  filter; `searchMusic`'s history insert is device-scoped.
- `profile` is one row per device, queried by `device_id`. The old
  fixed `id: 1` is gone — two devices inserting `id: 1` would have
  collided on the primary key. The `id` column stays (auto rowid) but
  nothing queries by it.
- Blob keys are namespaced per device (`profile/<deviceId>/avatar`,
  `wallpaper/<deviceId>/image`) so devices cannot overwrite each
  other's avatar/wallpaper. The DB stores only the key, as before.
- The starter-hygiene logic in `listLiked` (delete un-evidenced starter
  likes) stays, and is device-scoped: it only ever deletes the
  caller's own rows.

**Honest limitation:** a `deviceId` is self-asserted, not authenticated.
Anyone can mint one and get their own empty library — that is the
point — but anyone who *knows* another device's id can read/write that
device's library. Do not treat device ids as secrets or as access
control; if real accounts are ever needed, add auth in front of
`/api/actions` and map the account to the device scope.

## What changed vs the original (and why)

1. **Muse SDK removed.** The old import pulled `zod` plus the
   action-wrapper helpers and their types from the Muse SDK package;
   now `zod` comes from npm directly and the wrapper is gone. Each
   old wrapped entry (`name` + description + request + response +
   `handler(ctx, args)`) is now a plain registry record
   `name: { description, request, response, handler }` with
   `handler(args, ctx)` — a plain async function. `ctx.db<typeof
   schema>()` → `ctx.db` (a `LibSQLDatabase` passed in `ActionContext`);
   `ctx.invalidateQueries()` is a no-op (the client invalidates its
   own queries — see PORTING-PLAN.md §2); `ctx.blobs.put(key, bytes,
   { contentType })` → `blobs.put(key, bytes, contentType)`.
   `export type Actions` maps each action name to its handler function
   type, so the client can derive response types, e.g.
   `Awaited<ReturnType<Actions["getLibrary"]>>`.
2. **Web3Forms key moved to env.** Was a hardcoded literal in
   `actions.ts`; now `process.env.WEB3FORMS_ACCESS_KEY ?? ""`, and
   `submitFeedback` returns `{ ok: false }` without calling Web3Forms
   when it is empty. The key value appears nowhere in this repo.
3. **Device scoping added** (above), including the composite primary
   keys below.
4. **`liked_tracks` PK is now composite `(device_id, video_id)`.**
   The old PK (`video_id` alone) would collide across devices.
   Migration 0008 rebuilds the table SQLite-safely (new table, copy,
   drop, rename).
5. **`hidden_playlists` PK is now composite `(device_id,
   playlist_id)`.** Same reasoning as (4): the old PK (`playlist_id`
   alone) would make `hidePlaylist` throw a unique-constraint error
   for a second device hiding the same feed playlist. This was not
   spelled out in the brief, which only named `liked_tracks`, but it
   is the identical collision — flagging it here deliberately.
6. **Blob backend is pluggable.** `blobs.ts` picks Vercel Blob when
   `BLOB_READ_WRITE_TOKEN` is set (lazy `@vercel/blob` import, so a
   local-only checkout never needs the package) and a local `uploads/`
   dir otherwise, served at `/api/blobs/<key>`. The JPEG/PNG/WebP
   magic-byte check still lives in `actions.ts`, unchanged, and the
   dev server sniffs magic bytes again when serving.
7. **New files:** `db.ts` (libsql + `migrate()`), `blobs.ts`,
   `handler.ts` (device-id validation, zod arg/response checks,
   unknown action / bad args → `Error`, mapped to HTTP 400 by
   `index.ts`), `index.ts` (Express dev server).
8. **Imports use explicit `.js` extensions** (`./schema.js` etc.) —
   the standard ESM TypeScript convention; resolves under `tsx` and
   in compiled output.

Nothing else changed. In particular: no logic, caps, timeouts, caches,
or copy was altered; `getPopular`/`getHomeFeed`/`getSpeedDial` keep
their famous-artist and starter-exclusion rules.

## Verification done in this port (22 Nov 2026)

- `tsc --noEmit` (strict, TypeScript 7.0.2) passes on all of
  `server/src` — including the `.js`-extension imports.
- Migration test on a throwaway local SQLite file (never the real
  `app.db`): applied 0001–0007, seeded one row per table, applied
  0008 — all rows preserved, all six tables gained `device_id`,
  `liked_tracks` PK is `(device_id, video_id)`, `hidden_playlists`
  PK is `(device_id, playlist_id)`, same-device duplicate like
  rejected, cross-device same-video like accepted,
  `PRAGMA integrity_check` = ok.
- Live smoke test of the compiled server (temp file DB, auto-migrate
  on startup, 8 rows in `__drizzle_migrations`): `toggleLike` /
  `listLiked` / `recordPlay` / `getSpeedDial` / `createPlaylist` /
  `listUserPlaylists` / `getProfile` / `updateProfile` /
  `getProfileStats` / `setAvatar` (1×1 PNG round-trips through
  `/api/blobs/` as `image/png`; non-image bytes rejected with the
  original error) all behaved per-device — device B saw an empty
  library/stats while device A saw its own data. `submitFeedback`
  with no key returned `{ ok: false }` without a network call.
  Unknown action / bad `deviceId` / bad args all returned HTTP 400
  with a clear message.
- Grep checks on the ported tree: no references to the Muse SDK
  package or its action-wrapper helpers remain (0 hits); `web3forms`
  appears only as the service name in carried-over comments, the
  env-var name, and the `https://api.web3forms.com/submit` URL
  (no key value anywhere).

## Not verified here (integrator / Naman to check)

- Live upstream behaviour end-to-end (YouTube Music search/browse,
  LRCLib lyrics, SponsorBlock segments, Spotify playlist import) was
  not exercised against the real upstreams in this pass — the code is
  byte-identical to the Muse version, but the network path from the
  new host (Vercel / local) is unproven.
- Turso as a live backend (migrations were tested on local SQLite
  only; the SQL is the same dialect, but no Turso database was
  provisioned in this pass).
- Vercel Blob as a live backend (local `uploads/` mode was tested;
  the `@vercel/blob` path typechecks but was not run against a real
  store — it needs `BLOB_READ_WRITE_TOKEN`).
- The client (`api.ts` fetch client + `deviceId` generation) is the
  integrator's work; the server contract it must follow is:
  `POST /api/actions { action, args, deviceId }` → action result or
  `{ "error": "..." }`, and `GET /api/blobs/<key>` for uploads.
