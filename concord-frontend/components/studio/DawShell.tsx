'use client';

/**
 * DawShell — Logic Pro + Ableton Live 12-shape silhouette.
 *
 * Top transport bar with BPM + time-sig + record + play, three-column
 * main: track header rail left, clip grid timeline middle, mixer
 * channel strip column right. Drop into the studio lens above the
 * existing workbench and the page reads as a DAW inside 200ms.
 */

import React from 'react';
import {
  Play, Square, Circle, SkipBack, Repeat,
  Music, Drum, Mic, Volume2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DawTrack {
  id: string;
  name: string;
  kind: 'audio' | 'midi' | 'drum' | 'aux' | 'bus' | 'master';
  colour?: string;
  volume?: number;  // 0..1
  pan?: number;     // -1..1
  muted?: boolean;
  solo?: boolean;
  armed?: boolean;
}

export interface DawClip {
  id: string;
  trackId: string;
  name: string;
  kind: 'audio' | 'midi' | 'drum';
  startBeats: number;
  lengthBeats: number;
  colour?: string;
  muted?: boolean;
}

export interface DawScene { id: string; name: string }

export interface DawShellProps {
  projectName: string;
  bpm: number;
  timeSignatureNum: number;
  timeSignatureDen: number;
  isPlaying: boolean;
  isRecording: boolean;
  positionBeats: number;
  tracks: DawTrack[];
  clips: DawClip[];
  scenes?: DawScene[];
  onPlay?: () => void;
  onStop?: () => void;
  onRecord?: () => void;
  onLaunchScene?: (sceneId: string) => void;
  // Optional transport/track handlers. When omitted the corresponding button
  // renders disabled (a presentational silhouette shouldn't expose controls
  // that silently do nothing).
  loopEnabled?: boolean;
  onToggleLoop?: () => void;
  onToggleMute?: (trackId: string) => void;
  onToggleSolo?: (trackId: string) => void;
  onToggleArm?: (trackId: string) => void;
  className?: string;
}

const TRACK_KIND_ICON: Record<DawTrack['kind'], typeof Music> = {
  audio: Mic, midi: Music, drum: Drum, aux: Volume2, bus: Volume2, master: Volume2,
};

const BEATS_VISIBLE = 32;
const PX_PER_BEAT = 24;

export function DawShell({
  projectName, bpm, timeSignatureNum, timeSignatureDen,
  isPlaying, isRecording, positionBeats,
  tracks, clips, scenes = [],
  onPlay, onStop, onRecord, onLaunchScene,
  loopEnabled, onToggleLoop, onToggleMute, onToggleSolo, onToggleArm,
  className,
}: DawShellProps) {
  return (
    <div className={cn('flex flex-col bg-[#0d1117] text-gray-100 rounded-lg overflow-hidden border border-violet-500/20', className)}>
      {/* Transport bar */}
      <header className="px-4 py-2 border-b border-white/10 bg-[#0a0c10] flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button aria-label="Skip to start" onClick={onStop} className="p-1.5 rounded hover:bg-white/10 text-gray-300"><SkipBack className="w-3.5 h-3.5" /></button>
          <button aria-label="Stop" onClick={onStop} className="p-1.5 rounded hover:bg-white/10 text-gray-300"><Square className="w-3.5 h-3.5" /></button>
          <button aria-label="Play" onClick={onPlay} className={cn('p-1.5 rounded hover:bg-white/10', isPlaying ? 'bg-emerald-500/30 text-emerald-300' : 'text-gray-300')}><Play className="w-3.5 h-3.5" /></button>
          <button aria-label="Record" onClick={onRecord} className={cn('p-1.5 rounded hover:bg-white/10', isRecording ? 'bg-rose-500/30 text-rose-300 animate-pulse' : 'text-gray-300')}><Circle className={cn('w-3.5 h-3.5', isRecording && 'fill-rose-300')} /></button>
          <button aria-label="Loop" onClick={onToggleLoop} disabled={!onToggleLoop} className={cn('p-1.5 rounded hover:bg-white/10', loopEnabled ? 'bg-violet-500/30 text-violet-300' : 'text-gray-300', !onToggleLoop && 'opacity-40 cursor-not-allowed')}><Repeat className="w-3.5 h-3.5" /></button>
        </div>
        <div className="font-mono text-sm tabular-nums text-violet-300">
          {Math.floor(positionBeats / timeSignatureNum) + 1}.{Math.floor(positionBeats % timeSignatureNum) + 1}.{Math.floor((positionBeats * 4) % 4) + 1}
        </div>
        <div className="text-[11px] text-gray-400 font-mono">
          {bpm} BPM · {timeSignatureNum}/{timeSignatureDen}
        </div>
        <div className="ml-auto text-xs text-gray-400">{projectName}</div>
      </header>

      <div className="flex" style={{ height: 340 }}>
        {/* Track header rail */}
        <aside className="w-44 border-r border-white/10 flex flex-col">
          <div className="px-2 py-1.5 border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-400">Tracks</div>
          <ul className="flex-1 overflow-y-auto">
            {tracks.map(t => {
              const Icon = TRACK_KIND_ICON[t.kind] || Music;
              return (
                <li key={t.id} className="px-2 py-1.5 border-b border-white/5 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1 h-6 rounded" style={{ backgroundColor: t.colour || '#22d3ee' }} />
                    <Icon className="w-3 h-3 text-gray-400" />
                    <span className="flex-1 text-xs text-white truncate">{t.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-0.5">
                    <button aria-label="Mute track" onClick={onToggleMute ? () => onToggleMute(t.id) : undefined} disabled={!onToggleMute} className={cn('w-5 h-4 rounded text-[9px] font-bold', t.muted ? 'bg-amber-500 text-black' : 'bg-white/5 text-gray-400', !onToggleMute && 'opacity-40 cursor-not-allowed')}>M</button>
                    <button aria-label="Solo track" onClick={onToggleSolo ? () => onToggleSolo(t.id) : undefined} disabled={!onToggleSolo} className={cn('w-5 h-4 rounded text-[9px] font-bold', t.solo ? 'bg-yellow-500 text-black' : 'bg-white/5 text-gray-400', !onToggleSolo && 'opacity-40 cursor-not-allowed')}>S</button>
                    <button aria-label="Arm track for recording" onClick={onToggleArm ? () => onToggleArm(t.id) : undefined} disabled={!onToggleArm} className={cn('w-5 h-4 rounded text-[9px] font-bold', t.armed ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/5 text-gray-400', !onToggleArm && 'opacity-40 cursor-not-allowed')}>R</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Timeline + clips */}
        <div className="flex-1 overflow-x-auto relative">
          {/* Ruler */}
          <div className="sticky top-0 z-10 bg-[#0a0c10] border-b border-white/10 flex" style={{ width: BEATS_VISIBLE * PX_PER_BEAT, height: 22 }}>
            {Array.from({ length: BEATS_VISIBLE / timeSignatureNum }).map((_, i) => (
              <div key={i} className="border-r border-white/10 text-[9px] text-gray-400 px-1 font-mono" style={{ width: timeSignatureNum * PX_PER_BEAT }}>
                {i + 1}
              </div>
            ))}
          </div>
          {/* Tracks rows */}
          <div style={{ width: BEATS_VISIBLE * PX_PER_BEAT }}>
            {tracks.map(t => (
              <div key={t.id} className="relative border-b border-white/5" style={{ height: 50 }}>
                {/* Beat grid */}
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${BEATS_VISIBLE}, ${PX_PER_BEAT}px)` }}>
                  {Array.from({ length: BEATS_VISIBLE }).map((_, i) => (
                    <div key={i} className={cn('border-r', i % timeSignatureNum === 0 ? 'border-white/10' : 'border-white/5')} />
                  ))}
                </div>
                {/* Clips */}
                {clips.filter(c => c.trackId === t.id).map(c => (
                  <div
                    key={c.id}
                    className={cn('absolute top-1 bottom-1 rounded border border-white/20 px-1.5 py-1 text-[10px] font-medium truncate cursor-pointer', c.muted && 'opacity-40')}
                    style={{
                      left: c.startBeats * PX_PER_BEAT,
                      width: Math.max(20, c.lengthBeats * PX_PER_BEAT - 2),
                      backgroundColor: c.colour || t.colour || '#22d3ee',
                      color: '#0a0c10',
                    }}
                    title={`${c.name} · ${c.lengthBeats} beats`}
                  >
                    {c.kind === 'midi' ? '♪ ' : c.kind === 'drum' ? '◉ ' : '〰️ '}{c.name}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-px bg-violet-400 z-20 pointer-events-none"
            style={{ left: positionBeats * PX_PER_BEAT }}
          />
        </div>

        {/* Scenes column (Ableton) */}
        {scenes.length > 0 && (
          <aside className="w-32 border-l border-white/10 flex flex-col">
            <div className="px-2 py-1.5 border-b border-white/10 text-[10px] uppercase tracking-wider text-gray-400">Scenes</div>
            <ul className="flex-1 overflow-y-auto">
              {scenes.map(sc => (
                <li key={sc.id} className="px-2 py-1 border-b border-white/5">
                  <button onClick={() => onLaunchScene?.(sc.id)} className="w-full flex items-center gap-1 px-1.5 py-1 rounded bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 text-xs">
                    <Play className="w-2.5 h-2.5" />
                    <span className="truncate">{sc.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

export default DawShell;
