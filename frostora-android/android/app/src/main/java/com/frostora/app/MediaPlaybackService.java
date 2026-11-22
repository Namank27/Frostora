package com.frostora.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.media.MediaMetadata;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;

/* Frostora background-audio service — v1.0.1.
 *
 * The app plays YouTube audio inside the WebView. When the app is
 * minimised (or the screen locks) Android pauses the activity and
 * may kill the process, which stops the music. A foreground service
 * of type mediaPlayback keeps the process alive, and the
 * MediaSession + MediaStyle notification give the lock screen /
 * notification shade working play / pause / next / previous
 * controls while the music plays.
 *
 * The audio itself still comes from the WebView's YouTube player —
 * this service does not decode anything (the iframe does not expose
 * its stream to native code). That is also the honest limit: the
 * service keeps the process alive, it cannot force a suspended
 * WebView to run JavaScript, so queue auto-advance relies on the
 * WebView staying scheduled while the service runs.
 *
 * Wiring: FrostoraAudioPlugin starts this service with the current
 * track's title/artist and forwards the session callbacks back to
 * the web app as `playbackAction` events. Declared in
 * AndroidManifest.xml with foregroundServiceType="mediaPlayback"
 * (permission FOREGROUND_SERVICE_MEDIA_PLAYBACK was already in the
 * manifest); the plugin also handles the POST_NOTIFICATIONS runtime
 * permission via MainActivity. */

public class MediaPlaybackService extends Service {

    public static final String ACTION_PLAY = "com.frostora.app.action.PLAY";
    public static final String ACTION_PAUSE = "com.frostora.app.action.PAUSE";
    public static final String ACTION_NEXT = "com.frostora.app.action.NEXT";
    public static final String ACTION_PREVIOUS = "com.frostora.app.action.PREVIOUS";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ALBUM = "album";

    private static final String CHANNEL_ID = "frostora-playback";
    private static final int NOTIFICATION_ID = 1;

    /** Transport actions coming from the notification / lock screen. */
    public interface PlaybackActionListener {
        void onPlaybackAction(String action);
    }

    private static volatile PlaybackActionListener actionListener;
    private static volatile String pendingTitle = "";
    private static volatile String pendingArtist = "";
    private static volatile String pendingAlbum = "";
    private static volatile boolean pendingPlaying = false;
    private static volatile MediaPlaybackService runningInstance;

    private MediaSession session;

    public static void setActionListener(@Nullable PlaybackActionListener listener) {
        actionListener = listener;
    }

    /** Update the session metadata. Works before the service has
     * started (values are held as pending) and while it runs. */
    public static void updateMetadata(String title, String artist, String album) {
        pendingTitle = title != null ? title : "";
        pendingArtist = artist != null ? artist : "";
        pendingAlbum = album != null ? album : "";
        MediaPlaybackService svc = runningInstance;
        if (svc != null) svc.applyMetadataAndNotification();
    }

    /** Update the session playback state (playing / paused). */
    public static void setPlaying(boolean playing) {
        pendingPlaying = playing;
        MediaPlaybackService svc = runningInstance;
        if (svc != null) svc.applyMetadataAndNotification();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningInstance = this;
        session = new MediaSession(this, "Frostora");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                pendingPlaying = true;
                applyMetadataAndNotification();
                dispatchAction("play");
            }

            @Override
            public void onPause() {
                pendingPlaying = false;
                applyMetadataAndNotification();
                dispatchAction("pause");
            }

            @Override
            public void onSkipToNext() {
                dispatchAction("next");
            }

            @Override
            public void onSkipToPrevious() {
                dispatchAction("previous");
            }
        });
        session.setActive(true);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            if (intent.hasExtra(EXTRA_TITLE)) pendingTitle = intent.getStringExtra(EXTRA_TITLE);
            if (intent.hasExtra(EXTRA_ARTIST)) pendingArtist = intent.getStringExtra(EXTRA_ARTIST);
            if (intent.hasExtra(EXTRA_ALBUM)) pendingAlbum = intent.getStringExtra(EXTRA_ALBUM);
            String action = intent.getAction();
            if (ACTION_PLAY.equals(action)) {
                pendingPlaying = true;
                dispatchAction("play");
            } else if (ACTION_PAUSE.equals(action)) {
                pendingPlaying = false;
                dispatchAction("pause");
            } else if (ACTION_NEXT.equals(action)) {
                dispatchAction("next");
            } else if (ACTION_PREVIOUS.equals(action)) {
                dispatchAction("previous");
            } else {
                // Plain start (from startBackgroundAudio): the web
                // app is playing, so the session starts as playing.
                pendingPlaying = true;
            }
        }
        applyMetadataAndNotification();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        runningInstance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void dispatchAction(String action) {
        PlaybackActionListener listener = actionListener;
        if (listener != null) listener.onPlaybackAction(action);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Now playing", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows the song currently playing in Frostora");
        nm.createNotificationChannel(channel);
    }

    private PendingIntent actionIntent(String action) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, action.hashCode(), intent, flags);
    }

    private void applyMetadataAndNotification() {
        if (session == null) return;
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, pendingTitle.isEmpty() ? "Frostora" : pendingTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, pendingArtist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, pendingAlbum);
        session.setMetadata(md.build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        PlaybackState state = new PlaybackState.Builder()
                .setActions(actions)
                .setState(pendingPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f)
                .build();
        session.setPlaybackState(state);

        Notification.Builder nb;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nb = new Notification.Builder(this, CHANNEL_ID);
        } else {
            nb = new Notification.Builder(this);
        }
        nb.setContentTitle(pendingTitle.isEmpty() ? "Frostora" : pendingTitle)
                .setContentText(pendingArtist)
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(pendingPlaying)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_media_previous, "Previous", actionIntent(ACTION_PREVIOUS)).build())
                .addAction(new Notification.Action.Builder(
                        pendingPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        pendingPlaying ? "Pause" : "Play",
                        actionIntent(pendingPlaying ? ACTION_PAUSE : ACTION_PLAY)).build())
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_media_next, "Next", actionIntent(ACTION_NEXT)).build())
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        Notification notification = nb.build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }
}
