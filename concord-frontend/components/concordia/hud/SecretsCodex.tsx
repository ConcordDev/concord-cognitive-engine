'use client';

/**
 * SecretsCodex — Sprint C / Track A3
 *
 * Lists secrets discovered by the player (via dialogue / inventory /
 * surveillance / inheritance / quest). Each entry exposes a "weaponise"
 * CTA when the secret has a viable target.
 *
 * Backend: /api/lens/run with domain="secrets" name="list_discovered" or
 * "weaponise". Server-side gates the privacy invariant — the LLM never
 * sees secrets.body; the client safely renders it because the user has
 * earned discovery.
 */

import React, { useCallback, useEffect, useState } from 'react';

interface DiscoveredSecret {
  id: string;
  holder_npc_id: string;
  subject_kind: 'npc' | 'player' | 'faction' | 'kingdom' | 'world';
  subject_id: string;
  kind: 'paternity' | 'crime' | 'liaison' | 'debt' | 'heresy' | 'grudge_origin' | 'hidden_skill' | 'fabricated';
  body?: string;
  discovered_at: number;
  via: string;
  weaponised_at: number | null;
  weaponised_against: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const KIND_LABEL: Record<DiscoveredSecret['kind'], string> = {
  paternity: 'Paternity',
  crime:     'Crime',
  liaison:   'Liaison',
  debt:      'Debt',
  heresy:    'Heresy',
  grudge_origin: 'Grudge',
  hidden_skill: 'Hidden skill',
  fabricated: 'Fabricated',
};

export default function SecretsCodex({ open, onClose }: Props) {
  const [secrets, setSecrets] = useState<DiscoveredSecret[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'secrets', name: 'list_discovered',
          input: { includeBody: true, limit: 100 },
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const list: DiscoveredSecret[] = Array.isArray(j?.secrets) ? j.secrets : Array.isArray(j) ? j : [];
      setSecrets(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const weaponise = useCallback(async (secretId: string, againstNpcId: string) => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'secrets', name: 'weaponise',
          input: { secretId, againstNpcId },
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      void refresh();
    } catch { /* surface as toast in future iteration */ }
  }, [refresh]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 92vw)', maxHeight: '78vh',
          overflowY: 'auto', background: '#0c0c0c', color: '#ddd',
          border: '1px solid #2a2a2a', borderRadius: 6,
          padding: '1.25rem 1.5rem',
          font: '13px/1.5 -apple-system, system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', letterSpacing: '0.04em' }}>SECRETS CODEX</h2>
          <button onClick={onClose} style={{ background: 'transparent', color: '#888', border: '1px solid #333', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>Close</button>
        </div>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: '#e88' }}>Error: {error}</p>}
        {!loading && !error && secrets.length === 0 && (
          <p style={{ color: '#888', fontStyle: 'italic' }}>You have not yet uncovered any secrets. Get closer to the people who hold them.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {secrets.map((s) => (
            <li key={s.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid #1f1f1f' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#9d8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {KIND_LABEL[s.kind]} · held by {s.holder_npc_id}
                    {s.subject_kind === 'npc' && s.subject_id && (
                      <> · about <strong>{s.subject_id}</strong></>
                    )}
                  </div>
                  {s.body && (
                    <div style={{ color: '#eee', marginTop: 4, lineHeight: 1.45 }}>
                      {s.body}
                    </div>
                  )}
                  <div style={{ color: '#666', fontSize: '11px', marginTop: 4 }}>
                    via {s.via} · {new Date(s.discovered_at * 1000).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  {s.weaponised_at ? (
                    <span style={{ color: '#a66', fontSize: '11px' }}>⚔ used against {s.weaponised_against}</span>
                  ) : (
                    s.subject_kind === 'npc' && s.subject_id && (
                      <button
                        onClick={() => weaponise(s.id, s.subject_id)}
                        style={{
                          background: '#3a1f1f', color: '#e0c0c0',
                          border: '1px solid #5a3030', padding: '4px 12px',
                          borderRadius: 4, cursor: 'pointer', fontSize: '11px',
                        }}
                      >
                        Weaponise
                      </button>
                    )
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
