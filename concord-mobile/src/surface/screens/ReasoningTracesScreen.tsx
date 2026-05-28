// Phase Z9 — Concord Mobile / HLR reasoning traces screen.
// Parallel to /lenses/reasoning/traces.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5050';

interface Trace {
  id: string;
  mode: string;
  input_summary?: string;
  chain_count?: number;
  confidence?: number;
  created_at?: number;
}

export function ReasoningTracesScreen() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<string>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeTrace, setActiveTrace] = useState<Record<string, unknown> | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const j = await fetch(`${API_BASE_URL}/api/reasoning/traces?limit=100`, { credentials: 'include' }).then((r) => r.json());
      if (j?.ok) {
        setTraces(j.traces || []);
        setModes(j.modes || []);
      }
    } finally { setPending(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => filterMode === 'all' ? traces : traces.filter((t) => t.mode === filterMode), [traces, filterMode]);

  const open = async (id: string) => {
    setActiveId(id);
    try {
      const j = await fetch(`${API_BASE_URL}/api/reasoning/trace/${id}`, { credentials: 'include' }).then((r) => r.json());
      if (j?.ok) setActiveTrace(j.trace || null);
    } catch { /* swallow */ }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>🧠 HLR Traces</Text>
      <Text style={styles.subhead}>{traces.length} traces · 7 modes</Text>

      <View style={styles.modes}>
        <TouchableOpacity onPress={() => setFilterMode('all')} style={[styles.mode, filterMode === 'all' && styles.modeSel]}>
          <Text style={styles.modeText}>all</Text>
        </TouchableOpacity>
        {modes.map((m) => (
          <TouchableOpacity key={m} onPress={() => setFilterMode(m)} style={[styles.mode, filterMode === m && styles.modeSel]}>
            <Text style={styles.modeText}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {filtered.map((t) => (
        <TouchableOpacity key={t.id} onPress={() => open(t.id)} style={[styles.card, activeId === t.id && styles.cardSel]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.cardMode}>{t.mode}</Text>
            <Text style={styles.cardConf}>conf {Math.round((t.confidence || 0) * 100)}%</Text>
          </View>
          {t.input_summary && <Text style={styles.cardSummary} numberOfLines={2}>{t.input_summary}</Text>}
        </TouchableOpacity>
      ))}

      {activeTrace && (
        <View style={styles.detail}>
          <Text style={styles.detailHeading}>trace · {activeId}</Text>
          <Text style={styles.detailText} numberOfLines={20}>
            {JSON.stringify(activeTrace, null, 2)}
          </Text>
        </View>
      )}

      {pending && <ActivityIndicator color="#22d3ee" />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  heading: { color: '#a5f3fc', fontSize: 22, fontWeight: '700' },
  subhead: { color: '#71717a', fontSize: 11, marginBottom: 12 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 },
  mode: { backgroundColor: '#27272a', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, marginRight: 4, marginBottom: 4 },
  modeSel: { backgroundColor: '#0891b2' },
  modeText: { color: '#a5f3fc', fontSize: 10 },
  card: { backgroundColor: '#0c1e26', borderColor: '#155e75', borderWidth: 1, borderRadius: 6, padding: 8, marginBottom: 6 },
  cardSel: { borderColor: '#22d3ee', backgroundColor: '#164e63' },
  cardMode: { color: '#a5f3fc', fontFamily: 'monospace', fontSize: 12 },
  cardConf: { color: '#fde68a', fontSize: 10 },
  cardSummary: { color: '#a1a1aa', fontSize: 10, marginTop: 4 },
  detail: { backgroundColor: '#0c1e26', borderColor: '#155e75', borderWidth: 1, borderRadius: 6, padding: 10, marginTop: 16 },
  detailHeading: { color: '#67e8f9', fontSize: 11, marginBottom: 6 },
  detailText: { color: '#a5f3fc', fontFamily: 'monospace', fontSize: 9 },
});
