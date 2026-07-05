// Concord Mobile — Settings Screen
// Model management, storage, privacy controls, transport toggles

import React from 'react';
import { View, Text, Switch, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useIdentity } from '../../hooks/useIdentity';
import { useBattery } from '../../hooks/useBattery';
import { useBrainStore } from '../../store/brain-store';

// `disabled` rows (no persisted per-user transport/privacy preference store
// exists yet — see mesh-store.ts's `transports` array, which tracks live
// connection status, not a user-toggleable enable/disable preference) render
// the switch non-interactive rather than accepting a tap that updates
// nothing real. A privacy toggle that visibly flips OFF but never reaches
// the mesh/sensor pipeline is worse than an honestly-inert one — the user
// would believe a preference took effect when it didn't.
function SettingRow({ label, value, onToggle, disabled }: { label: string; value: boolean; onToggle: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.settingRow}>
      <Text style={[styles.settingLabel, disabled && styles.settingLabelDisabled]}>
        {label}{disabled ? ' (not yet configurable)' : ''}
      </Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: '#333', true: '#1a3a5c' }}
        thumbColor={value ? '#00d4ff' : '#666'}
      />
    </View>
  );
}

export function SettingsScreen() {
  const { identity, hardware } = useIdentity();
  const { level: batteryLevel, isCharging } = useBattery();
  const models = useBrainStore(s => s.availableModels);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      {/* Identity */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Identity</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Public Key</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {identity?.publicKey.substring(0, 24) ?? 'Not initialized'}...
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Linked Devices</Text>
          <Text style={styles.infoValue}>{identity?.linkedDevices.length ?? 0}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Created</Text>
          <Text style={styles.infoValue}>
            {identity ? new Date(identity.createdAt).toLocaleDateString() : '-'}
          </Text>
        </View>
      </View>

      {/* Model Management */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Local Models</Text>
        {models.map(model => (
          <View key={model.id} style={styles.modelRow}>
            <View style={styles.modelInfo}>
              <Text style={styles.modelName}>{model.name}</Text>
              <Text style={styles.modelDetail}>
                {model.sizeMB}MB · {model.quantization} · {model.parameters}
              </Text>
            </View>
            {model.downloaded ? (
              <View style={styles.downloadedBadge}>
                <Text style={styles.downloadedText}>Downloaded</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.downloadButton}>
                <Text style={styles.downloadButtonText}>Download</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      {/* Transport Toggles */}
      {/* No persisted per-user transport preference store exists yet
          (mesh-store.ts tracks live connection status only) — every row
          renders disabled+labeled honestly instead of accepting a tap
          that updates nothing real. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transports</Text>
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="Bluetooth Mesh" value={true} onToggle={() => {}} disabled />
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="WiFi Direct" value={true} onToggle={() => {}} disabled />
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="NFC Tap Transfer" value={true} onToggle={() => {}} disabled />
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="LoRa Bridge" value={false} onToggle={() => {}} disabled />
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="Broadcast Receive" value={false} onToggle={() => {}} disabled />
      </View>

      {/* Privacy */}
      {/* No persisted per-user privacy preference store exists yet —
          every row renders disabled+labeled honestly instead of
          accepting a tap that updates nothing real. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy</Text>
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="Foundation Sense" value={true} onToggle={() => {}} disabled />
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="Share Sensor Data to Mesh" value={true} onToggle={() => {}} disabled />
        {/* detector-allow: hardcoded-prop see the section note above */}
        <SettingRow label="Broadcast Bridge Mode" value={false} onToggle={() => {}} disabled />
        <Text style={styles.privacyNote}>
          Location is always approximate (100m grid). Bluetooth scans never capture
          individual device identifiers. All sensor data is aggregated.
        </Text>
      </View>

      {/* Hardware */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Hardware</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Platform</Text>
          <Text style={styles.infoValue}>{hardware?.platform ?? '-'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Battery</Text>
          <Text style={styles.infoValue}>
            {batteryLevel}%{isCharging ? ' (Charging)' : ''}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Storage</Text>
          <Text style={styles.infoValue}>
            {hardware?.availableStorageGB.toFixed(1) ?? '-'} GB available
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>RAM</Text>
          <Text style={styles.infoValue}>{hardware?.totalRAMGB.toFixed(1) ?? '-'} GB</Text>
        </View>
      </View>

      {/* Storage */}
      <View style={[styles.section, { marginBottom: 40 }]}>
        <Text style={styles.sectionTitle}>Storage</Text>
        <TouchableOpacity style={styles.dangerButton}>
          <Text style={styles.dangerButtonText}>Clear DTU Cache</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerButton}>
          <Text style={styles.dangerButtonText}>Delete Local Models</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  headerTitle: { color: '#00d4ff', fontSize: 20, fontWeight: '700' },
  section: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  sectionTitle: { color: '#e0e0e0', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  settingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10,
  },
  settingLabel: { color: '#e0e0e0', fontSize: 14 },
  settingLabelDisabled: { color: '#666' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  infoLabel: { color: '#888', fontSize: 14 },
  infoValue: { color: '#e0e0e0', fontSize: 14, maxWidth: '60%', textAlign: 'right' },
  modelRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#14141f',
  },
  modelInfo: { flex: 1 },
  modelName: { color: '#e0e0e0', fontSize: 14, fontWeight: '600' },
  modelDetail: { color: '#888', fontSize: 11, marginTop: 2 },
  downloadedBadge: {
    backgroundColor: '#1a3a2a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  downloadedText: { color: '#00ff88', fontSize: 12 },
  downloadButton: {
    backgroundColor: '#1a3a5c', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6,
  },
  downloadButtonText: { color: '#00d4ff', fontSize: 12, fontWeight: '600' },
  privacyNote: { color: '#555', fontSize: 11, lineHeight: 16, marginTop: 12 },
  dangerButton: {
    backgroundColor: '#2a1a1a', borderRadius: 8, paddingVertical: 12,
    alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: '#3a1a1a',
  },
  dangerButtonText: { color: '#ff4444', fontSize: 14, fontWeight: '600' },
});
