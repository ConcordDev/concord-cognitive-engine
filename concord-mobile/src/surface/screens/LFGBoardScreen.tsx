// Phase G4.3 — LFGBoardPanel (WebView wrapper).

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AuthedWebView } from '../components/AuthedWebView';
import { getApiBaseUrl } from '../../config/api';

export function LFGBoardScreen() {
  return (
    <View style={styles.container}>
      <AuthedWebView source={{ uri: `${getApiBaseUrl()}/hud/lfg-board` }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
});
