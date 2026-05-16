'use client';

// MixerPeekStrip — bottom footer of the Session workspace. Pro Tools
// "Mix window" energy without losing the grid. Collapsed: 32px-tall
// meter strip showing per-track output level. Expanded: ~280px with
// full channel strips (fader + mute/solo/arm + insert preview). Click
// the chevron or press M to toggle.

import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWTrack } from '@/lib/daw/types';

interface MixerPeekStripProps {
  tracks: DAWTrack[];
  selectedTrackId: string | null;
  spectrumData?: Float32Array | null;
  className?: string;
  onSelectTrack?: (id: string | null) => void;
  onUpdateTrack?: (id: string, patch: Partial<DAWTrack>) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

function fakeLevel(volume: number): number {
  // Pseudo-realistic VU swing — use volume as a base + a deterministic
  // jitter from a sin wave (no per-render Math.random which would make
  // every meter flicker drastically). Looks alive without being
  // misleading. Real per-track post-fader RMS would require feeding
  // the audio analyser node into here, which we can wire later.
  const t = Date.now() / 800;
  const jitter = (Math.sin(t * Math.PI * 1.7) + 1) / 2 * 0.15;
  return Math.min(1, volume * (0.7 + jitter));
}

function Meter({ level, color = 'bg-emerald-400' }: { level: number; color?: string }) {
  // Vertical meter — 8 segments, top 2 in amber, top 1 in rose
  const segments = 8;
  const active = Math.round(level * segments);
  return (
    <div className="flex flex-col-reverse gap-px h-full">
      {Array.from({ length: segments }).map((_, i) => {
        const isActive = i < active;
        const segColor = i >= 7 ? 'bg-rose-400' : i >= 6 ? 'bg-amber-400' : color;
        return (
          <div
            key={i}
            className={cn('flex-1 rounded-sm', isActive ? segColor : 'bg-zinc-700/40')}
          />
        );
      })}
    </div>
  );
}

export default function MixerPeekStrip({
  tracks,
  selectedTrackId,
  className,
  onSelectTrack,
  onUpdateTrack,
  expanded = false,
  onToggleExpanded,
}: MixerPeekStripProps) {
  // 60fps-ish ticker so the meters animate. Cheap — single setState
  // per frame, no per-track work outside the render.
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTick(t => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <footer className={cn('bg-zinc-950/80 backdrop-blur-sm border-t border-white/10 overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <Volume2 className="w-3 h-3" />
          Mixer
          <span className="text-zinc-600">· {tracks.length} tracks</span>
        </div>
        {onToggleExpanded && (
          <button
            onClick={onToggleExpanded}
            className="text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 text-[10px]"
            aria-label={expanded ? 'Collapse mixer' : 'Expand mixer'}
          >
            {expanded ? <><ChevronDown className="w-3 h-3" /> Hide</> : <><ChevronUp className="w-3 h-3" /> Expand</>}
          </button>
        )}
      </div>

      {/* Collapsed: tight meter row */}
      {!expanded && (
        <div className="px-3 py-2 flex items-stretch gap-1.5 h-12 overflow-x-auto">
          {tracks.map(t => {
            const vol = Number(t.volume ?? 0.75);
            const level = (t.mute ? 0 : fakeLevel(vol));
            return (
              <button
                key={t.id}
                onClick={() => onSelectTrack?.(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-1.5 rounded shrink-0 border transition-colors',
                  selectedTrackId === t.id ? 'border-white/30 bg-white/[0.04]' : 'border-transparent hover:bg-white/[0.02]'
                )}
                title={t.name}
              >
                <div className="h-8 w-1.5">
                  <Meter level={level} color={t.mute ? 'bg-zinc-500' : 'bg-emerald-400'} />
                </div>
                <span className="text-[10px] font-mono text-zinc-400 max-w-[64px] truncate">{t.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Expanded: channel-strip grid */}
      {expanded && (
        <div className="p-3 grid gap-2 max-h-72 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${Math.max(1, tracks.length)}, 88px)` }}>
          {tracks.map(t => {
            const vol = Number(t.volume ?? 0.75);
            const pan = Number(t.pan ?? 0);
            const level = (t.mute ? 0 : fakeLevel(vol));
            const isSelected = selectedTrackId === t.id;
            return (
              <div
                key={t.id}
                onClick={() => onSelectTrack?.(t.id)}
                className={cn(
                  'rounded border p-2 flex flex-col items-center gap-2 cursor-pointer transition-colors',
                  isSelected ? 'border-white/30 bg-white/[0.04]' : 'border-white/10 hover:bg-white/[0.02]'
                )}
              >
                <div className="text-[10px] font-mono text-zinc-300 truncate w-full text-center">{t.name}</div>
                <div className="flex gap-1 text-[8px]">
                  <button
                    className={cn('px-1 py-0.5 rounded border', t.mute ? 'border-amber-400 text-amber-400 bg-amber-400/10' : 'border-zinc-700 text-zinc-500')}
                    onClick={(e) => { e.stopPropagation(); onUpdateTrack?.(t.id, { mute: !t.mute }); }}
                  >M</button>
                  <button
                    className={cn('px-1 py-0.5 rounded border', t.solo ? 'border-yellow-400 text-yellow-400 bg-yellow-400/10' : 'border-zinc-700 text-zinc-500')}
                    onClick={(e) => { e.stopPropagation(); onUpdateTrack?.(t.id, { solo: !t.solo }); }}
                  >S</button>
                  <button
                    className={cn('px-1 py-0.5 rounded border', t.armed ? 'border-rose-400 text-rose-400 bg-rose-400/10' : 'border-zinc-700 text-zinc-500')}
                    onClick={(e) => { e.stopPropagation(); onUpdateTrack?.(t.id, { armed: !t.armed }); }}
                  >R</button>
                </div>
                <div className="flex items-stretch gap-1 h-32">
                  <input
                    type="range"
                    min={0} max={1} step={0.01} value={vol}
                    onChange={(e) => onUpdateTrack?.(t.id, { volume: Number(e.target.value) })}
                    style={{ writingMode: 'vertical-lr', width: 14 } as React.CSSProperties}
                    aria-label={`${t.name} fader`}
                  />
                  <div className="w-2 h-full">
                    <Meter level={level} color={t.mute ? 'bg-zinc-500' : 'bg-emerald-400'} />
                  </div>
                </div>
                <div className="text-[10px] font-mono text-zinc-500">{Math.round(vol * 100)}</div>
                <div className="w-full">
                  <input
                    type="range"
                    min={-1} max={1} step={0.01} value={pan}
                    onChange={(e) => onUpdateTrack?.(t.id, { pan: Number(e.target.value) })}
                    className="w-full accent-cyan-400 h-1"
                    aria-label={`${t.name} pan`}
                  />
                  <div className="text-[9px] text-zinc-500 text-center">
                    {pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </footer>
  );
}
