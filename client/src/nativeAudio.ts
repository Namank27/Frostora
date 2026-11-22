/* Native audio bridge — v1.0.1 (APK only).
 *
 * The web app cannot do either of these on its own: a browser has
 * no API to read/set the phone's system volume, and the Android
 * WebView's audio dies when the app is minimised. Both are solved
 * natively by the `FrostoraAudio` Capacitor plugin that ships in
 * the Android wrapper (frostora-android/.../FrostoraAudioPlugin.java
 * + MediaPlaybackService.java) — a small local plugin, no npm
 * dependency, so it works with the wrapper's Capacitor 7:
 *
 *   - Background play: the plugin starts a foreground service of
 *     type mediaPlayback with a MediaSession + notification. The
 *     service keeps the app process alive, so the YouTube iframe
 *     audio keeps playing when the app is minimised or the screen
 *     locks; the notification's play/pause/next/previous buttons
 *     come back into the web app as `playbackAction` events.
 *     Honest limit: playback still lives in the WebView — the
 *     service keeps the process alive, it does not move decoding
 *     into native ExoPlayer (that would need the audio stream
 *     outside the YouTube iframe, which the iframe does not
 *     expose). If Android ever suspends the WebView mid-track,
 *     the current song can stall until the app is foregrounded
 *     again; the next track will not auto-advance while suspended.
 *   - Volume, both ways: `getVolume`/`setVolume` talk to the
 *     Android AudioManager (STREAM_MUSIC); `startVolumeWatch`
 *     listens for the hardware volume keys and emits
 *     `volumeChange` with the new system level, so the in-app
 *     slider follows the buttons and the buttons follow the
 *     slider (App.tsx keeps slider == system volume ==
 *     player volume).
 *
 * Why a local plugin instead of a published one: the maintained
 * `@capawesome/capacitor-volume` (get/set volume + button events)
 * requires Capacitor >= 8 and this wrapper is on Capacitor 7, and
 * `@jofr/capacitor-media-session` (foreground service + Media
 * Session) has not been released since Aug 2024 (v4.0.0, Capacitor
 * 6 peer). Upgrading the wrapper to Capacitor 8 to use the
 * Capawesome volume plugin is the alternative path — see
 * V101-REBUILD-NOTES.md.
 *
 * Every function here is a no-op (never throws) on the web build
 * and on desktop: the plugin only exists inside the APK, so all
 * calls are guarded by Capacitor.isNativePlatform(). */

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";

export interface NativeTrackMeta {
  title: string;
  artist: string;
  album?: string;
}

export type NativePlaybackAction = "play" | "pause" | "next" | "previous";

interface FrostoraAudioPlugin {
  startBackgroundAudio(options: NativeTrackMeta): Promise<void>;
  stopBackgroundAudio(): Promise<void>;
  updateMetadata(options: NativeTrackMeta): Promise<void>;
  setPlaying(options: { playing: boolean }): Promise<void>;
  getVolume(): Promise<{ volume: number }>;
  setVolume(options: { volume: number }): Promise<void>;
  startVolumeWatch(): Promise<void>;
  stopVolumeWatch(): Promise<void>;
  addListener(eventName: "volumeChange", listener: (e: { volume: number }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "playbackAction", listener: (e: { action: NativePlaybackAction }) => void): Promise<PluginListenerHandle>;
}

const FrostoraAudio = registerPlugin<FrostoraAudioPlugin>("FrostoraAudio");

/** True only inside the Android APK (never on the web build). */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Tell the native side a track is playing: starts the foreground
 * service (if not already running) and publishes the track to the
 * lock-screen / notification media session. */
export async function startBackgroundAudio(meta: NativeTrackMeta): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await FrostoraAudio.startBackgroundAudio(meta);
  } catch {
    /* native plugin unavailable — playback continues in-app only */
  }
}

/** Stop the foreground service and clear the notification. */
export async function stopBackgroundAudio(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await FrostoraAudio.stopBackgroundAudio();
  } catch {
    /* already stopped / unavailable */
  }
}

/** Update the lock-screen track info without restarting the service. */
export async function updateNativeMetadata(meta: NativeTrackMeta): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await FrostoraAudio.updateMetadata(meta);
  } catch {
    /* ignore — metadata is best-effort */
  }
}

/** Tell the native session whether playback is currently playing
 * (drives the notification's play/pause icon). */
export async function setNativePlaying(playing: boolean): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await FrostoraAudio.setPlaying({ playing });
  } catch {
    /* ignore — playback state is best-effort */
  }
}

/** Current phone media volume, 0–1 (null when unavailable). */
export async function getNativeVolume(): Promise<number | null> {
  if (!isNativeApp()) return null;
  try {
    const { volume } = await FrostoraAudio.getVolume();
    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : null;
  } catch {
    return null;
  }
}

/** Set the phone media volume, 0–1. */
export async function setNativeVolume(volume: number): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await FrostoraAudio.setVolume({ volume: Math.min(1, Math.max(0, volume)) });
  } catch {
    /* ignore — the in-app slider still sets the player volume */
  }
}

/** Start listening for hardware volume-key / system volume changes.
 * The callback receives the new system volume (0–1). Returns a
 * cleanup function; safe to call on web (returns a no-op). */
export async function watchNativeVolume(
  onChange: (volume: number) => void,
): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  try {
    const handle = await FrostoraAudio.addListener("volumeChange", (e) => {
      if (typeof e?.volume === "number" && Number.isFinite(e.volume)) {
        onChange(Math.min(1, Math.max(0, e.volume)));
      }
    });
    await FrostoraAudio.startVolumeWatch();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      void handle.remove();
      void FrostoraAudio.stopVolumeWatch().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

/** Listen for lock-screen / notification transport buttons.
 * Returns a cleanup function; safe to call on web (no-op). */
export async function onNativePlaybackAction(
  onAction: (action: NativePlaybackAction) => void,
): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  try {
    const handle = await FrostoraAudio.addListener("playbackAction", (e) => {
      if (e?.action === "play" || e?.action === "pause" || e?.action === "next" || e?.action === "previous") {
        onAction(e.action);
      }
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}
