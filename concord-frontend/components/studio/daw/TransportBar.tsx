'use client';

import { useRef } from 'react';
import {
  Play, Square, Circle, Repeat, Undo2, Redo2, Timer, Upload, Sparkles, Wand2, ChevronLeft, Check, CloudOff, Loader2, AlertTriangle, History, Store,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject } from '@/lib/daw/types';
import type { SaveInfo } from './useStudioProject';
import { useBeatFrame, formatPosition } from './engine-hooks';
import { projectTempoPoints, secondsFromBeat, TEMPO_MAX, TEMPO_MIN } from '@/lib/daw/tempo-map';
import type { TransportState } from '@/lib/daw/playback-engine';

export interface TransportBarProps {
  project: DAWProject;
  transport: TransportState;
  recording: boolean;
  metronome: boolean;
  countInBars: number;
  save: SaveInfo;
  canUndo: boolean;
  canRedo: boolean;
  onBack: () => void;
  onPlay: () => void;
  onStop: () => void;
  onRecord: () => void;
  onToggleLoop: () => void;
  onToggleMetronome: () => void;
  onCountIn: (bars: number) => void;
  onBpm: (bpm: number) => void;
  onRename: (title: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveNow: () => void;
  onVersions: () => void;
  onAutoMix: () => void;
  onExport: () => void;
  onPublish: () => void;
  onAskProducer: () => void;
}

function SaveBadge({ save, onClick }: { save: SaveInfo; onClick: () => void }) {
  const map = {
    idle: { icon: Check, text: 'Saved', cls: 'text-zinc-500' },
    saved: { icon: Check, text: save.at ? `Saved ${new Date(save.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved', cls: 'text-emerald-400' },
    unsaved: { icon: Circle, text: 'Unsaved changes', cls: 'text-amber-300' },
    saving: { icon: Loader2, text: 'Saving…', cls: 'text-sky-300' },
    offline: { icon: CloudOff, text: 'Offline — kept on this device', cls: 'text-amber-300' },
    error: { icon: AlertTriangle, text: 'Save failed — retrying', cls: 'text-red-400' },
  } as const;
  const m = map[save.status];
  const Icon = m.icon;
  return (
    <button onClick={onClick} title={save.error || 'Save now (⌘S)'} className={cn('flex items-center gap-1 text-[11px] whitespace-nowrap', m.cls)} data-testid="studio-save-status">
      <Icon className={cn('h-3 w-3', save.status === 'saving' && 'animate-spin', save.status === 'unsaved' && 'fill-current h-2 w-2')} />
      {m.text}
    </button>
  );
}

function formatClock(sec: number): string {
  const sign = sec < 0 ? '-' : '';
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  return `${sign}${m}:${(a % 60).toFixed(1).padStart(4, '0')}`;
}

export function TransportBar(p: TransportBarProps) {
  const posRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const bpb = p.project.timeSignature?.[0] || 4;
  useBeatFrame((beat) => {
    if (posRef.current) posRef.current.textContent = formatPosition(beat, bpb);
    if (timeRef.current) timeRef.current.textContent = formatClock(secondsFromBeat(projectTempoPoints(p.project), beat));
  });
  const playing = p.transport !== 'stopped';
  const btn = 'h-8 w-8 flex items-center justify-center rounded-md transition-colors';
  return (
    <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-white/5 bg-[#101016] px-2">
      <button onClick={p.onBack} className={cn(btn, 'text-zinc-400 hover:bg-white/5 hover:text-white')} title="Projects">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <input
        value={p.project.title}
        onChange={(e) => p.onRename(e.target.value)}
        className="w-40 truncate rounded bg-transparent px-1 text-sm font-medium text-zinc-100 outline-none focus:bg-white/5"
        aria-label="Song title"
      />
      <SaveBadge save={p.save} onClick={p.onSaveNow} />

      <div className="mx-auto flex items-center gap-1">
        <button onClick={p.onUndo} disabled={!p.canUndo} className={cn(btn, 'text-zinc-400 hover:bg-white/5 disabled:opacity-30')} title="Undo (⌘Z)"><Undo2 className="h-4 w-4" /></button>
        <button onClick={p.onRedo} disabled={!p.canRedo} className={cn(btn, 'text-zinc-400 hover:bg-white/5 disabled:opacity-30')} title="Redo (⇧⌘Z)"><Redo2 className="h-4 w-4" /></button>
        <div className="mx-1 h-6 w-px bg-white/10" />
        <button onClick={playing ? p.onStop : p.onPlay} className={cn(btn, playing ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-200 hover:bg-white/10')} title="Play / Stop (Space)" data-testid="studio-play">
          {playing ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <button onClick={p.onRecord} className={cn(btn, p.recording ? 'bg-red-500 text-white animate-pulse' : 'text-red-400 hover:bg-red-500/15')} title="Record on armed tracks (R)" data-testid="studio-record">
          <Circle className="h-4 w-4 fill-current" />
        </button>
        <button onClick={p.onToggleLoop} className={cn(btn, p.project.transport.loopEnabled ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-500 hover:bg-white/5')} title="Loop (L)"><Repeat className="h-4 w-4" /></button>
        <button onClick={p.onToggleMetronome} className={cn(btn, p.metronome ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-500 hover:bg-white/5')} title="Metronome (K)"><Timer className="h-4 w-4" /></button>
        <select value={p.countInBars} onChange={(e) => p.onCountIn(Number(e.target.value))} className="h-7 rounded bg-white/5 px-1 text-[11px] text-zinc-300 outline-none" title="Count-in before recording">
          <option value={0}>No count-in</option>
          <option value={1}>Count-in 1 bar</option>
          <option value={2}>Count-in 2 bars</option>
        </select>
        <div className="ml-2 flex items-baseline gap-2 rounded-md bg-black/40 px-3 py-1 font-mono tabular-nums">
          <span ref={posRef} className="w-16 text-sm text-zinc-100">1.1.1</span>
          <span ref={timeRef} className="w-12 text-[11px] text-zinc-500">0:00.0</span>
        </div>
        <label className="ml-2 flex items-center gap-1 text-[11px] text-zinc-500">
          <input
            type="number"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            value={p.project.bpm}
            onChange={(e) => { const v = Number(e.target.value); if (v >= TEMPO_MIN && v <= TEMPO_MAX) p.onBpm(v); }}
            className="w-14 rounded bg-white/5 px-1 py-0.5 text-right text-sm text-zinc-100 outline-none"
            aria-label="Tempo (BPM)"
          />
          BPM
        </label>
        <span className="ml-1 text-[11px] text-zinc-500">{p.project.key} {p.project.scale}</span>
      </div>

      <button onClick={p.onVersions} className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 hover:bg-white/5" title="Version history"><History className="h-3.5 w-3.5" /></button>
      <button onClick={p.onAutoMix} className="flex h-8 items-center gap-1.5 rounded-md bg-violet-500/15 px-2.5 text-xs text-violet-200 hover:bg-violet-500/25" title="One-click mix + master" data-testid="studio-automix">
        <Wand2 className="h-3.5 w-3.5" /> Auto Mix
      </button>
      <button onClick={p.onAskProducer} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-zinc-300 hover:bg-white/5" title="Ask producer: write a starting idea as new tracks" data-testid="studio-ask-producer">
        <Sparkles className="h-3.5 w-3.5" /> Ask producer
      </button>
      <button onClick={p.onExport} className="flex h-8 items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 text-xs text-emerald-200 hover:bg-emerald-500/25" title="Render WAV, FLAC, or MP3, with stems, or save the mix to your Concord library" data-testid="studio-export">
        <Upload className="h-3.5 w-3.5" /> Export
      </button>
      <button onClick={p.onPublish} className="flex h-8 items-center gap-1.5 rounded-md bg-violet-500/15 px-2.5 text-xs text-violet-200 hover:bg-violet-500/25" title="Publish this song on the Concord marketplace" data-testid="studio-publish">
        <Store className="h-3.5 w-3.5" /> Publish
      </button>
    </div>
  );
}
