'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import type { DAWProject, DAWTrack } from '@/lib/daw/types';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { useBeatFrame } from './engine-hooks';

export const MASTER_ID = '__master__';

export interface MixerPanelProps {
  project: DAWProject;
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
  onTrack: (id: string, patch: Partial<DAWTrack>, key?: string) => void;
  onMasterVolume: (db: number) => void;
  onToggleMastering: () => void;
}

const dbLabel = (v: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : '-∞');

export function MixerPanel(p: MixerPanelProps) {
  const tracks = p.project.tracks.filter((t) => t.type !== 'master');
  const meters = useRef<Map<string, HTMLDivElement>>(new Map());
  const peaks = useRef<Map<string, HTMLSpanElement>>(new Map());
  const hold = useRef<Map<string, { db: number; at: number }>>(new Map());
  useBeatFrame(() => {
    const eng = getStudioEngine();
    const now = performance.now();
    for (const [id, el] of meters.current) {
      const db = id === MASTER_ID ? eng.masterPeakDb() : eng.trackPeakDb(id);
      el.style.height = `${Math.max(0, Math.min(100, ((db + 60) / 66) * 100))}%`;
      el.style.background = db > -0.3 ? '#ef4444' : db > -6 ? '#f59e0b' : '#22c55e';
      const h = hold.current.get(id);
      if (!h || db > h.db || now - h.at > 1500) hold.current.set(id, { db, at: now });
      const lab = peaks.current.get(id);
      const hv = hold.current.get(id)!.db;
      if (lab) { lab.textContent = hv <= -60 ? '' : hv.toFixed(1); lab.style.color = hv > -0.3 ? '#f87171' : '#a1a1aa'; }
    }
  });
  const strip = (id: string, name: string, color: string, vol: number, onVol: (v: number) => void, extra?: React.ReactNode, t?: DAWTrack) => (
    <div key={id} onClick={() => p.onSelectTrack(id)} className={cn('flex w-20 flex-shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5', p.selectedTrackId === id ? 'border-white/30 bg-white/[0.06]' : 'border-white/5 bg-[#15151c]')} data-testid="studio-mixer-strip">
      <div className="h-1 w-full rounded" style={{ background: color }} />
      <div className="w-full truncate text-center text-[10px] text-zinc-300">{name}</div>
      {t && (
        <input type="range" min={-1} max={1} step={0.01} value={t.pan} onChange={(e) => p.onTrack(t.id, { pan: Number(e.target.value) }, `pan-${t.id}`)} onDoubleClick={() => p.onTrack(t.id, { pan: 0 })} className="h-1 w-full accent-zinc-300" title={`Pan ${t.pan === 0 ? 'C' : t.pan < 0 ? `L${Math.round(-t.pan * 100)}` : `R${Math.round(t.pan * 100)}`}`} />
      )}
      <div className="flex h-28 items-end gap-1">
        <input
          type="range" min={-60} max={6} step={0.1}
          value={Number.isFinite(vol) ? Math.max(-60, vol) : -60}
          onChange={(e) => { const v = Number(e.target.value); onVol(v <= -60 ? -Infinity : v); }}
          onDoubleClick={() => onVol(0)}
          className="h-28 w-4 accent-zinc-200"
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          aria-label={`${name} volume`}
        />
        <div className="relative h-28 w-2 overflow-hidden rounded-sm bg-black/60">
          <div ref={(el) => { if (el) meters.current.set(id, el); else meters.current.delete(id); }} className="absolute bottom-0 w-full" />
        </div>
      </div>
      <div className="flex w-full justify-between text-[9px] tabular-nums text-zinc-400">
        <span>{dbLabel(vol)}</span>
        <span ref={(el) => { if (el) peaks.current.set(id, el); else peaks.current.delete(id); }} />
      </div>
      {extra}
    </div>
  );
  return (
    <div className="flex h-full gap-1.5 overflow-x-auto p-2" data-testid="studio-mixer">
      {tracks.map((t) => strip(t.id, t.name, t.color, t.volume, (v) => p.onTrack(t.id, { volume: v }, `vol-${t.id}`), (
        <div className="flex gap-1">
          <button onClick={(e) => { e.stopPropagation(); p.onTrack(t.id, { mute: !t.mute }); }} className={cn('h-5 w-6 rounded text-[10px] font-bold', t.mute ? 'bg-amber-500 text-black' : 'bg-white/5 text-zinc-400')}>M</button>
          <button onClick={(e) => { e.stopPropagation(); p.onTrack(t.id, { solo: !t.solo }); }} className={cn('h-5 w-6 rounded text-[10px] font-bold', t.solo ? 'bg-sky-400 text-black' : 'bg-white/5 text-zinc-400')}>S</button>
        </div>
      ), t))}
      <div className="mx-1 w-px bg-white/10" />
      {strip(MASTER_ID, 'Master', '#e4e4e7', p.project.masterBus.volume, p.onMasterVolume, (
        <button onClick={(e) => { e.stopPropagation(); p.onToggleMastering(); }} className={cn('w-full rounded px-1 py-0.5 text-[9px]', p.project.masteringChain.enabled ? 'bg-violet-500/30 text-violet-100' : 'bg-white/5 text-zinc-500')} title="Mastering chain on/off">
          {p.project.masteringChain.enabled ? 'Mastering on' : 'Mastering off'}
        </button>
      ))}
    </div>
  );
}
