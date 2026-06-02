// Phase G4.1 — AuthedWebView.
//
// Wraps react-native-webview with a JWT bridge: pulls the bearer token
// from expo-secure-store and injects it as window.__CONCORD_JWT__
// before the page content loads. The Phase F/G HUD components on the
// web side prefer this injected token over the cookie when present
// (see concord-frontend/lib/auth-bridge.ts).
//
// Also:
//   - block external nav (onShouldStartLoadWithRequest)
//   - permit autoplay for SFX cues (mediaPlaybackRequiresUserAction=false)
//   - transparent background so the RN parent decides backdrop

import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';

interface Props {
  source: { uri: string };
  /** Optional API base if the source uri is relative. */
  apiBase?: string;
}

const SECURE_TOKEN_KEY = 'concord-jwt';

export function AuthedWebView({ source }: Props) {
  const [jwt, setJwt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<WebView | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const tok = await SecureStore.getItemAsync(SECURE_TOKEN_KEY);
        setJwt(tok || '');
      } catch {
        setJwt('');
      }
      setLoaded(true);
    })();
  }, []);

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#a78bfa" />
      </View>
    );
  }

  // Inject the JWT BEFORE content loads. The page reads
  // window.__CONCORD_JWT__ via lib/auth-bridge.ts.
  const injectedJavaScriptBeforeContentLoaded = `
    window.__CONCORD_JWT__ = ${JSON.stringify(jwt || '')};
    true;
  `;

  const onShouldStartLoadWithRequest = (req: WebViewNavigation) => {
    // Allow only the configured source origin to navigate.
    try {
      const requestUrl = new URL(req.url);
      const sourceUrl = new URL(source.uri);
      return requestUrl.origin === sourceUrl.origin;
    } catch {
      return false;
    }
  };

  return (
    <WebView
      ref={ref}
      source={source}
      style={styles.webView}
      injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      sharedCookiesEnabled={true}
      // transparent so the RN parent backdrop shows through
      // (set both web-side body bg and this option)
      androidLayerType="hardware"
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0f',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
