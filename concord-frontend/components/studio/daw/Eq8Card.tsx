'use client';

import { Power, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EffectInstance } from '@/lib/daw/types';
import { EQ8_TYPES, eq8Params, readEqBands, type EqBand } from '@/lib/daw/dsp/eq-bands';

const SLOPES = [12, 24, 48];

function writeBand(bands: EqBand[], i: number, patch: Partial<EqBand>): EqBand[] {
  return bands.map((b, n) => (n === i ? { ...b, ...patch } : b));
}

/** Eight real bands. Legacy eq8 devices that only store a 3-band curve never open this card. */
export function Eq8Card({ fx, onChange, onRemove, onMove }: {
  fx: EffectInstance;
  onChange: (fx: EffectInstance, key?: string) => void;
  onRemove?: () => void;
  onMove?: (d: -1 | 1) => void;
}) {
  const bands = readEqBands(fx.params);
  const set = (next: EqBand[], key: string) => onChange({ ...fx, params: eq8Params(next) }, key);
  return (
    <div className={cn('flex w-72 flex-shrink-0 flex-col rounded-lg border bg-[#17171f] p-2', fx.enabled ? 'border-white/10' : 'border-white/5 opacity-50')} data-testid="studio-eq8">
      <div className="mb-1 flex items-center gap-1">
        <button type="button" onClick={() => onChange({ ...fx, enabled: !fx.enabled })} className={cn('rounded p-0.5', fx.enabled ? 'text-emerald-400' : 'text-zinc-600')} title="Bypass" aria-label="Bypass 8-band EQ"><Power className="h-3 w-3" /></button>
        <span className="flex-1 truncate text-[11px] font-medium text-zinc-200">{fx.name}</span>
        {onMove && <button type="button" onClick={() => onMove(-1)} className="text-zinc-500 hover:text-white" title="Move earlier" aria-label="Move 8-band EQ earlier"><ChevronLeft className="h-3 w-3" /></button>}
        {onMove && <button type="button" onClick={() => onMove(1)} className="text-zinc-500 hover:text-white" title="Move later" aria-label="Move 8-band EQ later"><ChevronRight className="h-3 w-3" /></button>}
        {onRemove && <button type="button" onClick={onRemove} className="text-zinc-500 hover:text-red-400" title="Remove" aria-label="Remove 8-band EQ"><X className="h-3 w-3" /></button>}
      </div>
      <div className="space-y-1 overflow-y-auto">
        {bands.map((b, i) => {
          const cut = b.type === 'highpass' || b.type === 'lowpass';
          return (
            <div key={i} className="grid grid-cols-[3.2rem_1fr] items-center gap-1 text-[10px] text-zinc-400">
              <label className="sr-only" htmlFor={`eq8-${fx.id}-${i}-type`}>Band {i + 1} type</label>
              <select id={`eq8-${fx.id}-${i}-type`} aria-label={`Band ${i + 1} type`} value={b.type} onChange={(e) => set(writeBand(bands, i, { type: e.target.value as EqBand['type'] }), `eq8-${fx.id}-${i}-type`)} className="rounded bg-black/40 px-0.5 py-0.5 text-[10px] text-zinc-200">
                {EQ8_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-1">
                <input aria-label={`Band ${i + 1} frequency`} type="range" min={20} max={20000} step={1} value={b.freq} onChange={(e) => set(writeBand(bands, i, { freq: Number(e.target.value) }), `eq8-${fx.id}-${i}-f`)} className="h-1 min-w-0 flex-1 accent-violet-400" />
                {!cut && <input aria-label={`Band ${i + 1} gain`} type="range" min={-24} max={24} step={0.5} value={b.gain} onChange={(e) => set(writeBand(bands, i, { gain: Number(e.target.value) }), `eq8-${fx.id}-${i}-g`)} className="h-1 w-10 accent-violet-400" />}
                <input aria-label={`Band ${i + 1} Q`} type="range" min={0.1} max={12} step={0.05} value={b.q} onChange={(e) => set(writeBand(bands, i, { q: Number(e.target.value) }), `eq8-${fx.id}-${i}-q`)} className="h-1 w-8 accent-violet-400" />
                {cut && (
                  <select aria-label={`Band ${i + 1} slope`} value={b.slope} onChange={(e) => set(writeBand(bands, i, { slope: Number(e.target.value) }), `eq8-${fx.id}-${i}-s`)} className="rounded bg-black/40 text-[10px] text-zinc-200">
                    {SLOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
