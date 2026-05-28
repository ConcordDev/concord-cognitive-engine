// Phase Z9 — Concord Mobile / Fishing screen.
// Parallel to /lenses/fishing.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5050';

interface FishCatalog { id: string; name: string; rarity: string; buffOnCook?: string | null; }
interface CatchRow { id: string; item_id: string; item_name?: string; acquired_at: number; }

export function FishingScreen() {
  const [catalog, setCatalog] = useState<FishCatalog[]>([]);
  const [catches, setCatches] = useState<CatchRow[]>([]);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([
        fetch(`${API_BASE_URL}/api/fishing/catalog`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${API_BASE_URL}/api/fishing/catches/mine`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (c?.ok) setCatalog(c.fish || []);
      if (m?.ok) setCatches(m.catches || []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const cast = async () => {
    setPending(true);
    try {
      await fetch(`${API_BASE_URL}/api/fishing/cast`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ biome: 'water' }),
      });
    } finally { setPending(false); }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>🐟 Fishing</Text>
      <Text style={styles.subhead}>Cast, log, study</Text>

      <Text style={styles.section}>Fish catalog</Text>
      {catalog.length === 0 && <Text style={styles.empty}>No fish defined.</Text>}
      {catalog.map((f) => (
        <View key={f.id} style={styles.card}>
          <Text style={styles.cardTitle}>{f.name}</Text>
          <Text style={styles.cardMeta}>{f.rarity}{f.buffOnCook ? ` · cook → ${f.buffOnCook}` : ''}</Text>
        </View>
      ))}

      <TouchableOpacity onPress={cast} disabled={pending} style={styles.castBtn}>
        <Text style={styles.castBtnText}>{pending ? 'Casting…' : 'Cast line'}</Text>
      </TouchableOpacity>

      <Text style={styles.section}>Catch log ({catches.length})</Text>
      {catches.length === 0 && <Text style={styles.empty}>No catches yet.</Text>}
      {catches.map((c) => (
        <View key={c.id} style={styles.row}>
          <Text style={styles.rowText}>{c.item_name || c.item_id}</Text>
          <Text style={styles.rowMeta}>{new Date(c.acquired_at * 1000).toLocaleDateString()}</Text>
        </View>
      ))}

      {pending && <ActivityIndicator color="#22d3ee" style={{ marginTop: 12 }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  heading: { color: '#a5f3fc', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subhead: { color: '#71717a', fontSize: 11, marginBottom: 12 },
  section: { color: '#67e8f9', fontSize: 14, fontWeight: '600', marginTop: 18, marginBottom: 6 },
  empty: { color: '#52525b', fontSize: 12, fontStyle: 'italic' },
  card: { backgroundColor: '#0c1e26', borderColor: '#0891b2', borderWidth: 1, borderRadius: 6, padding: 8, marginBottom: 6 },
  cardTitle: { color: '#a5f3fc', fontSize: 12 },
  cardMeta: { color: '#67e8f9', fontSize: 10, marginTop: 2 },
  castBtn: { backgroundColor: '#0e7490', paddingVertical: 10, borderRadius: 6, alignItems: 'center', marginTop: 12 },
  castBtnText: { color: '#a5f3fc', fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 8, backgroundColor: '#13131a', borderRadius: 4, marginBottom: 4 },
  rowText: { color: '#d4d4d8', fontSize: 11 },
  rowMeta: { color: '#71717a', fontSize: 10 },
});
