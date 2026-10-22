'use client';

import { useState } from 'react';
import type { AudioAssetMeta, DAWTrack } from '@/lib/daw/types';

const LANE_H = 36;

export interface TakesLanesProps {
  headerWidth: number;
  width: number;
  beatWidth: number;
  track: DAWTrack;
  assets?: Record<string, AudioAssetMeta | undefined>;
  auditionTakeId: string | null;
  onSwipe: (takeId: string, startBeat: number, endBeat: number) => void;
  onAudition: (takeId: string) => void;
  onRename: (takeId: string, name: string) => void;
  onDelete: (takeId: string) => void;
  onStar: (takeId: string) => void;
  onCycle: (beat: number, dir: 1 | -1) => void;
  onFlatten: () => void;
}

export function TakesLanes(p: TakesLanesProps) {
  const takes = p.track.takes || [];
  const [renameId, setRenameId] = useState<string | null>(null);
  const [regionBeat, setRegionBeat] = useState<number | null>(null);
  const beatAt = (clientX: number, lane: HTMLDivElement) => {
    const rect = lane.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / p.beatWidth);
  };

  return (
    <div
      tabIndex={0}
      aria-label={`Takes for ${p.track.name}`}
      className="outline-none"
      onKeyDown={(e) => {
        if (renameId) return;
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && regionBeat != null) {
          e.preventDefault();
          e.stopPropagation();
          p.onCycle(regionBeat, e.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      <div className="flex border-b border-white/5 bg-[#12121a]" style={{ height: 28 }}>
        <div className="sticky left-0 z-10 flex items-center gap-1 border-r border-white/5 bg-[#12121a] px-2" style={{ width: p.headerWidth }}>
          <span className="text-[10px] text-zinc-500">Comp</span>
          <button
            type="button"
            className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-white/20"
            onClick={p.onFlatten}
          >
            Flatten comp
          </button>
        </div>
        <div className="relative" style={{ width: p.width }}>
          {(p.track.comp || []).map((r, i) => (
            <button
              key={`${r.takeId}-${r.startBeat}-${i}`}
              type="button"
              title="Comp region. Arrow keys cycle the take."
              className="absolute top-1 h-4 rounded-sm bg-white/70"
              style={{ left: r.startBeat * p.beatWidth, width: Math.max(4, (r.endBeat - r.startBeat) * p.beatWidth) }}
              onClick={() => setRegionBeat((r.startBeat + r.endBeat) / 2)}
            />
          ))}
        </div>
      </div>
      {takes.length === 0 && (
        <div className="flex border-b border-white/5 text-[10px] text-zinc-600" style={{ height: LANE_H }}>
          <div className="sticky left-0 border-r border-white/5 bg-[#14141b] px-2 leading-9" style={{ width: p.headerWidth }}>No takes yet</div>
        </div>
      )}
      {takes.map((take) => {
        const compHere = (p.track.comp || []).filter((r) => r.takeId === take.id);
        const audition = p.auditionTakeId === take.id;
        return (
          <div key={take.id} className="flex border-b border-white/5" style={{ height: LANE_H }} data-testid="studio-take-lane">
            <div className="sticky left-0 z-10 flex items-center gap-1 border-r border-white/5 bg-[#14141b] px-1.5" style={{ width: p.headerWidth }}>
              {renameId === take.id ? (
                <input
                  autoFocus
                  aria-label={`Rename ${take.name}`}
                  defaultValue={take.name}
                  className="min-w-0 flex-1 rounded bg-black/50 px-1 text-[10px] text-white outline-none"
                  onBlur={(e) => { p.onRename(take.id, e.target.value); setRenameId(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }}
                />
              ) : (
                <button type="button" className="min-w-0 flex-1 truncate text-left text-[10px] text-zinc-300" onDoubleClick={() => setRenameId(take.id)} onClick={() => p.onAudition(take.id)}>
                  {take.rating === 1 ? '★ ' : ''}{take.name}
                </button>
              )}
              <button type="button" aria-label={take.rating === 1 ? `Unstar ${take.name}` : `Star ${take.name}`} className="text-[11px] text-amber-300" onClick={() => p.onStar(take.id)}>{take.rating === 1 ? '★' : '☆'}</button>
              <button type="button" aria-label={`Delete ${take.name}`} className="text-[10px] text-zinc-500 hover:text-red-300" onClick={() => p.onDelete(take.id)}>✕</button>
            </div>
            <div
              className="relative cursor-crosshair"
              title={p.assets?.[take.audioBufferId] ? `${take.name}, ${p.assets[take.audioBufferId]!.duration.toFixed(1)} seconds. Drag to comp. Click to audition.` : 'Drag across the lane to comp this take. Click to audition.'}
              style={{ width: p.width, background: audition ? 'rgba(56,189,248,0.08)' : undefined }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const lane = e.currentTarget;
                const origin = beatAt(e.clientX, lane);
                let latest = origin;
                let moved = false;
                const move = (ev: PointerEvent) => {
                  latest = beatAt(ev.clientX, lane);
                  if (Math.abs(latest - origin) > 0.05) moved = true;
                };
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  if (!moved) {
                    p.onAudition(take.id);
                    return;
                  }
                  const a = Math.min(origin, latest);
                  const b = Math.max(origin, latest);
                  setRegionBeat((a + b) / 2);
                  p.onSwipe(take.id, a, b);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up, { once: true });
              }}
            >
              <div
                className="absolute top-1 h-6 rounded-sm bg-white/10"
                style={{ left: take.startBeat * p.beatWidth, width: Math.max(4, take.lengthBeats * p.beatWidth) }}
              />
              {compHere.map((r, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute top-1 h-6 rounded-sm"
                  style={{ left: r.startBeat * p.beatWidth, width: Math.max(4, (r.endBeat - r.startBeat) * p.beatWidth), background: `${p.track.color}cc` }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
