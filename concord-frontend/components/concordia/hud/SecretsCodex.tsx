'use client';

/**
 * SecretsCodex — Sprint C/A3 + Sprint D/AA1 (design-system migration)
 *
 * Lists secrets discovered by the player. Backend: domain="secrets".
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ds } from '@/lib/design-system';

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

interface Props { open: boolean; onClose: () => void; }

const KIND_LABEL: Record<DiscoveredSecret['kind'], string> = {
  paternity: 'Paternity', crime: 'Crime', liaison: 'Liaison', debt: 'Debt',
  heresy: 'Heresy', grudge_origin: 'Grudge', hidden_skill: 'Hidden skill', fabricated: 'Fabricated',
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

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

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
    <div className={ds.modalBackdrop} onClick={onClose}>
      <div className={ds.modalContainer}>
        <div onClick={(e) => e.stopPropagation()} className={`${ds.modalPanel} max-w-2xl p-6 max-h-[78vh] overflow-y-auto`}>
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-lattice-border">
            <h2 className={`${ds.heading2} tracking-wider uppercase`}>Secrets Codex</h2>
            <button onClick={onClose} className={ds.btnGhost}>Close</button>
          </div>

          {loading && <p className={ds.textMuted}>Loading…</p>}
          {error && <p className="text-red-400 text-sm">Error: {error}</p>}
          {!loading && !error && secrets.length === 0 && (
            <p className={`${ds.textMuted} italic`}>You have not yet uncovered any secrets. Get closer to the people who hold them.</p>
          )}

          <ul className="divide-y divide-lattice-border">
            {secrets.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-wider text-emerald-300">
                      {KIND_LABEL[s.kind]} · held by {s.holder_npc_id}
                      {s.subject_kind === 'npc' && s.subject_id && (
                        <> · about <strong className="text-white">{s.subject_id}</strong></>
                      )}
                    </div>
                    {s.body && (
                      <div className="text-gray-200 mt-1 leading-relaxed">{s.body}</div>
                    )}
                    <div className="text-gray-500 text-xs mt-1">
                      via {s.via} · {new Date(s.discovered_at * 1000).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {s.weaponised_at ? (
                      <span className="text-red-400 text-xs">⚔ used against {s.weaponised_against}</span>
                    ) : (
                      s.subject_kind === 'npc' && s.subject_id && (
                        <button onClick={() => weaponise(s.id, s.subject_id)} className={ds.btnDanger}>
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
    </div>
  );
}
