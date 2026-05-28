// Phase Z9 — Concord Mobile / Garage screen.
// Parallel to /lenses/garage. Vehicle list + spawn.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5050';

interface Vehicle { id: string; world_id: string; kind: string; owner_kind: string; capacity: number; fare_cc: number; }

const KINDS = ['horse', 'cart', 'carriage', 'boat', 'mig_203', 'glider'];

export function GarageScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [spawnKind, setSpawnKind] = useState('horse');
  const [pending, setPending] = useState(false);
  const worldId = 'concordia-hub';

  const refresh = useCallback(async () => {
    try {
      const j = await fetch(`${API_BASE_URL}/api/garage/world/${worldId}`, { credentials: 'include' }).then((r) => r.json());
      if (j?.ok) setVehicles(j.vehicles || []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const spawn = async () => {
    setPending(true);
    try {
      await fetch(`${API_BASE_URL}/api/garage/spawn`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId, kind: spawnKind, ownerKind: 'player' }),
      });
      refresh();
    } finally { setPending(false); }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>🚗 Garage</Text>
      <Text style={styles.subhead}>{worldId} · {vehicles.length} vehicles</Text>

      <Text style={styles.section}>Spawn</Text>
      <View style={styles.row}>
        {KINDS.map((k) => (
          <TouchableOpacity key={k} onPress={() => setSpawnKind(k)} style={[styles.kindBtn, spawnKind === k && styles.kindBtnSel]}>
            <Text style={styles.kindText}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity onPress={spawn} disabled={pending} style={styles.spawnBtn}>
        <Text style={styles.spawnBtnText}>{pending ? 'Spawning…' : `+ Spawn ${spawnKind}`}</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Fleet</Text>
      {vehicles.length === 0 && <Text style={styles.empty}>No vehicles.</Text>}
      {vehicles.map((v) => (
        <View key={v.id} style={styles.card}>
          <Text style={styles.cardTitle}>{v.kind}</Text>
          <Text style={styles.cardMeta}>{v.owner_kind} · cap {v.capacity} · fare {v.fare_cc} cc</Text>
        </View>
      ))}

      {pending && <ActivityIndicator color="#fbbf24" />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  heading: { color: '#fde68a', fontSize: 22, fontWeight: '700' },
  subhead: { color: '#71717a', fontSize: 11, marginBottom: 12 },
  section: { color: '#fcd34d', fontSize: 14, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  empty: { color: '#52525b', fontStyle: 'italic', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kindBtn: { backgroundColor: '#27272a', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 4, marginRight: 4, marginBottom: 4 },
  kindBtnSel: { backgroundColor: '#d97706' },
  kindText: { color: '#fde68a', fontSize: 11 },
  spawnBtn: { backgroundColor: '#a16207', paddingVertical: 10, borderRadius: 6, alignItems: 'center', marginTop: 8 },
  spawnBtnText: { color: '#fde68a', fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: '#1a1410', borderColor: '#a16207', borderWidth: 1, borderRadius: 6, padding: 8, marginBottom: 6 },
  cardTitle: { color: '#fde68a', fontSize: 13, fontWeight: '600' },
  cardMeta: { color: '#fcd34d', fontSize: 10, marginTop: 2 },
});
