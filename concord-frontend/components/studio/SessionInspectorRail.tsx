'use client';

// SessionInspectorRail — right rail of the Session workspace. The
// canonical Logic Pro "Inspector" pattern: when a clip is selected,
// shows clip props + a row of macro knobs. When a track is selected,
// shows the device chain + Pro Tools-style insert slots. Hidden when
// nothing selected — never an empty panel.

import { Music2, Layers, Sliders, Settings, X, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWTrack } from '@/lib/daw/types';

interface SelectedClip {
  trackId: string;
  sceneId: string;
  assetId?: string;
  label?: string;
  durationBeats?: number;
  color?: string;
}

interface SessionInspectorRailProps {
  className?: string;
  selectedClip: SelectedClip | null;
  selectedTrack: DAWTrack | null;
  onCloseInspector?: () => void;
  onUpdateClip?: (patch: Partial<SelectedClip>) => void;
  onDeleteClip?: () => void;
  onUpdateTrack?: (patch: Partial<DAWTrack>) => void;
}

function Knob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (v: number) => void;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex flex-col items-center gap-1 text-center">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="w-full accent-cyan-400 h-1"
        style={{ background: `linear-gradient(to right, rgb(34,211,238) 0%, rgb(34,211,238) ${pct}%, rgb(63,63,70) ${pct}%, rgb(63,63,70) 100%)` }}
      />
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
      <span className="text-[11px] font-mono text-zinc-300">{format ? format(value) : value.toFixed(2)}</span>
    </label>
  );
}

export default function SessionInspectorRail({
  className,
  selectedClip,
  selectedTrack,
  onCloseInspector,
  onUpdateClip,
  onDeleteClip,
  onUpdateTrack,
}: SessionInspectorRailProps) {
  const hasSelection = !!(selectedClip || selectedTrack);

  return (
    <aside className={cn('flex flex-col bg-zinc-900/60 border-l border-white/10 overflow-hidden', className)}>
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400">
          Inspector
        </div>
        {hasSelection && onCloseInspector && (
          <button
            onClick={onCloseInspector}
            className="text-zinc-400 hover:text-zinc-300"
            aria-label="Close inspector"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!hasSelection && (
          <div className="px-3 py-8 text-center text-xs text-zinc-400">
            <Layers className="w-6 h-6 mx-auto mb-2 opacity-40" />
            Click a clip or track to edit
          </div>
        )}

        {selectedClip && (
          <div className="p-3 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Music2 className="w-3.5 h-3.5 text-cyan-300" />
                <h3 className="text-xs font-semibold text-zinc-200">Clip</h3>
              </div>
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400">Name</span>
                  <input
                    value={selectedClip.label || ''}
                    onChange={(e) => onUpdateClip?.({ label: e.target.value })}
                    placeholder="(unnamed clip)"
                    className="mt-1 w-full px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:border-white/30"
                  />
                </label>
                <div className="text-[10px] text-zinc-400">
                  Asset: <span className="font-mono text-zinc-400">{selectedClip.assetId || '—'}</span>
                </div>
                <div className="text-[10px] text-zinc-400">
                  Length: {selectedClip.durationBeats ?? '?'} beats
                </div>
              </div>
            </div>

            {/* Smart Controls (4-knob macro row) */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="w-3.5 h-3.5 text-amber-300" />
                <h3 className="text-xs font-semibold text-zinc-200">Smart Controls</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Knob label="Volume" value={0.75} format={(v) => `${Math.round(v * 100)}%`} />
                <Knob label="Pan" value={0} min={-1} max={1} format={(v) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`} />
                <Knob label="Pitch" value={0} min={-12} max={12} step={1} format={(v) => v > 0 ? `+${v}` : `${v}`} />
                <Knob label="Filter" value={0.5} format={(v) => `${Math.round(v * 100)}%`} />
              </div>
            </div>

            {onDeleteClip && (
              <button
                onClick={onDeleteClip}
                className="w-full inline-flex items-center justify-center gap-2 px-2 py-1.5 text-xs rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete clip
              </button>
            )}
          </div>
        )}

        {selectedTrack && !selectedClip && (
          <div className="p-3 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-3.5 h-3.5 text-violet-300" />
                <h3 className="text-xs font-semibold text-zinc-200">Track</h3>
              </div>
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-400">Name</span>
                  <input
                    value={selectedTrack.name || ''}
                    onChange={(e) => onUpdateTrack?.({ name: e.target.value })}
                    className="mt-1 w-full px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-zinc-200 focus:outline-none focus:border-white/30"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-400">
                  <div>Type: <span className="text-zinc-300">{selectedTrack.type || 'audio'}</span></div>
                  <div>Color: <span className="inline-block w-3 h-3 align-middle rounded-sm" style={{ background: selectedTrack.color || '#334155' }} /></div>
                </div>
              </div>
            </div>

            {/* Device chain — Pro Tools insert slot strip */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="w-3.5 h-3.5 text-emerald-300" />
                <h3 className="text-xs font-semibold text-zinc-200">Inserts</h3>
              </div>
              <ol className="space-y-1">
                {(selectedTrack.effectChain || []).slice(0, 6).map((fx, i) => (
                  <li key={fx.id || i} className="flex items-center justify-between px-2 py-1.5 text-[11px] bg-black/30 border border-white/10 rounded">
                    <span className="text-zinc-300 truncate">{fx.type || `Insert ${i + 1}`}</span>
                    <span className={cn('text-[10px]', fx.enabled ? 'text-emerald-400' : 'text-zinc-600')}>
                      {fx.enabled ? 'on' : 'off'}
                    </span>
                  </li>
                ))}
                {(selectedTrack.effectChain || []).length === 0 && (
                  <li className="px-2 py-2 text-[11px] text-zinc-400 border border-dashed border-white/10 rounded text-center">
                    No inserts
                  </li>
                )}
              </ol>
            </div>

            {/* Mixer micro */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="w-3.5 h-3.5 text-amber-300" />
                <h3 className="text-xs font-semibold text-zinc-200">Mix</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Knob
                  label="Volume"
                  value={Number(selectedTrack.volume ?? 0.75)}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => onUpdateTrack?.({ volume: v })}
                />
                <Knob
                  label="Pan"
                  value={Number(selectedTrack.pan ?? 0)}
                  min={-1} max={1}
                  format={(v) => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`}
                  onChange={(v) => onUpdateTrack?.({ pan: v })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
