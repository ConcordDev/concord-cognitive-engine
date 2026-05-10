'use client';

/**
 * SchemeBoard — Sprint C / Track A4
 *
 * Two-column board:
 *   Left: schemes you've launched (kind, target, phase, success%, discovery%)
 *   Right: schemes against you that you've gathered evidence on (with
 *          "discover more" CTA)
 *
 * Backend: domain="schemes" name="list_for_user" / "list_against_user" /
 * "discover_evidence".
 */

import React, { useCallback, useEffect, useState } from 'react';

interface Scheme {
  id: string;
  plotter_kind?: 'npc' | 'player';
  plotter_id?: string;
  target_kind?: string;
  target_id?: string;
  kind: string;
  phase: 'planning' | 'recruiting' | 'gathering_evidence' | 'moving' | 'exposed' | 'complete' | 'abandoned';
  success_pct: number;
  discovery_pct: number;
  evidence_count: number;
  accomplice_count: number;
}

interface Props { open: boolean; onClose: () => void; }

const KIND_GLYPH: Record<string, string> = {
  assassinate: '⚔', seduce: '♥', fabricate_secret: '✎', claim_inheritance: '⚖',
  blackmail: '✉', sabotage_decree: '✗',
};

export default function SchemeBoard({ open, onClose }: Props) {
  const [mine, setMine] = useState<Scheme[]>([]);
  const [against, setAgainst] = useState<Scheme[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'schemes', name: 'list_for_user', input: {} }),
        }).then(r => r.json()),
        fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'schemes', name: 'list_against_user', input: {} }),
        }).then(r => r.json()),
      ]);
      setMine(Array.isArray(a?.schemes) ? a.schemes : []);
      setAgainst(Array.isArray(b?.schemes) ? b.schemes : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const discoverMore = useCallback(async (schemeId: string) => {
    await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'schemes', name: 'discover_evidence', input: { schemeId } }),
    });
    void refresh();
  }, [refresh]);

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(820px, 94vw)', maxHeight: '80vh', overflowY: 'auto',
          background: '#0c0c0c', color: '#ddd',
          border: '1px solid #2a2a2a', borderRadius: 6,
          padding: '1.25rem 1.5rem', font: '13px/1.5 -apple-system, system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', letterSpacing: '0.04em' }}>SCHEME BOARD</h2>
          <button onClick={onClose} style={{ background: 'transparent', color: '#888', border: '1px solid #333', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>Close</button>
        </div>

        {loading && <p>Loading…</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
          <div>
            <h3 style={{ fontSize: '0.85rem', color: '#bbb', marginBottom: '0.5rem' }}>Your schemes</h3>
            {mine.length === 0 && <p style={{ color: '#666', fontStyle: 'italic' }}>No active schemes.</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {mine.map((s) => (
                <li key={s.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #1f1f1f' }}>
                  <div style={{ color: '#bbf' }}>{KIND_GLYPH[s.kind] || '?'} {s.kind} → {s.target_id}</div>
                  <div style={{ color: '#888', fontSize: 11 }}>{s.phase} · success {s.success_pct}% · disc {s.discovery_pct}%</div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={{ fontSize: '0.85rem', color: '#bbb', marginBottom: '0.5rem' }}>Against you</h3>
            {against.length === 0 && <p style={{ color: '#666', fontStyle: 'italic' }}>None known. (You may simply not have evidence yet.)</p>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {against.map((s) => (
                <li key={s.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #1f1f1f' }}>
                  <div style={{ color: '#fbb' }}>{KIND_GLYPH[s.kind] || '?'} {s.kind} from {s.plotter_id}</div>
                  <div style={{ color: '#888', fontSize: 11 }}>{s.phase} · disc {s.discovery_pct}%</div>
                  <button
                    onClick={() => discoverMore(s.id)}
                    style={{ marginTop: 4, background: '#1f3a1f', color: '#c0e0c0', border: '1px solid #305030', padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
                  >
                    Investigate further
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
