package com.frostora.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

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
 *  - startVoiceSearch / stopVoiceSearch (v1.0.2) + `speechPartial`
 *    / `speechResult` / `speechError` events — native speech
 *    recognition via android.speech.SpeechRecognizer. The Web
 *    Speech API does not exist in Android WebView, so without
 *    this the mic in the APK always landed on "Voice search
 *    isn't available here". The web build keeps using Web Speech.
 *
 * Alternatives considered (see V101-REBUILD-NOTES.md): the
 * maintained @capawesome/capacitor-volume needs Capacitor >= 8
 * (this wrapper is on Capacitor 7) and
 * @jofr/capacitor-media-session is unreleased since Aug 2024
 * (v4.0.0, Capacitor 6 peer). A dependency-free local plugin
 * keeps the Capacitor 7 wrapper building as-is. The same
 * reasoning applies to voice search: the maintained
 * @capacitor-community/speech-recognition (v7) would work, but
 * a few lines of SpeechRecognizer in this local plugin avoid
 * another npm dependency, lockfile churn and a cap-sync step. */

@CapacitorPlugin(
    name = "FrostoraAudio",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "speechRecognition")
    }
)
public class FrostoraAudioPlugin extends Plugin implements MediaPlaybackService.PlaybackActionListener {

    private AudioManager audioManager;
    private BroadcastReceiver volumeReceiver;
    private boolean volumeWatching = false;
    // v1.0.3: last system level already emitted — setStreamVolume
    // fires VOLUME_CHANGED_ACTION for every call, so a fast slider
    // drag produces a storm of broadcasts, many for a level that
    // was already reported. Emitting only on change keeps the
    // bridge quiet; the web side separately suppresses the stale
    // echoes that do get through while a drag is in flight.
    private int lastEmittedVolumeLevel = -1;
    // v1.0.2: native speech recognition state. The recognizer is
    // created per session and destroyed when the session ends, so
    // a stale recognizer can never block the next tap on the mic.
    private SpeechRecognizer speechRecognizer;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        MediaPlaybackService.setActionListener(this);
    }

    @Override
    protected void handleOnDestroy() {
        stopVolumeWatchInternal();
        stopSpeechInternal();
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
        if (current == lastEmittedVolumeLevel) return;
        lastEmittedVolumeLevel = current;
        double volume = max > 0 ? (double) current / (double) max : 0.0;
        JSObject data = new JSObject();
        data.put("volume", volume);
        notifyListeners("volumeChange", data);
    }

    /* ---------------- Voice search (v1.0.2) ----------------
       Native speech recognition. The Web Speech API
       (window.SpeechRecognition) is not exposed in Android
       WebView, so the web app's mic could never work inside the
       APK — it always fell through to "Voice search isn't
       available here". This uses the platform SpeechRecognizer
       directly (same engine Google's own voice search uses),
       with results delivered as listener events so the web side
       sees interim transcripts live:
         - "speechPartial" { text } — interim transcript
         - "speechResult"  { matches: string[] } — final results
         - "speechError"   { code, errorCode } — terminal failure
       startVoiceSearch resolves once listening has actually
       started (after the mic permission, if one was needed). It
       REJECTS — so the web side can fall back to Web Speech and
       only then show the unavailable state — when the device has
       no recognizer at all or the mic permission is denied. */

    @PluginMethod
    public void startVoiceSearch(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("speech-recognition-unavailable");
            return;
        }
        PermissionState state = getPermissionState("speechRecognition");
        if (state == PermissionState.GRANTED) {
            beginListening(call);
        } else if (state == PermissionState.DENIED) {
            call.reject("microphone-permission-denied");
        } else {
            // PROMPT / PROMPT_WITH_RATIONALE: ask the user; the
            // callback below starts listening (or rejects) with
            // the same saved call.
            requestPermissionForAlias("speechRecognition", call, "onSpeechPermissionResult");
        }
    }

    @PermissionCallback
    private void onSpeechPermissionResult(PluginCall call) {
        if (getPermissionState("speechRecognition") == PermissionState.GRANTED) {
            beginListening(call);
        } else {
            call.reject("microphone-permission-denied");
        }
    }

    @PluginMethod
    public void stopVoiceSearch(PluginCall call) {
        if (getActivity() == null) {
            stopSpeechInternal();
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            stopSpeechInternal();
            call.resolve();
        });
    }

    private void beginListening(PluginCall call) {
        if (getActivity() == null) {
            call.reject("activity-unavailable");
            return;
        }
        // SpeechRecognizer needs a Looper: create and drive it on
        // the main thread, never from a background thread.
        getActivity().runOnUiThread(() -> {
            stopSpeechInternal();
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int eventType, Bundle params) {}

                @Override
                public void onPartialResults(Bundle partialResults) {
                    ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        JSObject data = new JSObject();
                        data.put("text", matches.get(0));
                        notifyListeners("speechPartial", data);
                    }
                }

                @Override
                public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    destroySpeechRecognizer();
                    if (matches != null && !matches.isEmpty()) {
                        JSObject data = new JSObject();
                        data.put("matches", matches);
                        notifyListeners("speechResult", data);
                    } else {
                        emitSpeechError("no-match", SpeechRecognizer.ERROR_NO_MATCH);
                    }
                }

                @Override
                public void onError(int error) {
                    destroySpeechRecognizer();
                    emitSpeechError(speechErrorCode(error), error);
                }
            });
            speechRecognizer.startListening(intent);
            call.resolve();
        });
    }

    private void stopSpeechInternal() {
        if (speechRecognizer != null) {
            try {
                speechRecognizer.stopListening();
            } catch (Exception ignored) {
                // Already stopped / destroyed.
            }
            destroySpeechRecognizer();
        }
    }

    private void destroySpeechRecognizer() {
        if (speechRecognizer != null) {
            try {
                speechRecognizer.destroy();
            } catch (Exception ignored) {
                // Already destroyed.
            }
            speechRecognizer = null;
        }
    }

    private void emitSpeechError(String code, int errorCode) {
        JSObject data = new JSObject();
        data.put("code", code);
        data.put("errorCode", errorCode);
        notifyListeners("speechError", data);
    }

    private static String speechErrorCode(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH: return "no-match";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "speech-timeout";
            case SpeechRecognizer.ERROR_NETWORK: return "network";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network-timeout";
            case SpeechRecognizer.ERROR_AUDIO: return "audio";
            case SpeechRecognizer.ERROR_SERVER: return "server";
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "recognizer-busy";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "insufficient-permissions";
            default: return "unknown";
        }
    }
}
