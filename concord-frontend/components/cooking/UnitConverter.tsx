'use client';

/**
 * UnitConverter — the lens's unit-conversion surface (the derived set's
 * absent row; R5's pre-filed references are its pins):
 *   1 cup = 236.6 ml · 1 tbsp = 3 tsp · 350°F = 177°C.
 * Deterministic kitchen conversions across volume, weight, and
 * temperature. Pure arithmetic — no server round-trip, nothing stored.
 */

import { useMemo, useState } from 'react';
import { ArrowLeftRight, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

export type UnitGroup = 'volume' | 'weight' | 'temperature';

// Ratio tables to a group base unit (ml / g). Temperature is affine and
// handled separately.
export const UNIT_FACTORS: Record<Exclude<UnitGroup, 'temperature'>, Record<string, number>> = {
  volume: {
    tsp: 4.92892159375,
    tbsp: 14.78676478125, // = 3 tsp exactly
    'fl oz': 29.5735295625,
    cup: 236.5882365, // the pre-filed reference: 1 cup = 236.6 ml
    ml: 1,
    l: 1000,
  },
  weight: {
    g: 1,
    kg: 1000,
    oz: 28.349523125,
    lb: 453.59237,
  },
};

export const GROUP_UNITS: Record<UnitGroup, string[]> = {
  volume: ['tsp', 'tbsp', 'fl oz', 'cup', 'ml', 'l'],
  weight: ['g', 'kg', 'oz', 'lb'],
  temperature: ['°F', '°C'],
};

/** Convert `value` between two units of one group. Temperature is affine. */
export function convertUnit(group: UnitGroup, value: number, from: string, to: string): number | null {
  if (!Number.isFinite(value)) return null;
  if (group === 'temperature') {
    if (from === to) return value;
    return from === '°F' ? ((value - 32) * 5) / 9 : (value * 9) / 5 + 32;
  }
  const table = UNIT_FACTORS[group];
  const f = table[from];
  const t = table[to];
  if (f == null || t == null) return null;
  return (value * f) / t;
}

/** Display rounding: 3 significant decimals max, no float64 tails. */
export function formatConverted(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const rounded = Math.round(v * 1000) / 1000;
  return String(rounded);
}

const GROUP_LABEL: Record<UnitGroup, string> = { volume: 'Volume', weight: 'Weight', temperature: 'Temperature' };

export function UnitConverter() {
  const [group, setGroup] = useState<UnitGroup>('volume');
  const [from, setFrom] = useState('cup');
  const [to, setTo] = useState('ml');
  const [amount, setAmount] = useState('1');

  const pickGroup = (g: UnitGroup) => {
    setGroup(g);
    if (g === 'volume') { setFrom('cup'); setTo('ml'); setAmount('1'); }
    else if (g === 'weight') { setFrom('oz'); setTo('g'); setAmount('1'); }
    else { setFrom('°F'); setTo('°C'); setAmount('350'); }
  };

  const value = useMemo(() => convertUnit(group, parseFloat(amount), from, to), [group, amount, from, to]);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-3" aria-label="Unit converter">
      <h3 className="font-semibold flex items-center gap-2">
        <Scale className="w-4 h-4 text-orange-400" /> Unit converter
      </h3>
      <div className="flex gap-1" role="tablist" aria-label="Conversion kind">
        {(Object.keys(GROUP_UNITS) as UnitGroup[]).map((g) => (
          <button
            key={g}
            role="tab"
            aria-selected={group === g}
            onClick={() => pickGroup(g)}
            className={cn('px-2.5 py-1 text-xs rounded border', group === g ? 'bg-orange-500/15 text-orange-300 border-orange-500/30' : 'text-gray-400 border-transparent hover:text-white')}
          >
            {GROUP_LABEL[g]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
          className="w-24 px-2 py-1.5 text-sm bg-lattice-deep border border-lattice-border rounded text-white font-mono"
        />
        <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From unit" className="px-2 py-1.5 text-sm rounded border bg-lattice-deep text-white border-lattice-border">
          {GROUP_UNITS[group].map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <button
          onClick={() => { setFrom(to); setTo(from); }}
          aria-label="Swap units"
          className="p-1.5 rounded border border-white/10 text-gray-300 hover:bg-white/[0.05]"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To unit" className="px-2 py-1.5 text-sm rounded border bg-lattice-deep text-white border-lattice-border">
          {GROUP_UNITS[group].map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <span className="text-sm text-white" role="status">
          = <span className="font-mono text-orange-300">{formatConverted(value)}</span> {to}
        </span>
      </div>
      <p className="text-[11px] text-gray-500">Kitchen references: 1 cup = 236.6 ml · 1 tbsp = 3 tsp · 350°F = 177°C.</p>
    </section>
  );
}

export default UnitConverter;
