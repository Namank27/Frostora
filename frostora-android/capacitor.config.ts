import type { CapacitorConfig } from '@capacitor/cli';

// Frostora is the standalone app in this repo (see the repo root
// README.md). It has NO public URL until it is deployed (e.g. to
// Vercel). A WebView wrapper can only load the app from a reachable
// HTTPS URL, so before building the APK:
//
//   1. Deploy this repo to a public HTTPS host (Vercel), keeping its
//      server + database (see repo root README.md).
//   2. Put that URL in FROSTORA_URL below (or export it as FROSTORA_URL
//      when running the build script).
//   3. Run:  ./build-apk.sh
//
// Do NOT build a "Frostora APK" pointing at a placeholder URL — it
// would open an empty page, not the app.

const FROSTORA_URL =
  process.env.FROSTORA_URL || 'https://REPLACE-WITH-DEPLOYED-FROSTORA-URL';

const config: CapacitorConfig = {
  appId: 'com.frostora.app',
  appName: 'Frostora',
  webDir: 'www',
  // Load the live deployed app in the WebView. The app streams YouTube Music,
  // so the WebView must stay online and keep media playing.
  server: {
    url: FROSTORA_URL,
    cleartext: false,
    // Allow the app to navigate to YouTube / Google auth + media hosts.
    allowNavigation: [
      'youtube.com',
      'www.youtube.com',
      'music.youtube.com',
      'youtu.be',
      'googlevideo.com',
      '*.googlevideo.com',
      'yt3.ggpht.com',
      'i.ytimg.com',
      'api.web3forms.com',
    ],
  },
  android: {
    // YouTube playback must keep working when the screen locks / app backgrounds
    // is handled by the web app's Media Session; the WebView must not require a
    // tap for every media start.
    allowMixedContent: true,
  },
  plugins: {
    // Keep the splash minimal and dark, matching Frostora (#0B0B0D).
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0B0B0D',
      showSpinner: false,
    },
  },
};

export default config;
