// Phase G4.3 — StrategicWarBanner (WebView wrapper).

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AuthedWebView } from '../components/AuthedWebView';
import { getApiBaseUrl } from '../../config/api';

export function StrategicWarBannerScreen() {
  return (
    <View style={styles.container}>
      <AuthedWebView source={{ uri: `${getApiBaseUrl()}/hud/war-banner` }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
});
