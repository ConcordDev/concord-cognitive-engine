'use client';

/**
 * RulerHUD — Sprint C / Track D3
 *
 * Player-ruler dashboard. Shows legitimacy, treasury, recent decrees,
 * citizen loyalty distribution, and active rebellion alerts.
 *
 * Backend: domain="kingdoms" name="kingdom_status".
 */

import React, { useCallback, useEffect, useState } from 'react';
import DecreeComposer from '../../../components/concordia/hud/DecreeComposer';

interface Kingdom {
  id: string;
  name: string;
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ color: '#aaa' }}>Loading kingdom…</div>
    </div>
  );

  const { kingdom, loyalty, rebellionRisk } = status;
  const isPlayerRuler = kingdom.ruler_kind === 'player';
  const isHigh = (rebellionRisk?.score ?? 0) >= 50;

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(720px, 92vw)', maxHeight: '82vh', overflowY: 'auto',
            background: '#0c0c0c', color: '#ddd',
            border: '1px solid #2a2a2a', borderRadius: 6,
            padding: '1.25rem 1.5rem', font: '13px/1.5 -apple-system, system-ui, sans-serif',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', letterSpacing: '0.04em' }}>{kingdom.name.toUpperCase()}</h2>
            <button onClick={onClose} style={{ background: 'transparent', color: '#888', border: '1px solid #333', padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>Close</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={statCard()}>
              <div style={statLabel()}>Legitimacy</div>
              <div style={statValue(legitimacyColor(kingdom.legitimacy))}>{kingdom.legitimacy}</div>
            </div>
            <div style={statCard()}>
              <div style={statLabel()}>Treasury</div>
              <div style={statValue('#dcd')}>{kingdom.treasury}</div>
            </div>
            <div style={statCard()}>
              <div style={statLabel()}>Tax</div>
              <div style={statValue('#cdd')}>{(kingdom.tax_rate * 100).toFixed(1)}%</div>
            </div>
            <div style={statCard()}>
              <div style={statLabel()}>Citizens</div>
              <div style={statValue('#dde')}>{loyalty.count}</div>
            </div>
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <div style={statLabel()}>Loyalty</div>
            <div style={{ height: 14, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden', position: 'relative', border: '1px solid #2a2a2a' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: `${loyalty.avg}%`,
                background: loyaltyColor(loyalty.avg),
              }} />
              <div style={{
                position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: '#fff', textShadow: '0 0 2px #000',
              }}>{loyalty.avg} / 100</div>
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>low {loyalty.low} · high {loyalty.high}</div>
          </div>

          {isHigh && (
            <div style={{ background: '#3a1a1a', border: '1px solid #6a2a2a', padding: '0.6rem 0.8rem', borderRadius: 4, marginBottom: '0.75rem' }}>
              <div style={{ color: '#f88', fontWeight: 600, fontSize: 12, letterSpacing: '0.04em' }}>
                ⚠ REBELLION BREWING (risk {rebellionRisk.score} / {rebellionRisk.threshold})
              </div>
              {rebellions.length > 0 && (
                <ul style={{ margin: '0.4rem 0 0 0', padding: 0, listStyle: 'none' }}>
                  {rebellions.slice(0, 3).map((r) => (
                    <li key={r.id} style={{ fontSize: 11, color: '#fbb' }}>
                      ← {r.plotter_id} · {r.kind} · {r.phase} (disc {r.discovery_pct}%)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isPlayerRuler && (
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setComposerOpen(true)}
                style={{ background: '#2d3a4d', color: '#bcd', border: '1px solid #3d4a5d', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
              >
                Issue decree
              </button>
            </div>
          )}

          {!isPlayerRuler && (
            <div style={{ color: '#888', fontStyle: 'italic', fontSize: 11, marginTop: '1rem' }}>
              Ruled by {kingdom.ruler_kind === 'interregnum' ? 'no one (interregnum)' : kingdom.ruler_id}.
              You are not the ruler.
            </div>
          )}
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

function statCard(): React.CSSProperties {
  return { background: '#141414', border: '1px solid #2a2a2a', padding: '0.5rem 0.75rem', borderRadius: 4 };
}
function statLabel(): React.CSSProperties {
  return { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' };
}
function statValue(color: string): React.CSSProperties {
  return { fontSize: 18, fontWeight: 600, color, marginTop: 4 };
}
function legitimacyColor(v: number): string {
  if (v >= 70) return '#9d9';
  if (v >= 40) return '#dd9';
  return '#d99';
}
function loyaltyColor(v: number): string {
  if (v >= 60) return '#3a6a3a';
  if (v >= 40) return '#6a6a3a';
  return '#6a3a3a';
}
