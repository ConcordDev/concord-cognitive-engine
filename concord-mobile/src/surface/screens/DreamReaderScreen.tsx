// Phase G4.3 — DreamReader (WebView wrapper).
//
// Renders the Phase F3.2 DreamReader at /hud/dream-reader. The
// AuthedWebView injects the JWT and forwards API requests through
// the configured backend.

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AuthedWebView } from '../components/AuthedWebView';
import { getApiBaseUrl } from '../../config/api';

export function DreamReaderScreen() {
  return (
    <View style={styles.container}>
      <AuthedWebView source={{ uri: `${getApiBaseUrl()}/hud/dream-reader` }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
});
