'use client';

/**
 * RulerHUD — Sprint C/D3 + Sprint D/AA1 (design-system migration)
 *
 * Player-ruler dashboard. Shows legitimacy, treasury, recent decrees,
 * citizen loyalty distribution, and active rebellion alerts. Themed
 * to the realm's faction via useFactionTheme (Sprint D V1).
 *
 * Backend: domain="kingdoms" name="kingdom_status".
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ds } from '@/lib/design-system';
import { useFactionTheme } from '@/hooks/useFactionTheme';
import DecreeComposer from './DecreeComposer';

interface Kingdom {
  id: string;
  name: string;
  faction_id?: string;
  ruler_kind: 'npc' | 'player' | 'interregnum';
  ruler_id: string | null;
  legitimacy: number;
  treasury: number;
  tax_rate: number;
}

interface LoyaltySummary { avg: number; count: number; low: number; high: number; }

interface RebellionRisk { score: number; threshold: number; spawned?: boolean; factors?: Record<string, unknown>; }

interface KingdomStatus {
  kingdom: Kingdom;
  loyalty: LoyaltySummary;
  rebellionRisk: RebellionRisk;
}

interface Rebellion {
  id: string; plotter_id: string; kind: string; phase: string; discovery_pct: number;
}

interface Props {
  kingdomId: string;
  open: boolean;
  onClose: () => void;
}

export default function RulerHUD({ kingdomId, open, onClose }: Props) {
  const [status, setStatus] = useState<KingdomStatus | null>(null);
  const [rebellions, setRebellions] = useState<Rebellion[]>([]);
  const [loading, setLoading] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const theme = useFactionTheme(status?.kingdom?.faction_id);

  const refresh = useCallback(async () => {
    if (!kingdomId) return;
    setLoading(true);
    try {
      const [stat, k] = await Promise.all([
        fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'kingdoms', name: 'kingdom_status', input: { kingdomId } }),
        }).then(r => r.json()),
        fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'kingdoms', name: 'get', input: { kingdomId } }),
        }).then(r => r.json()),
      ]);
      if (stat?.ok) setStatus({ kingdom: stat.kingdom, loyalty: stat.loyalty, rebellionRisk: stat.rebellionRisk });
      if (Array.isArray(k?.rebellions)) setRebellions(k.rebellions);
    } finally {
      setLoading(false);
    }
  }, [kingdomId]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  if (!open) return null;
  if (loading || !status) return (
    <div className={ds.modalBackdrop} onClick={onClose}>
      <div className={ds.modalContainer}>
        <div className={`${ds.modalPanel} max-w-md p-6`}>
          <p className={ds.textMuted}>Loading kingdom…</p>
        </div>
      </div>
    </div>
  );

  const { kingdom, loyalty, rebellionRisk } = status;
  const isPlayerRuler = kingdom.ruler_kind === 'player';
  const isHigh = (rebellionRisk?.score ?? 0) >= 50;

  return (
    <>
      <div className={ds.modalBackdrop} onClick={onClose}>
        <div className={ds.modalContainer}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${ds.modalPanel} max-w-2xl p-6 max-h-[82vh] overflow-y-auto`}
            style={theme.cssVars}
          >
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-lattice-border">
              <h2 className={`${ds.heading2} tracking-wider uppercase`} style={theme.accentText}>
                {kingdom.name}
              </h2>
              <button onClick={onClose} className={ds.btnGhost}>Close</button>
            </div>

            <div className={`${ds.grid4} mb-4`}>
              <StatCard label="Legitimacy" value={kingdom.legitimacy.toString()} valueClass={legitimacyClass(kingdom.legitimacy)} />
              <StatCard label="Treasury" value={kingdom.treasury.toLocaleString()} valueClass="text-cyan-400" />
              <StatCard label="Tax" value={`${(kingdom.tax_rate * 100).toFixed(1)}%`} valueClass="text-amber-400" />
              <StatCard label="Citizens" value={loyalty.count.toString()} valueClass="text-gray-200" />
            </div>

            <div className="mb-4">
              <div className={ds.label}>Loyalty</div>
              <div className="h-3.5 bg-lattice-elevated rounded border border-lattice-border overflow-hidden relative">
                <div
                  className={`absolute left-0 top-0 bottom-0 ${loyaltyBg(loyalty.avg)}`}
                  style={{ width: `${loyalty.avg}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white" style={{ textShadow: '0 0 2px black' }}>
                  {loyalty.avg} / 100
                </div>
              </div>
              <div className={`${ds.textMuted} mt-1`} style={{ fontSize: '11px' }}>
                low {loyalty.low} · high {loyalty.high}
              </div>
            </div>

            {isHigh && (
              <div className="bg-red-500/15 border border-red-500/40 rounded-lg p-3 mb-4">
                <div className="text-red-400 font-semibold text-xs tracking-wider">
                  ⚠ REBELLION BREWING (risk {rebellionRisk.score} / {rebellionRisk.threshold})
                </div>
                {rebellions.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {rebellions.slice(0, 3).map((r) => (
                      <li key={r.id} className="text-red-300 text-xs">
                        ← {r.plotter_id} · {r.kind} · {r.phase} (disc {r.discovery_pct}%)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {isPlayerRuler ? (
              <div className="flex gap-2 mt-4">
                <button onClick={() => setComposerOpen(true)} className={ds.btnPrimary}>
                  Issue decree
                </button>
              </div>
            ) : (
              <div className={`${ds.textMuted} italic mt-4`} style={{ fontSize: '11px' }}>
                Ruled by {kingdom.ruler_kind === 'interregnum' ? 'no one (interregnum)' : kingdom.ruler_id}.
                You are not the ruler.
              </div>
            )}
          </div>
        </div>
      </div>
      {composerOpen && (
        <DecreeComposer
          kingdomId={kingdomId}
          open={composerOpen}
          onClose={() => { setComposerOpen(false); void refresh(); }}
        />
      )}
    </>
  );
}

function StatCard({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${valueClass} mt-0.5`}>{value}</div>
    </div>
  );
}

function legitimacyClass(v: number): string {
  if (v >= 70) return 'text-green-400';
  if (v >= 40) return 'text-amber-400';
  return 'text-red-400';
}

function loyaltyBg(v: number): string {
  if (v >= 60) return 'bg-green-700';
  if (v >= 40) return 'bg-amber-700';
  return 'bg-red-700';
}
