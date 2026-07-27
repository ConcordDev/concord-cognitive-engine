import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';

export interface DashboardAction {
  id: string;
  label: string;
  detail: string;
  accent: string;
  onPress: () => void;
}

interface CentralizedDashboardProps {
  connectionLabel: string;
  peerCount: number;
  activeTransportCount: number;
  availableBalanceLabel: string;
  linkedDeviceCount: number;
  unpropagatedCount: number;
  actions: DashboardAction[];
}

export function CentralizedDashboard({
  connectionLabel,
  peerCount,
  activeTransportCount,
  availableBalanceLabel,
  linkedDeviceCount,
  unpropagatedCount,
  actions,
}: CentralizedDashboardProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>Immersive UI</Text>
        <Text style={styles.heroTitle}>Concord Command Deck</Text>
        <Text style={styles.heroSubtitle}>
          Central access to chat, lenses, economy, mesh, and world systems.
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Connection</Text>
          <Text style={styles.statValue}>{connectionLabel}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Mesh</Text>
          <Text style={styles.statValue}>{peerCount} peers</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Transports</Text>
          <Text style={styles.statValue}>{activeTransportCount} active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Wallet</Text>
          <Text style={styles.statValue}>{availableBalanceLabel} CC</Text>
        </View>
      </View>

      <View style={styles.healthCard}>
        <Text style={styles.healthLine}>Linked devices: {linkedDeviceCount}</Text>
        <Text style={styles.healthLine}>Pending sync items: {unpropagatedCount}</Text>
      </View>

      <Text style={styles.sectionTitle}>Primary functions</Text>
      <View style={styles.actionGrid}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.id}
            style={[styles.actionCard, { borderColor: action.accent }]}
            onPress={action.onPress}
          >
            <Text style={[styles.actionLabel, { color: action.accent }]}>{action.label}</Text>
            <Text style={styles.actionDetail}>{action.detail}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060912' },
  content: { padding: 16, paddingTop: 56, paddingBottom: 32 },
  heroCard: {
    backgroundColor: '#0d1322',
    borderColor: '#1d2d4f',
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  heroEyebrow: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroTitle: { color: '#e0f2fe', fontSize: 22, fontWeight: '700' },
  heroSubtitle: { color: '#9ca3af', fontSize: 13, marginTop: 6, lineHeight: 19 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statLabel: { color: '#64748b', fontSize: 11, textTransform: 'uppercase' },
  statValue: { color: '#e5e7eb', fontSize: 15, fontWeight: '700', marginTop: 4 },
  healthCard: {
    backgroundColor: '#0b1220',
    borderColor: '#1f2937',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  healthLine: { color: '#94a3b8', fontSize: 12, marginVertical: 2 },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 10,
    letterSpacing: 0.6,
  },
  actionGrid: { gap: 10 },
  actionCard: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  actionLabel: { fontSize: 15, fontWeight: '700' },
  actionDetail: { color: '#94a3b8', marginTop: 4, fontSize: 12, lineHeight: 17 },
});
