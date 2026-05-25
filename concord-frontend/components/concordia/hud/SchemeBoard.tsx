'use client';

/**
 * SchemeBoard — Sprint C/A4 + Sprint D/AA1 (design-system migration)
 *
 * Two-column board: schemes you've launched + schemes against you.
 * Backend: domain="schemes".
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ds } from '@/lib/design-system';

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
    <div className={ds.modalBackdrop} onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className={ds.modalContainer}>
        <div onClick={(e) => e.stopPropagation()} className={`${ds.modalPanel} max-w-3xl p-6 max-h-[80vh] overflow-y-auto`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-lattice-border">
            <h2 className={`${ds.heading2} tracking-wider uppercase`}>Scheme Board</h2>
            <button onClick={onClose} className={ds.btnGhost}>Close</button>
          </div>

          {loading && <p className={ds.textMuted}>Loading…</p>}

          <div className={ds.grid2}>
            <div>
              <h3 className={`${ds.heading3} text-sm mb-2`}>Your schemes</h3>
              {mine.length === 0 && <p className={`${ds.textMuted} italic`}>No active schemes.</p>}
              <ul className="divide-y divide-lattice-border">
                {mine.map((s) => (
                  <li key={s.id} className="py-2">
                    <div className="text-blue-300">{KIND_GLYPH[s.kind] || '?'} {s.kind} → {s.target_id}</div>
                    <div className={`${ds.textMuted}`} style={{ fontSize: '11px' }}>
                      {s.phase} · success {s.success_pct}% · disc {s.discovery_pct}%
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className={`${ds.heading3} text-sm mb-2`}>Against you</h3>
              {against.length === 0 && <p className={`${ds.textMuted} italic`}>None known.</p>}
              <ul className="divide-y divide-lattice-border">
                {against.map((s) => (
                  <li key={s.id} className="py-2">
                    <div className="text-red-300">{KIND_GLYPH[s.kind] || '?'} {s.kind} from {s.plotter_id}</div>
                    <div className={`${ds.textMuted}`} style={{ fontSize: '11px' }}>
                      {s.phase} · disc {s.discovery_pct}%
                    </div>
                    <button
                      onClick={() => discoverMore(s.id)}
                      className={`${ds.btnSmall} mt-1 bg-emerald-900/30 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/50`}
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
    </div>
  );
}
