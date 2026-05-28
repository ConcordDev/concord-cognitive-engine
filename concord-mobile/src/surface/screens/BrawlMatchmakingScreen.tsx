// Phase G4.3 — BrawlMatchmakingQueue (WebView wrapper).

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AuthedWebView } from '../components/AuthedWebView';
import { getApiBaseUrl } from '../../config/api';

export function BrawlMatchmakingScreen() {
  return (
    <View style={styles.container}>
      <AuthedWebView source={{ uri: `${getApiBaseUrl()}/hud/brawl-queue` }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
});
