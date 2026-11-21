package com.frostora.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Frostora streams YouTube Music: allow media without a tap.
        android.webkit.WebSettings ws = this.bridge.getWebView().getSettings();
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setDomStorageEnabled(true);
        ws.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    }
}
