// Phase Z9 — Concord Mobile / Creatures screen.
// Parallel to /lenses/creatures. Population list + crossbreed.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5050';

interface Population { id: string; world_id: string; biome: string; species_id: string; lifestyle: string; current_count: number; }

export function CreaturesScreen() {
  const [pops, setPops] = useState<Population[]>([]);
  const [pickA, setPickA] = useState<Population | null>(null);
  const [pickB, setPickB] = useState<Population | null>(null);
  const [result, setResult] = useState<{ ok: boolean; reason?: string; hybrid?: { id?: string; species_id?: string } } | null>(null);
  const [pending, setPending] = useState(false);
  const worldId = 'concordia-hub';

  const refresh = useCallback(async () => {
    try {
      const j = await fetch(`${API_BASE_URL}/api/creatures/world/${worldId}`, { credentials: 'include' }).then((r) => r.json());
      if (j?.ok) setPops(j.populations || []);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const breed = async () => {
    if (!pickA || !pickB) return;
    setPending(true);
    setResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/creatures/breed`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          a: { id: pickA.id, species_id: pickA.species_id, lifestyle: pickA.lifestyle },
          b: { id: pickB.id, species_id: pickB.species_id, lifestyle: pickB.lifestyle },
          environment: pickA.biome,
          sameEnvironmentBonus: pickA.biome === pickB.biome,
        }),
      });
      setResult(await r.json());
    } finally { setPending(false); }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>🧬 Creatures</Text>
      <Text style={styles.subhead}>{worldId} · {pops.length} populations</Text>

      {pops.map((p) => {
        const sel = pickA?.id === p.id || pickB?.id === p.id;
        return (
          <TouchableOpacity
            key={p.id}
            onPress={() => {
              if (!pickA) setPickA(p);
              else if (!pickB && pickA.id !== p.id) setPickB(p);
              else { setPickA(p); setPickB(null); }
            }}
            style={[styles.card, sel && styles.cardSel]}
          >
            <Text style={styles.cardTitle}>{p.species_id}</Text>
            <Text style={styles.cardMeta}>{p.biome} · {p.lifestyle} · ×{p.current_count}</Text>
          </TouchableOpacity>
        );
      })}

      {pickA && pickB && (
        <View style={styles.crossBox}>
          <Text style={styles.crossTitle}>{pickA.species_id} × {pickB.species_id}</Text>
          <TouchableOpacity onPress={breed} disabled={pending} style={styles.breedBtn}>
            <Text style={styles.breedBtnText}>{pending ? 'Breeding…' : 'Attempt crossbreed'}</Text>
          </TouchableOpacity>
          {result && (
            <Text style={result.ok && result.hybrid ? styles.success : styles.failure}>
              {result.ok && result.hybrid ? `✓ hybrid ${result.hybrid.species_id}` : `× ${result.reason || 'incompatible'}`}
            </Text>
          )}
        </View>
      )}

      {pending && <ActivityIndicator color="#a78bfa" />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  heading: { color: '#c4b5fd', fontSize: 22, fontWeight: '700' },
  subhead: { color: '#71717a', fontSize: 11, marginBottom: 12 },
  card: { backgroundColor: '#1a1525', borderColor: '#7c3aed', borderWidth: 1, borderRadius: 6, padding: 8, marginBottom: 6 },
  cardSel: { borderColor: '#a78bfa', backgroundColor: '#3b2466' },
  cardTitle: { color: '#c4b5fd', fontSize: 12, fontFamily: 'monospace' },
  cardMeta: { color: '#a78bfa', fontSize: 10, marginTop: 2 },
  crossBox: { backgroundColor: '#1a1525', borderColor: '#a78bfa', borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 12 },
  crossTitle: { color: '#c4b5fd', fontSize: 13, marginBottom: 6 },
  breedBtn: { backgroundColor: '#7c3aed', paddingVertical: 8, borderRadius: 4, alignItems: 'center' },
  breedBtnText: { color: '#ede9fe', fontSize: 12 },
  success: { color: '#86efac', fontSize: 11, marginTop: 6 },
  failure: { color: '#fca5a5', fontSize: 11, marginTop: 6 },
});
