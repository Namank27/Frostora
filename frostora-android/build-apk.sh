#!/usr/bin/env bash
# Frostora — build a debug APK (sideloading) via Capacitor.
# Usage:
#   export FROSTORA_URL="https://your-deployed-frostora-url"
#   ./build-apk.sh
# Output: android/app/build/outputs/apk/debug/app-debug.apk
set -euo pipefail
cd "$(dirname "$0")"

# --- 1. Deployed URL is mandatory -------------------------------------------
if [[ -z "${FROSTORA_URL:-}" ]]; then
  echo "ERROR: FROSTORA_URL is not set."
  echo "Deploy Frostora to a public HTTPS host first, then:"
  echo "  export FROSTORA_URL=\"https://your-deployed-frostora-url\""
  echo "  ./build-apk.sh"
  exit 1
fi
if [[ "$FROSTORA_URL" != https://* ]] || [[ "$FROSTORA_URL" == *REPLACE-WITH* ]]; then
  echo "ERROR: FROSTORA_URL must be a real https:// URL, got: $FROSTORA_URL"
  exit 1
fi
echo "Frostora URL: $FROSTORA_URL"

# --- 2. JDK ------------------------------------------------------------------
if ! command -v java >/dev/null 2>&1; then
  echo "Installing OpenJDK 17..."
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-17-jdk-headless
fi
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$JAVA_HOME/bin:$PATH"
java -version 2>&1 | head -1

# --- 3. Android SDK ----------------------------------------------------------
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
if [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
  echo "Installing Android SDK command-line tools..."
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  cd /tmp
  curl -sSL -o cmdline-tools.zip \
    https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q -o cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  cd - >/dev/null
fi
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" >/dev/null
# NOTE: sdkmanager talks to Google through Java, which cannot use this VM's
# egress proxy on its own. If the line above fails, the script's fallback
# below downloads the same packages with curl (which does use the proxy).
if [[ ! -f "$ANDROID_HOME/platforms/android-35/android.jar" ]]; then
  echo "sdkmanager could not reach Google; downloading SDK packages with curl..."
  cd /tmp
  curl -sSL -o platform35.zip https://dl.google.com/android/repository/platform-35-ext15_r01.zip
  curl -sSL -o build-tools35.zip https://dl.google.com/android/repository/build-tools_r35_linux.zip
  curl -sSL -o platform-tools.zip https://dl.google.com/android/repository/platform-tools-latest-linux.zip
  unzip -q -o platform35.zip -d "$ANDROID_HOME/platforms/" && mv "$ANDROID_HOME/platforms/android-35-ext15" "$ANDROID_HOME/platforms/android-35"
  unzip -q -o build-tools35.zip -d "$ANDROID_HOME/build-tools/"
  unzip -q -o platform-tools.zip -d "$ANDROID_HOME/"
  cd - >/dev/null
fi
# Accept SDK licences (hashes are the standard public licence texts)
mkdir -p "$ANDROID_HOME/licenses"
printf '8933bad161af4178b1185d1a37fbf41ea5269c55\nd56f5187479451eabf01fb78af6dfcb131a6481e\n24333f8a63b6825a656882fa2f249289860b56a9' > "$ANDROID_HOME/licenses/android-sdk-license"
printf '84831b9409646a918e30573bab4c9c66' > "$ANDROID_HOME/licenses/android-sdk-preview-license"
# Gradle (system install avoids the wrapper's own Java download, which hits
# the same proxy problem). Installed once via curl:
#   curl -sSL -o gradle-8.11.1-bin.zip https://services.gradle.org/distributions/gradle-8.11.1-bin.zip
#   sudo unzip -q gradle-8.11.1-bin.zip -d /opt/gradle
GRADLE_BIN="${GRADLE_BIN:-/opt/gradle/gradle-8.11.1/bin/gradle}"
if [[ ! -x "$GRADLE_BIN" ]]; then GRADLE_BIN="./gradlew"; fi

# --- 4. Capacitor project ----------------------------------------------------
cd "$(dirname "$0")"
if [[ ! -d android ]]; then
  echo "Adding Android platform..."
  npx cap add android
fi
echo "Syncing web assets + config..."
npx cap sync android

# --- 5. Icons (crystal icon -> mipmap) ---------------------------------------
python3 - <<'PY'
import os, shutil, glob
src = "assets/icon"; res = "android/app/src/main/res"
mapping = {
    "ic_launcher_mdpi.png": "mipmap-mdpi/ic_launcher.png",
    "ic_launcher_hdpi.png": "mipmap-hdpi/ic_launcher.png",
    "ic_launcher_xhdpi.png": "mipmap-xhdpi/ic_launcher.png",
    "ic_launcher_xxhdpi.png": "mipmap-xxhdpi/ic_launcher.png",
    "ic_launcher_xxxhdpi.png": "mipmap-xxxhdpi/ic_launcher.png",
    "ic_launcher_foreground.png": "mipmap-xxxhdpi/ic_launcher_foreground.png",
    "ic_launcher_background.png": "mipmap-xxxhdpi/ic_launcher_background.png",
}
for s, d in mapping.items():
    p = os.path.join(res, d); os.makedirs(os.path.dirname(p), exist_ok=True)
    shutil.copy(os.path.join(src, s), p)
# Round launcher icon must be the crystal too (template ships a default one),
# and the adaptive-icon foreground must be the crystal PNG, not the template's
# default vector. Copy the foreground + round icon into every density.
for dens in ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]:
    shutil.copy(os.path.join(src, f"ic_launcher_{dens}.png"),
                os.path.join(res, f"mipmap-{dens}", "ic_launcher_round.png"))
    shutil.copy(os.path.join(src, "ic_launcher_foreground.png"),
                os.path.join(res, f"mipmap-{dens}", "ic_launcher_foreground.png"))
vec = os.path.join(res, "drawable-v24", "ic_launcher_foreground.xml")
if os.path.exists(vec): os.remove(vec)
print("icons copied")
PY

# --- 6. Manifest + MainActivity hardening ------------------------------------
MANIFEST="android/app/src/main/AndroidManifest.xml"
python3 - "$MANIFEST" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
for perm in [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.WAKE_LOCK",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    # v1.0.1: the background-audio service posts its Now Playing
    # notification through this (Android 13+).
    "android.permission.POST_NOTIFICATIONS",
]:
    if perm not in s:
        s = s.replace("<application", f'    <uses-permission android:name="{perm}" />\n    <application', 1)
# v1.0.1: declare the background-audio foreground service (media
# playback type) if it is not already in the manifest.
if "MediaPlaybackService" not in s:
    s = s.replace(
        "        </activity>",
        '        </activity>\n\n'
        '        <service android:name=".MediaPlaybackService"\n'
        '            android:exported="false"\n'
        '            android:foregroundServiceType="mediaPlayback" />',
        1,
    )
open(p, "w").write(s)
print("manifest permissions ok")
PY

MAIN=$(find android/app/src/main -name MainActivity.* | head -1)
echo "MainActivity: $MAIN"
# Capacitor generates a one-line MainActivity with no onCreate, so write the
# full file: same class, plus WebView settings for YouTube playback, the
# FrostoraAudio plugin registration (v1.0.1, BEFORE super.onCreate —
# registerPlugin only adds to the bridge builder) and the
# POST_NOTIFICATIONS runtime request for the background-audio service.
cat > "$MAIN" <<'JAVA'
package com.frostora.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(FrostoraAudioPlugin.class);
        super.onCreate(savedInstanceState);
        // Frostora streams YouTube Music: allow media without a tap.
        android.webkit.WebSettings ws = this.bridge.getWebView().getSettings();
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setDomStorageEnabled(true);
        ws.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // v1.0.1: the background-audio foreground service shows its
        // Now Playing notification through this permission (Android 13+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATION_PERMISSION_REQUEST);
        }
    }
}
JAVA
echo "MainActivity WebView settings patched"

# --- 7. Build -----------------------------------------------------------------
# Gradle downloads its plugins through Java, which cannot use this VM's egress
# proxy on its own. Derive the proxy from the environment at runtime (nothing
# is hard-coded here) and point Java at a truststore built from the egress CA
# bundle, if one exists.
if [[ -n "${https_proxy:-}" ]]; then
  _p="${https_proxy#*://}"; _auth="${_p%%@*}"; _hp="${_p#*@}"
  _ph="${_hp%%:*}"; _pp="${_hp##*:}"; _pu="${_auth%%:*}"; _pw="${_auth#*:}"
  export GRADLE_OPTS="${GRADLE_OPTS:-} -Dhttps.proxyHost=$_ph -Dhttps.proxyPort=$_pp -Dhttps.proxyUser=$_pu -Dhttps.proxyPassword=$_pw -Dhttp.proxyHost=$_ph -Dhttp.proxyPort=$_pp -Dhttp.proxyUser=$_pu -Dhttp.proxyPassword=$_pw -Dhttp.nonProxyHosts=localhost|127.0.0.1"
fi
if [[ -f "$HOME/.gradle/frostora-cacerts" ]]; then
  export GRADLE_OPTS="$GRADLE_OPTS -Djavax.net.ssl.trustStore=$HOME/.gradle/frostora-cacerts -Djavax.net.ssl.trustStorePassword=changeit"
fi
cd android
"$GRADLE_BIN" assembleDebug --no-daemon -q
APK="app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "BUILD OK: $(pwd)/$APK"
ls -lh "$APK"
