# Frostora

Phone-first music app that streams full songs live from YouTube Music —
search any song and play it in full, nothing stored as audio. Frosted
white/grey glass theme, crystal icon (faceted ice crystal with a sound
wave inside), Speed Dial of 20 songs, karaoke lyrics, official music
videos, playlist import from YouTube / YouTube Music / Spotify links,
and a Feedback pill on the About page that emails the creator via
Web3Forms.

Created by Naman. Ported 22 Nov 2026 from the Muse fullstack artifact
`liquid-metal-music` (v52) to this standalone repo — see
[`PORTING-PLAN.md`](PORTING-PLAN.md), [`SERVER-NOTES.md`](SERVER-NOTES.md)
and [`CLIENT-NOTES.md`](CLIENT-NOTES.md). Behaviour, theme and features
are unchanged from the live Muse app.

## Layout

```
frostora/
├── client/            # Vite + React 19 + Tailwind 4 (the app UI)
├── server/            # API layer: the 29 actions as HTTP handlers
│   └── src/           # actions.ts, schema.ts, db.ts, blobs.ts, handler.ts, index.ts
├── api/               # Vercel serverless entries (POST /api/actions, GET /api/blobs/*)
├── drizzle/           # 0001–0008 migrations (SQLite / Turso)
├── frostora-android/  # Capacitor 7 wrapper for the Android APK
├── .github/workflows/android-apk.yml
├── .env.example
├── vercel.json
└── package.json       # npm workspaces: client + server
```

## Run locally

```sh
npm install
cp .env.example .env   # then fill in DATABASE_URL (see below)
npm run build          # builds client + server
npm start              # serves the app + API on http://localhost:3000
```

Or run the two parts separately (two terminals):

```sh
npm run dev:server     # Express API on :3000 (tsx watch)
npm run dev:client     # Vite dev server, /api proxied to :3000
```

The API is a single endpoint: `POST /api/actions` with
`{ "action": "<one of the 29>", "args": {...}, "deviceId": "<8-64 chars>" }`.
The client generates a random device ID once and stores it in
`localStorage` under `frostora-device-id`.

## Environment variables

Copy `.env.example` to `.env` locally, or set them in Vercel →
Settings → Environment Variables. Never commit a filled-in `.env`.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `file:./frostora.db` for local dev, or `libsql://…` for Turso |
| `DATABASE_AUTH_TOKEN` | Turso only | Turso auth token |
| `WEB3FORMS_ACCESS_KEY` | for Feedback | Feedback pill key. When unset, `submitFeedback` returns `{ok:false}` and sends nothing. Never put it in source code. |
| `BLOB_READ_WRITE_TOKEN` | for Vercel Blob | Avatar/wallpaper uploads. When unset, uploads go to a local `uploads/` dir (dev only, never committed). |
| `PORT` | no | Dev server port (default `3000`) |

## Deploy to Vercel

1. Push this repo to GitHub (`Namank27/Frostora`, `main`).
2. In Vercel: **Add New → Project → Import** the repo. Framework
   preset: **Vite**. `vercel.json` already sets the build command
   (`npm run build`) and output directory (`client/dist`); the API
   lives in `api/` as serverless functions.
3. Set the environment variables above in Vercel (at minimum
   `DATABASE_URL` + `DATABASE_AUTH_TOKEN` for Turso, and
   `WEB3FORMS_ACCESS_KEY` + `BLOB_READ_WRITE_TOKEN` for Feedback and
   uploads).
4. Apply the database migrations to Turso **explicitly** (the server
   never auto-migrates a remote DB):
   ```sh
   npx drizzle-kit migrate   # with DATABASE_URL / DATABASE_AUTH_TOKEN set
   ```
   Expect 8 rows in `__drizzle_migrations` (0001–0008).
5. Deploy. The public URL (e.g. `https://frostora.vercel.app`) is the
   URL the Android APK wrapper needs.

## Per-device scoping (no login — read this)

The Muse app was private to one user, so it had no accounts. This port
keeps that: there is **no login**. Instead, every device gets a random
device ID, and likes, listening history, playlists, profile and
wallpaper are scoped to that device (`device_id` column on every
user-data table, migration `0008`). Two devices never see each other's
library.

Honest limitation: a device ID is self-asserted, not authentication.
Anyone who knows the URL gets their own separate library — which is
the point — but anyone can mint a device ID, and there is no way to
recover a library if the device ID is lost (e.g. clearing browser
data). Do not treat this as account security.

## Build the Android APK

The Capacitor 7 wrapper is in `frostora-android/` (appId
`com.frostora.app`, crystal launcher icons). It needs the **deployed**
public URL — do not point it at a placeholder.

Locally:
```sh
export FROSTORA_URL="https://your-deployed-frostora-url"
cd frostora-android && ./build-apk.sh
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Or via GitHub Actions (`.github/workflows/android-apk.yml`): Actions →
Run workflow. It needs the `FROSTORA_URL` repository secret set to the
deployed URL, and uploads the debug APK as a workflow artifact.
Do not build the APK in the Muse VM — its sandbox blocks the Gradle
daemon's loopback TCP.

## Verification (22 Nov 2026, this port)

- `npm run typecheck` — client + server, 0 errors. `npm run build` —
  exit 0 (client Vite bundle + server `tsc`).
- Live smoke test of the built server (temp local DB): `getLibrary`,
  `toggleLike`/`listLiked`, `createPlaylist`/`listUserPlaylists`,
  `getProfile`/`updateProfile` all behaved **per-device** (device B
  saw an empty library/profile while device A saw its own);
  `submitFeedback` with no key returns `{ok:false}` without calling
  Web3Forms; unknown action / bad deviceId / bad args → HTTP 400;
  client `dist/index.html` served (HTTP 200).
- Live upstream calls worked here: `searchMusic` "Kesariya" returned
  real YouTube Music results (Arijit Singh, first result
  `NJAv_7lHUIU`), `getLyrics` "Blinding Lights" returned synced
  karaoke lines from LRCLib.
- Secret grep: the Web3Forms key value appears **nowhere** in this
  repo (only the env-var name and the `api.web3forms.com/submit` URL);
  `@hatch` / `space-sdk` / `defineAction` appear nowhere in code
  (one mention in a comment in `client/src/actions.ts` explaining the
  typing mirror). No `app.db`, `blobs/` or personal data was copied.
- Not verified here: Turso as a live backend, Vercel Blob against a
  real store, the Vercel deployment itself, YouTube playback on a
  phone, and the GitHub Actions APK build — all need the deploy step
  above first.
