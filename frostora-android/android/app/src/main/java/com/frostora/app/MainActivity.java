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
        // Local plugins must be registered BEFORE super.onCreate():
        // BridgeActivity builds the bridge from bridgeBuilder inside
        // onCreate, and registerPlugin only adds to that builder.
        registerPlugin(FrostoraAudioPlugin.class);
        super.onCreate(savedInstanceState);
        // Frostora streams YouTube Music: allow media without a tap.
        android.webkit.WebSettings ws = this.bridge.getWebView().getSettings();
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setDomStorageEnabled(true);
        ws.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // v1.0.1: the background-audio foreground service shows its
        // Now Playing notification through this permission (Android
        // 13+). Without it the service still runs, but the
        // notification — and with it the lock-screen controls —
        // may not appear.
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
