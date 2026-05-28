// Phase Z9 — Concord Mobile / Courtship screen.
//
// Parallel to the web /lenses/courtship lens. Lists active courtships +
// marriages + children. Calls /api/courtship/{mine,marriages/mine}.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5050';

interface Courtship { partner_kind: string; partner_id: string; affinity: number; status: string; }
interface Marriage { id: string; partner_kind: string; partner_id: string; married_at: number; status: string; }
interface Child { id: string; partner_id: string; maturity_stage: string; born_at: number; }

export function CourtshipScreen() {
  const [courtships, setCourtships] = useState<Courtship[]>([]);
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cR, mR] = await Promise.all([
        fetch(`${API_BASE_URL}/api/courtship/mine`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${API_BASE_URL}/api/courtship/marriages/mine`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (cR?.ok) setCourtships(cR.courtships || []);
      if (mR?.ok) {
        setMarriages(mR.marriages || []);
        setChildren(mR.children || []);
      }
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const interact = async (c: Courtship) => {
    setPending(true);
    try {
      await fetch(`${API_BASE_URL}/api/courtship/interact`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerKind: c.partner_kind, partnerId: c.partner_id, sentiment: 1 }),
      });
      refresh();
    } finally { setPending(false); }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>♥ Courtships</Text>
      <Text style={styles.subhead}>{courtships.length} active</Text>

      {courtships.length === 0 ? (
        <Text style={styles.empty}>No active courtships. Initiate via an NPC's menu in-world.</Text>
      ) : (
        courtships.map((c) => {
          const pct = Math.round((c.affinity || 0) * 100);
          return (
            <View key={c.partner_id} style={styles.card}>
              <Text style={styles.cardTitle}>{c.partner_kind}: {c.partner_id.slice(0, 14)}</Text>
              <Text style={styles.cardMeta}>status: {c.status} · affinity: {pct}%</Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <TouchableOpacity onPress={() => interact(c)} disabled={pending} style={styles.btn}>
                <Text style={styles.btnText}>Interact (+)</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}

      <Text style={styles.section}>⚭ Marriages ({marriages.length})</Text>
      {marriages.map((m) => (
        <View key={m.id} style={styles.row}>
          <Text style={styles.rowText}>{m.partner_kind}: {m.partner_id.slice(0, 14)}</Text>
        </View>
      ))}

      <Text style={styles.section}>👶 Children ({children.length})</Text>
      {children.map((c) => (
        <View key={c.id} style={styles.row}>
          <Text style={styles.rowText}>{c.id.slice(0, 16)} — {c.maturity_stage}</Text>
        </View>
      ))}

      {pending && <ActivityIndicator color="#e879f9" style={{ marginTop: 12 }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  heading: { color: '#fda4af', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subhead: { color: '#71717a', fontSize: 11, marginBottom: 12 },
  section: { color: '#fda4af', fontSize: 14, fontWeight: '600', marginTop: 18, marginBottom: 6 },
  empty: { color: '#52525b', fontSize: 12, fontStyle: 'italic', marginVertical: 8 },
  card: { backgroundColor: '#1f1525', borderColor: '#9f1239', borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  cardTitle: { color: '#fda4af', fontSize: 12, fontFamily: 'monospace' },
  cardMeta: { color: '#a1a1aa', fontSize: 10, marginTop: 2 },
  bar: { height: 4, backgroundColor: '#27272a', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#fb7185' },
  btn: { backgroundColor: '#9f1239', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 4, marginTop: 8, alignSelf: 'flex-start' },
  btnText: { color: '#fda4af', fontSize: 11 },
  row: { paddingVertical: 6, paddingHorizontal: 8, backgroundColor: '#13131a', borderRadius: 4, marginBottom: 4 },
  rowText: { color: '#d4d4d8', fontSize: 11, fontFamily: 'monospace' },
});
