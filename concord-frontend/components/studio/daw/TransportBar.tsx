'use client';

import { useRef } from 'react';
import {
  Play, Square, Circle, Repeat, Undo2, Redo2, Timer, Upload, Wand2, ChevronLeft, Check, CloudOff, Loader2, AlertTriangle, History, Store,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject } from '@/lib/daw/types';
import type { SaveInfo } from './useStudioProject';
import { useBeatFrame, formatPosition } from './engine-hooks';
import { beatsPerBar, projectTempoPoints, secondsFromBeat, TEMPO_MAX, TEMPO_MIN } from '@/lib/daw/tempo-map';
import type { TransportState } from '@/lib/daw/playback-engine';
import type { ClipKeyResult } from '@/lib/daw/dsp/pitch/key-detect';
import { KeyScaleControl } from './KeyScaleControl';
import { RoomSwitch } from '../booth/RoomSwitch';
import type { Room } from '../booth/rooms';

export interface TransportBarProps {
  project: DAWProject;
  room: Room;
  onRoom: (room: Room) => void;
  transport: TransportState;
  recording: boolean;
  metronome: boolean;
  save: SaveInfo;
  canUndo: boolean;
  canRedo: boolean;
  onBack: () => void;
  onPlay: () => void;
  onStop: () => void;
  onRecord: () => void;
  onToggleLoop: () => void;
  onToggleMetronome: () => void;
  onBpm: (bpm: number) => void;
  onTimeSignature: (beats: number, unit: number) => void;
  onKeyScale: (key: string, scale: string, scaleMask: number | undefined) => void;
  onDetectKey: () => Promise<ClipKeyResult>;
  onRename: (title: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveNow: () => void;
  onVersions: () => void;
  onAutoMix: () => void;
  onExport: () => void;
  onPublish: () => void;
}

function SaveBadge({ save, onClick }: { save: SaveInfo; onClick: () => void }) {
  const map = {
    idle: { icon: Check, text: 'Saved', cls: 'text-zinc-500' },
    saved: { icon: Check, text: save.at ? `Saved ${new Date(save.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved', cls: 'text-emerald-400' },
    unsaved: { icon: Circle, text: 'Unsaved changes', cls: 'text-amber-300' },
    saving: { icon: Loader2, text: 'Saving…', cls: 'text-sky-300' },
    offline: { icon: CloudOff, text: 'Offline — kept on this device', cls: 'text-amber-300' },
    error: { icon: AlertTriangle, text: save.error || 'Save failed — retrying', cls: 'text-red-400' },
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
  const bpb = beatsPerBar(p.project.timeSignature);
  const sigBeats = Math.max(1, Math.min(16, Math.round(p.project.timeSignature?.[0] || 4)));
  const sigUnit = [1, 2, 4, 8, 16].includes(p.project.timeSignature?.[1]) ? p.project.timeSignature[1] : 4;
  useBeatFrame((beat) => {
    if (posRef.current) posRef.current.textContent = formatPosition(beat, bpb);
    if (timeRef.current) timeRef.current.textContent = formatClock(secondsFromBeat(projectTempoPoints(p.project), beat));
  });
  const playing = p.transport !== 'stopped';
  const btn = 'h-8 w-8 flex items-center justify-center rounded-md transition-colors';
  return (
    // FIX-music-002: below lg the bar wraps into stacked rows — as one
    // fixed h-12 row its ~1,300px of controls pushed the tempo field to
    // x≈752, off a 390px viewport entirely. lg+ keeps the single row.
    <div className="bo-metal flex min-h-14 flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-2 py-1.5 2xl:h-14 2xl:flex-nowrap 2xl:py-0" data-testid="booth-console">
      <button onClick={p.onBack} className={cn(btn, 'text-zinc-400 hover:bg-white/5 hover:text-white')} title="Projects">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <input
        value={p.project.title}
        onChange={(e) => p.onRename(e.target.value)}
        className="bo-scribble w-28 truncate px-2 py-0.5 text-base outline-none focus:ring-1 focus:ring-[var(--bo-amber)] sm:w-44"
        aria-label="Song title"
      />
      <SaveBadge save={p.save} onClick={p.onSaveNow} />
      <RoomSwitch room={p.room} onRoom={p.onRoom} />

      <div className="order-last flex w-full flex-wrap items-center justify-center gap-1 2xl:order-none 2xl:mx-auto 2xl:w-auto 2xl:flex-nowrap">
        <button onClick={p.onUndo} disabled={!p.canUndo} className={cn(btn, 'text-zinc-400 hover:bg-white/5 disabled:opacity-30')} title="Undo (⌘Z)" aria-label="Undo"><Undo2 className="h-4 w-4" /></button>
        <button onClick={p.onRedo} disabled={!p.canRedo} className={cn(btn, 'text-zinc-400 hover:bg-white/5 disabled:opacity-30')} title="Redo (⇧⌘Z)" aria-label="Redo"><Redo2 className="h-4 w-4" /></button>
        <div className="mx-1 h-6 w-px bg-white/10" />
        <button onClick={playing ? p.onStop : p.onPlay} className={cn(btn, playing ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-200 hover:bg-white/10')} title="Play / Stop (Space)" aria-label={playing ? 'Stop' : 'Play'} data-testid="studio-play">
          {playing ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <button onClick={p.onRecord} className={cn(btn, 'bo-key w-auto gap-1.5 px-2')} title="Record on armed tracks (R)" aria-label="Record" aria-pressed={p.recording} data-testid="studio-record">
          <span className="bo-rec-light h-3 w-3 rounded-full" data-on={p.recording ? 'true' : 'false'} aria-hidden />
          <span className="bo-on-air text-[11px]" data-on={p.recording ? 'true' : 'false'}>{p.recording ? 'On air' : 'Rec'}</span>
        </button>
        <button onClick={p.onToggleLoop} className={cn(btn, p.project.transport.loopEnabled ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-500 hover:bg-white/5')} title="Loop (L)" aria-label="Loop" aria-pressed={p.project.transport.loopEnabled}><Repeat className="h-4 w-4" /></button>
        <button onClick={p.onToggleMetronome} className={cn(btn, p.metronome ? 'bg-amber-500/20 text-amber-300' : 'text-zinc-500 hover:bg-white/5')} title="Metronome (K)" aria-label="Metronome" aria-pressed={p.metronome}><Timer className="h-4 w-4" /></button>
        <div className="bo-well ml-2 flex items-baseline gap-2 rounded-md px-3 py-1" data-testid="booth-counter">
          <span ref={posRef} className="bo-led w-16 text-base">1.1.1</span>
          <span ref={timeRef} className="bo-led w-12 text-[11px] opacity-70">0:00.0</span>
        </div>
        <label className="ml-2 flex items-center gap-1 text-[11px] text-zinc-400">
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
        <label className="flex items-center gap-0.5 text-[11px] text-zinc-400">
          <input aria-label="Beats per bar" type="number" min={1} max={16} value={sigBeats} onChange={(e) => p.onTimeSignature(Number(e.target.value), sigUnit)} className="w-8 rounded bg-white/5 px-0.5 py-0.5 text-right text-sm text-zinc-100 outline-none" />
          /
          <select aria-label="Beat unit" value={sigUnit} onChange={(e) => p.onTimeSignature(sigBeats, Number(e.target.value))} className="rounded bg-white/5 px-0.5 py-0.5 text-sm text-zinc-100 outline-none">
            {[2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <KeyScaleControl project={p.project} onChange={p.onKeyScale} onDetect={p.onDetectKey} />
      </div>

      <button onClick={p.onVersions} className="ml-auto flex h-8 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 hover:bg-white/5 2xl:ml-0" title="Version history" aria-label="Version history"><History className="h-3.5 w-3.5" /></button>
      <button onClick={p.onAutoMix} className="flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-md bg-violet-500/15 px-2.5 text-xs text-violet-200 hover:bg-violet-500/25" title="One-click mix + master" data-testid="studio-automix">
        <Wand2 className="h-3.5 w-3.5" /> Auto Mix
      </button>
      <button onClick={p.onExport} className="flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-md bg-emerald-500/15 px-2.5 text-xs text-emerald-200 hover:bg-emerald-500/25" title="Render WAV, FLAC, or MP3, with stems, or save the mix to your Concord library" data-testid="studio-export">
        <Upload className="h-3.5 w-3.5" /> Export
      </button>
      <button onClick={p.onPublish} className="flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-md bg-violet-500/15 px-2.5 text-xs text-violet-200 hover:bg-violet-500/25" title="Publish this song on the Concord marketplace" data-testid="studio-publish">
        <Store className="h-3.5 w-3.5" /> Publish
      </button>
    </div>
  );
}
