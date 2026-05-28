'use client';

// Phase DC5 — Mahjong table.
// Simplified 4-player Riichi-style: pick yaku, declare hand, resolve via
// /api/mahjong/resolve. Real-time multiplayer is post-launch — for v1
// this is human + 3 NPC stand-ins.

import { useCallback, useState } from 'react';
import { Hand, Sparkles, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice, milestoneJuice } from '@/lib/concordia/juice';

const YAKU = [
  { id: 'pinfu', label: 'Pinfu', value: 100 },
  { id: 'tanyao', label: 'Tanyao', value: 100 },
  { id: 'yakuhai', label: 'Yakuhai', value: 200 },
  { id: 'iipeiko', label: 'Iipeiko', value: 200 },
  { id: 'sanshoku', label: 'Sanshoku', value: 500 },
  { id: 'ittsuu', label: 'Ittsuu', value: 500 },
  { id: 'toitoi', label: 'Toitoi', value: 600 },
  { id: 'honitsu', label: 'Honitsu', value: 800 },
  { id: 'chinitsu', label: 'Chinitsu', value: 1200 },
  { id: 'kokushi', label: 'Kokushi', value: 3000 },
  { id: 'suuankou', label: 'Suuankou', value: 4000 },
];

interface Result { score: number; xpGained: number; payload: { yakuList: string[]; dealerMult: number; recognised: number; }; }

export function MahjongTable({ building, onClose, worldId }: OverlayProps) {
  const [hand, setHand] = useState<Set<string>>(new Set());
  const [wind, setWind] = useState('east');
  const [tsumo, setTsumo] = useState(false);
  const [riichi, setRiichi] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);

  const toggleYaku = (id: string) => {
    const next = new Set(hand);
    if (next.has(id)) next.delete(id); else next.add(id);
    setHand(next);
  };

  const declare = useCallback(async () => {
    if (hand.size === 0) return;
    setPending(true);
    try {
      const r = await fetch('/api/mahjong/resolve', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          winningHand: [...hand],
          opponents: 3, wind, tsumo, riichi, mahjongSkill: 30,
        }),
      });
      const j = await r.json();
      if (j?.ok) {
        if (j.score >= 1000) milestoneJuice('ui_mahjong_big_score');
        else successJuice('ui_mahjong_score');
        setResult(j);
      }
    } finally { setPending(false); }
  }, [hand, wind, tsumo, riichi]);

  const reset = () => { setHand(new Set()); setResult(null); setTsumo(false); setRiichi(false); };

  return (
    <StationOverlayShell
      title={building.name || 'Mahjong table'}
      subtitle={`mahjong_table · ${worldId}`}
      onClose={onClose}
      accent="emerald"
      size="xl"
    >
      {!result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-[10px] uppercase text-emerald-300/70">wind seat</div>
              <select value={wind} onChange={(e) => setWind(e.target.value)} className="w-full rounded border border-emerald-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-emerald-100">
                <option value="east">East (dealer ×1.5)</option>
                <option value="south">South</option>
                <option value="west">West</option>
                <option value="north">North</option>
              </select>
            </div>
            <div className="flex items-center gap-3 pt-5 text-xs">
              <label className="flex items-center gap-1 text-emerald-200">
                <input type="checkbox" checked={tsumo} onChange={(e) => setTsumo(e.target.checked)} /> tsumo
              </label>
              <label className="flex items-center gap-1 text-emerald-200">
                <input type="checkbox" checked={riichi} onChange={(e) => setRiichi(e.target.checked)} /> riichi
              </label>
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] uppercase text-emerald-300/70">declare yaku ({hand.size})</div>
            <div className="grid grid-cols-3 gap-1.5">
              {YAKU.map((y) => {
                const on = hand.has(y.id);
                return (
                  <button
                    key={y.id}
                    onClick={() => toggleYaku(y.id)}
                    className={[
                      'rounded border p-2 text-left text-xs',
                      on ? 'border-emerald-300 bg-emerald-500/30 text-emerald-50' : 'border-emerald-500/20 bg-emerald-950/30 text-emerald-200 hover:border-emerald-400/50',
                    ].join(' ')}
                  >
                    <div className="font-semibold">{y.label}</div>
                    <div className="text-[9px] opacity-70">+{y.value} pts</div>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={declare}
            disabled={pending || hand.size === 0}
            className="flex w-full items-center justify-center gap-1 rounded bg-emerald-500/30 px-3 py-2 text-sm text-emerald-100 hover:bg-emerald-500/50 disabled:opacity-50"
          >
            {pending ? <Loader2 className="animate-spin" size={14} /> : <Hand size={14} />} Declare hand
          </button>
        </div>
      ) : (
        <div className="space-y-2 text-center">
          <Sparkles className="mx-auto text-emerald-400" size={28} />
          <div className="font-mono text-4xl text-emerald-100">{result.score}</div>
          <div className="text-xs text-emerald-300/70">
            +{result.xpGained} xp · {result.payload.recognised}/{result.payload.yakuList.length} yaku recognised · ×{result.payload.dealerMult.toFixed(2)} dealer
          </div>
          <button onClick={reset} className="mt-2 rounded bg-emerald-500/30 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-500/50">
            Next hand
          </button>
        </div>
      )}
    </StationOverlayShell>
  );
}
