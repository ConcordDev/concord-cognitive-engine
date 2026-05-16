'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Pause, Square, Circle,
  Repeat, Clock, Activity, Zap, Save, Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TransportState, StudioViewType } from '@/lib/daw/types';

interface TransportBarProps {
  transportState: TransportState;
  bpm: number;
  currentBeat: number;
  timeSignature: [number, number];
  projectKey: string;
  projectScale: string;
  genre: string | null;
  loopEnabled: boolean;
  metronome: boolean;
  activeView: StudioViewType;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRecord: () => void;
  onBpmChange: (bpm: number) => void;
  onViewChange: (view: StudioViewType) => void;
  onToggleLoop: () => void;
  onToggleMetronome: () => void;
  onSave: () => void;
  onExport: () => void;
  onMaster: () => void;
  isMastering?: boolean;
  isSaving?: boolean;
}

const VIEW_TABS: { id: StudioViewType; label: string }[] = [
  // Session is the default hero view (Ableton-style clip grid).
  // Leftmost position by design — primary entry point per canonical
  // DAW research; other tabs are per-clip / per-track editors users
  // reach via Session clip-click or directly via these chips.
  { id: 'session', label: 'Session' },
  { id: 'arrange', label: 'Arrange' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'pianoRoll', label: 'Piano Roll' },
  { id: 'drumMachine', label: 'Drums' },
  { id: 'sampler', label: 'Sampler' },
  { id: 'audioEditor', label: 'Audio' },
  { id: 'automation', label: 'Auto' },
  { id: 'mastering', label: 'Master' },
  { id: 'soundboard', label: 'Board' },
  { id: 'instruments', label: 'Synths' },
  { id: 'effects', label: 'FX' },
  { id: 'aiAssistant', label: 'AI' },
];

function formatBeatPosition(beat: number, timeSignature: [number, number]): string {
  const beatsPerBar = timeSignature[0];
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const beatInBar = Math.floor(beat % beatsPerBar) + 1;
  const tick = Math.floor((beat % 1) * 4) + 1;
  return `${bar}.${beatInBar}.${tick}`;
}

function formatTime(beat: number, bpm: number): string {
  const totalSeconds = (beat / bpm) * 60;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function TransportBar({
  transportState,
  bpm,
  currentBeat,
  timeSignature,
  projectKey,
  projectScale,
  genre,
  loopEnabled,
  metronome,
  activeView,
  onPlay,
  onPause,
  onStop,
  onRecord,
  onBpmChange,
  onViewChange,
  onToggleLoop,
  onToggleMetronome,
  onSave,
  onExport,
  onMaster,
  isMastering,
  isSaving,
}: TransportBarProps) {
  const isPlaying = transportState === 'playing';
  const isRecording = transportState === 'recording';
  const [showBpmEdit, setShowBpmEdit] = useState(false);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const bpmRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setBpmInput(String(bpm)); }, [bpm]);

  const handleBpmSubmit = useCallback(() => {
    const val = parseInt(bpmInput, 10);
    if (val >= 20 && val <= 400) onBpmChange(val);
    setShowBpmEdit(false);
  }, [bpmInput, onBpmChange]);

  return (
    <div className="h-12 bg-black/80 border-b border-white/10 flex items-center px-3 gap-2 flex-shrink-0 select-none">
      {/* Transport Controls */}
      <div className="flex items-center gap-1.5">
        <button onClick={onStop} className="w-7 h-7 rounded flex items-center justify-center bg-white/10 text-white hover:bg-white/20" title="Stop">
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={isPlaying ? onPause : onPlay}
          className={cn('w-8 h-8 rounded-full flex items-center justify-center transition-colors', isPlaying ? 'bg-neon-green text-black' : 'bg-white/10 text-white hover:bg-white/20')}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <button
          onClick={onRecord}
          className={cn('w-7 h-7 rounded-full flex items-center justify-center', isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white/10 text-red-400 hover:bg-white/20')}
          title="Record"
        >
          <Circle className="w-3 h-3 fill-current" />
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-white/10" />

      {/* Position & Time */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 px-2 py-1 bg-white/5 rounded font-mono text-xs min-w-[72px]">
          <Clock className="w-3 h-3 text-gray-500" />
          <span className="text-neon-cyan">{formatBeatPosition(currentBeat, timeSignature)}</span>
        </div>
        <div className="px-2 py-1 bg-white/5 rounded font-mono text-xs text-gray-400 min-w-[64px]">
          {formatTime(currentBeat, bpm)}
        </div>
      </div>

      {/* BPM */}
      <div className="flex items-center gap-1 px-2 py-1 bg-white/5 rounded">
        <Activity className="w-3 h-3 text-gray-500" />
        {showBpmEdit ? (
          <input
            ref={bpmRef}
            type="number"
            value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={handleBpmSubmit}
            onKeyDown={e => e.key === 'Enter' && handleBpmSubmit()}
            className="w-12 bg-transparent text-xs font-mono text-white outline-none"
            min={20} max={400}
            autoFocus
          />
        ) : (
          <button onClick={() => { setShowBpmEdit(true); setTimeout(() => bpmRef.current?.select(), 10); }} className="text-xs font-mono hover:text-neon-cyan">
            {bpm} BPM
          </button>
        )}
      </div>

      {/* Key & Scale */}
      <div className="px-2 py-1 bg-white/5 rounded text-xs font-mono">
        {projectKey} {projectScale}
      </div>

      {genre && (
        <div className="px-2 py-1 bg-neon-purple/10 text-neon-purple rounded text-[10px] capitalize">
          {genre}
        </div>
      )}

      {/* Loop & Metronome */}
      <button
        onClick={onToggleLoop}
        className={cn('p-1 rounded', loopEnabled ? 'text-neon-cyan bg-neon-cyan/10' : 'text-gray-500 hover:text-white')}
        title="Loop"
      >
        <Repeat className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onToggleMetronome}
        className={cn('p-1 rounded text-xs font-bold', metronome ? 'text-neon-green bg-neon-green/10' : 'text-gray-500 hover:text-white')}
        title="Metronome"
      >
        M
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* View Tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar max-w-[50%]">
        {VIEW_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onViewChange(tab.id)}
            className={cn(
              'px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors',
              activeView === tab.id
                ? 'bg-neon-cyan/20 text-neon-cyan'
                : 'text-gray-500 hover:text-white hover:bg-white/5'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-white/10" />

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onMaster}
          disabled={isMastering}
          className="flex items-center gap-1 px-2 py-1 bg-neon-green/20 text-neon-green rounded text-[10px] hover:bg-neon-green/30 disabled:opacity-50"
          title="Master"
        >
          <Zap className={cn('w-3 h-3', isMastering && 'animate-pulse')} />
          {isMastering ? 'Mastering...' : 'Master'}
        </button>
        <button onClick={onSave} disabled={isSaving} className="p-1 text-gray-400 hover:text-white disabled:opacity-50" title="Save">
          <Save className="w-3.5 h-3.5" />
        </button>
        <button onClick={onExport} className="p-1 text-gray-400 hover:text-white" title="Export">
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
