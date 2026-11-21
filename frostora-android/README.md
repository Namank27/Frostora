# Frostora — Android APK build

Phone-first music app (Frostora) wrapped as an installable Android APK using
**Capacitor 7** (a WebView shell around the deployed web app).

## Status (22 Nov 2026)

**No APK has been built yet — one input is still missing, and it is not optional:**

Frostora is now a standalone app in this repo (see the repo root
`README.md`), but it is **not deployed to a public HTTPS URL yet**. A
WebView wrapper can only load the app from a **reachable public HTTPS
URL**. Pointing the wrapper at a placeholder URL would produce an APK
that opens an empty page — that is not Frostora, so no such APK was
built. Deploy the repo to Vercel first, then build the APK from that
URL (locally with `./build-apk.sh`, or via the GitHub Actions workflow
in `.github/workflows/android-apk.yml`, which needs the `FROSTORA_URL`
repository secret).

### What is already done in this folder

- Capacitor 7 project (`@capacitor/core` + `@capacitor/cli` 7.6.10, Node 24)
- `capacitor.config.ts` — appId `com.frostora.app`, appName `Frostora`,
  `server.url` from `FROSTORA_URL`, `allowNavigation` for YouTube /
  Google Video / thumbnail hosts and Web3Forms, `allowMixedContent` on
  (YouTube playback), dark splash `#0B0B0D`
- Launcher + adaptive icons generated from the crystal icon
  (`assets/icon/`, 1600×1600 source → mdpi–xxxhdpi, 512px store icon,
  adaptive foreground on charcoal `#0B0B0D` background)
- `www/index.html` — minimal loader page used only if no URL is configured
- `build-apk.sh` — one-command build (see below)

### Toolchain installed in this VM (verified 21 Nov 2026)

- OpenJDK 17.0.21 (`/usr/lib/jvm/java-17-openjdk-amd64`)
- Android SDK at `~/Android/Sdk`: cmdline-tools, platform-tools (adb 1.0.41),
  platforms `android-34` + `android-35`, build-tools `34.0.0` + `35.0.0`,
  licences accepted
- Gradle 8.11.1 at `/opt/gradle/gradle-8.11.1` (system install — the wrapper's
  own download cannot use this VM's egress proxy, so `build-apk.sh` uses the
  system Gradle; proxy settings are derived from the environment at runtime
  and Java trusts the egress CA via `~/.gradle/frostora-cacerts`)
- Note: `/tmp` here is a 512 MB tmpfs — download large SDK zips to
  `~/Downloads`, not `/tmp`

## The one remaining step before building

Deploy Frostora to a public HTTPS host **with its server + database intact**
(e.g. Vercel, Netlify, Fly.io, a VPS — the app needs its server actions for
likes, history, playlists, search and feedback). Then:

```bash
export FROSTORA_URL="https://your-deployed-frostora-url"
./build-apk.sh
```

The script will:

1. Verify `FROSTORA_URL` is set and is a real `https://` URL (refuses placeholders)
2. Install the Android SDK pieces if missing
3. `npx cap add android` (first run) / `npx cap sync android`
4. Copy the crystal icons into the Android `mipmap-*` folders and set the
   adaptive icon
5. Patch `AndroidManifest.xml` (INTERNET, network state, media-playback
   foreground service) and `MainActivity` (WebView: DOM storage on, media
   playback without a user gesture, mixed content allowed)
6. Run `./gradlew assembleDebug`

## Output

Debug APK (sideloading, **not** Play Store signed):

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Install on the phone with `adb install app-debug.apk`, or copy the file to the
phone and tap it (allow "Install unknown apps" for the file manager / browser).

## After the debug APK works

- Test on the phone: login-free playback, background audio, lock-screen
  controls, playlist import, feedback pill, wallpaper upload.
- For a Play Store release later: create a **release keystore**
  (`keytool -genkeypair`), build `assembleRelease`, sign + zipalign it, and
  upload an AAB — do not reuse the debug key for release.
- The Web3Forms access key is held server-side by the app (it was removed
  from the web client in the final security pass), so nothing secret ships in
  the APK beyond what the web app already exposes.

## Troubleshooting

### Gradle fails with "Could not receive a message from the daemon"

This VM's sandbox blocks direct TCP connections (`other_tcp` permission is
Deny): the Gradle client talks to its daemon over loopback TCP, and the
sandbox intercepts that stream, so the daemon starts but the client can never
send it a command. Verified 21 Nov 2026 with a minimal Java loopback test —
the sandbox itself replies that other TCP is turned off. Fix: in Muse
settings → Permissions → Direct network protocols, switch `other_tcp` from
Deny to Ask (or build on a normal machine / CI instead — GitHub Actions with
`android-actions/setup-android` is the simplest path once the app is on
GitHub). No code change in this project can work around it.

### sdkmanager fails with a proxy / tunneling exception

Java cannot use this VM's egress proxy on its own. `build-apk.sh` works
around it by downloading SDK packages with `curl` and by deriving Gradle's
proxy settings from the environment at runtime.

## Why not a TWA / Bubblewrap instead?

A Trusted Web Activity needs the same public HTTPS URL **plus** a
`assetlinks.json` on that domain proving ownership. Once Frostora is deployed,
TWA is a valid alternative (smaller APK, Chrome-powered), but Capacitor was
chosen first because it works with any host, keeps the app working offline
with its loader page, and gives a native shell for media controls later.
