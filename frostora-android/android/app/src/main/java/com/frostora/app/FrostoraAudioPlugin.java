package com.frostora.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* FrostoraAudio — local Capacitor plugin for the Frostora APK
 * (v1.0.1). No npm package: the class lives in the Android
 * wrapper and is registered in MainActivity before
 * super.onCreate() (BridgeActivity.registerPlugin adds it to the
 * bridge builder). The web side talks to it through
 * client/src/nativeAudio.ts, which no-ops on the web build.
 *
 * What it does, and why each piece exists:
 *
 *  - startBackgroundAudio / stopBackgroundAudio / updateMetadata /
 *    setPlaying — drive MediaPlaybackService (foreground service,
 *    type mediaPlayback, with a MediaSession + notification) so
 *    YouTube audio keeps playing when the app is minimised or the
 *    screen locks. Session transport buttons come back as
 *    `playbackAction` events (play / pause / next / previous).
 *  - getVolume / setVolume — the Android AudioManager music
 *    stream, so the in-app slider moves the phone's media volume.
 *  - startVolumeWatch / stopVolumeWatch + `volumeChange` events —
 *    a BroadcastReceiver for android.media.VOLUME_CHANGED_ACTION,
 *    so the hardware volume keys move the in-app slider.
 *
 * Alternatives considered (see V101-REBUILD-NOTES.md): the
 * maintained @capawesome/capacitor-volume needs Capacitor >= 8
 * (this wrapper is on Capacitor 7) and
 * @jofr/capacitor-media-session is unreleased since Aug 2024
 * (v4.0.0, Capacitor 6 peer). A dependency-free local plugin
 * keeps the Capacitor 7 wrapper building as-is. */

@CapacitorPlugin(name = "FrostoraAudio")
public class FrostoraAudioPlugin extends Plugin implements MediaPlaybackService.PlaybackActionListener {

    private AudioManager audioManager;
    private BroadcastReceiver volumeReceiver;
    private boolean volumeWatching = false;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        MediaPlaybackService.setActionListener(this);
    }

    @Override
    protected void handleOnDestroy() {
        stopVolumeWatchInternal();
        MediaPlaybackService.setActionListener(null);
        super.handleOnDestroy();
    }

    @Override
    public void onPlaybackAction(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("playbackAction", data);
    }

    @PluginMethod
    public void startBackgroundAudio(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        Context ctx = getContext();
        Intent intent = new Intent(ctx, MediaPlaybackService.class)
                .putExtra(MediaPlaybackService.EXTRA_TITLE, title)
                .putExtra(MediaPlaybackService.EXTRA_ARTIST, artist)
                .putExtra(MediaPlaybackService.EXTRA_ALBUM, album);
        ContextCompat.startForegroundService(ctx, intent);
        call.resolve();
    }

    @PluginMethod
    public void stopBackgroundAudio(PluginCall call) {
        getContext().stopService(new Intent(getContext(), MediaPlaybackService.class));
        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        MediaPlaybackService.updateMetadata(
                call.getString("title", ""),
                call.getString("artist", ""),
                call.getString("album", ""));
        call.resolve();
    }

    @PluginMethod
    public void setPlaying(PluginCall call) {
        Boolean playing = call.getBoolean("playing", false);
        MediaPlaybackService.setPlaying(Boolean.TRUE.equals(playing));
        call.resolve();
    }

    @PluginMethod
    public void getVolume(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager unavailable");
            return;
        }
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        double volume = max > 0 ? (double) current / (double) max : 0.0;
        JSObject ret = new JSObject();
        ret.put("volume", volume);
        call.resolve(ret);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager unavailable");
            return;
        }
        double volume = call.getData().optDouble("volume", Double.NaN);
        if (Double.isNaN(volume)) {
            call.reject("volume is required (0-1)");
            return;
        }
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int level = (int) Math.round(Math.min(1.0, Math.max(0.0, volume)) * max);
        // Flag 0: no system volume UI — the app's own slider is the UI.
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, level, 0);
        call.resolve();
    }

    @PluginMethod
    public void startVolumeWatch(PluginCall call) {
        if (!volumeWatching) {
            volumeReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent == null) return;
                    // The VOLUME_CHANGED_ACTION extra key is a plain
                    // string: AudioManager has no EXTRA_VOLUME_STREAM_TYPE
                    // constant (it does not compile — Actions run #14),
                    // so use the documented key literally.
                    int stream = intent.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1);
                    if (stream != AudioManager.STREAM_MUSIC) return;
                    emitVolume();
                }
            };
            IntentFilter filter = new IntentFilter("android.media.VOLUME_CHANGED_ACTION");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().registerReceiver(volumeReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().registerReceiver(volumeReceiver, filter);
            }
            volumeWatching = true;
        }
        emitVolume();
        call.resolve();
    }

    @PluginMethod
    public void stopVolumeWatch(PluginCall call) {
        stopVolumeWatchInternal();
        call.resolve();
    }

    private void stopVolumeWatchInternal() {
        if (volumeWatching && volumeReceiver != null) {
            try {
                getContext().unregisterReceiver(volumeReceiver);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered.
            }
            volumeReceiver = null;
            volumeWatching = false;
        }
    }

    private void emitVolume() {
        if (audioManager == null) return;
        int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int current = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        double volume = max > 0 ? (double) current / (double) max : 0.0;
        JSObject data = new JSObject();
        data.put("volume", volume);
        notifyListeners("volumeChange", data);
    }
}
