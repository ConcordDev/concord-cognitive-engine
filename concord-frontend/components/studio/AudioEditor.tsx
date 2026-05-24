'use client';

import { useState, useRef, useCallback } from 'react';
import { Scissors, Copy, Clipboard, Trash2, Maximize2, TrendingDown, TrendingUp, ArrowLeftRight, Volume2, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { emitAudioDTU } from '@/lib/daw/dtu-hooks';
import type { AudioBuffer as DAWAudioBuffer, AudioEditOperation } from '@/lib/daw/types';

interface AudioEditorProps {
  audioBuffer: DAWAudioBuffer | null;
  waveformPeaks: number[];
  currentPosition: number; // 0-1 normalized
  selection: { start: number; end: number } | null; // 0-1 normalized
  isRecording: boolean;
  onOperation: (op: AudioEditOperation) => void;
  onSeek: (position: number) => void;
  onSelect: (start: number, end: number) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

export function AudioEditor({
  audioBuffer,
  waveformPeaks,
  currentPosition,
  selection,
  isRecording,
  onOperation,
  onSeek,
  onSelect,
  onStartRecording,
  onStopRecording,
}: AudioEditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [zoom, _setZoom] = useState(1);

  const peaks = waveformPeaks.length > 0 ? waveformPeaks : Array.from({ length: 200 }, () => Math.random() * 0.5);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    setIsDragging(true);
    setDragStart(x);
    onSeek(x);
  }, [onSeek]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const start = Math.min(dragStart, x);
    const end = Math.max(dragStart, x);
    if (Math.abs(end - start) > 0.005) {
      onSelect(start, end);
    }
  }, [isDragging, dragStart, onSelect]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleSaveAsDTU = useCallback(() => {
    if (!audioBuffer) return;
    emitAudioDTU({
      bufferId: audioBuffer.id,
      name: audioBuffer.name,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      bpm: audioBuffer.bpm,
      key: audioBuffer.key,
      spectralProfile: audioBuffer.spectralProfile,
    });
  }, [audioBuffer]);

  if (!audioBuffer) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <Volume2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No audio loaded</p>
          <p className="text-xs text-gray-400 mt-1">Select an audio clip or record a new one</p>
          <button
            onClick={onStartRecording}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm mx-auto hover:bg-red-500/30"
          >
            <Mic className="w-4 h-4" />
            Start Recording
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-8 bg-black/40 border-b border-white/10 flex items-center px-3 gap-2 flex-shrink-0">
        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Audio Editor</span>
        <span className="text-[9px] text-gray-400">{audioBuffer.name}</span>
        <span className="text-[9px] text-gray-400">{audioBuffer.duration.toFixed(2)}s &middot; {audioBuffer.sampleRate}Hz &middot; {audioBuffer.channels}ch</span>

        <div className="flex-1" />

        {/* Edit operations */}
        <div className="flex items-center gap-0.5">
          {([
            { op: 'cut' as const, icon: Scissors, label: 'Cut', disabled: !selection },
            { op: 'copy' as const, icon: Copy, label: 'Copy', disabled: !selection },
            { op: 'paste' as const, icon: Clipboard, label: 'Paste', disabled: false },
            { op: 'delete' as const, icon: Trash2, label: 'Delete', disabled: !selection },
          ]).map(item => (
            <button
              key={item.op}
              onClick={() => onOperation({ type: item.op })}
              disabled={item.disabled}
              className="p-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              title={item.label}
            >
              <item.icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-0.5">
          {([
            { op: 'fadeIn' as const, icon: TrendingUp, label: 'Fade In' },
            { op: 'fadeOut' as const, icon: TrendingDown, label: 'Fade Out' },
            { op: 'normalize' as const, icon: Maximize2, label: 'Normalize' },
            { op: 'reverse' as const, icon: ArrowLeftRight, label: 'Reverse' },
          ]).map(item => (
            <button
              key={item.op}
              onClick={() => onOperation({ type: item.op })}
              className="p-1 text-gray-400 hover:text-white"
              title={item.label}
            >
              <item.icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/10" />

        <button
          onClick={handleSaveAsDTU}
          className="text-[10px] px-2 py-0.5 bg-neon-cyan/10 text-neon-cyan rounded hover:bg-neon-cyan/20"
        >
          Save as DTU
        </button>

        <button
          onClick={isRecording ? onStopRecording : onStartRecording}
          className={cn('flex items-center gap-1 text-[10px] px-2 py-0.5 rounded', isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20')}
        >
          <Mic className="w-3 h-3" />
          {isRecording ? 'Stop' : 'Record'}
        </button>
      </div>

      {/* Waveform overview */}
      <div className="h-6 bg-black/30 border-b border-white/10 relative flex-shrink-0">
        <div className="absolute inset-0 flex items-center">
          {peaks.map((peak, i) => (
            <div
              key={i}
              className="flex-1 flex items-center justify-center"
            >
              <div className="w-full bg-neon-cyan/20" style={{ height: `${peak * 100}%` }} />
            </div>
          ))}
        </div>
        {/* Viewport indicator */}
        <div className="absolute top-0 bottom-0 bg-white/10 border border-white/20 rounded" style={{ left: '0%', width: `${100 / zoom}%` }} />
      </div>

      {/* Main waveform */}
      <div
        className="flex-1 bg-lattice-deep relative cursor-crosshair overflow-hidden"
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Selection highlight */}
        {selection && (
          <div
            className="absolute top-0 bottom-0 bg-neon-cyan/10 border-l border-r border-neon-cyan/30"
            style={{ left: `${selection.start * 100}%`, width: `${(selection.end - selection.start) * 100}%` }}
          />
        )}

        {/* Waveform */}
        <div className="absolute inset-0 flex items-center">
          {peaks.map((peak, i) => {
            const h = peak * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-center" style={{ height: '100%' }}>
                <div
                  className="w-full bg-gradient-to-t from-neon-cyan/40 to-neon-cyan/60 rounded-t-[1px]"
                  style={{ height: `${h / 2}%` }}
                />
                <div
                  className="w-full bg-gradient-to-b from-neon-cyan/40 to-neon-cyan/60 rounded-b-[1px]"
                  style={{ height: `${h / 2}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* Center line */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/10" />

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-neon-green z-10 pointer-events-none"
          style={{ left: `${currentPosition * 100}%` }}
        >
          <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-neon-green rounded-full" />
        </div>

        {/* Time markers */}
        {Array.from({ length: Math.ceil(audioBuffer.duration) + 1 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 h-3 border-l border-white/10"
            style={{ left: `${(i / audioBuffer.duration) * 100}%` }}
          >
            <span className="text-[7px] text-gray-600 ml-0.5">{i}s</span>
          </div>
        ))}
      </div>

      {/* Info bar */}
      <div className="h-6 bg-black/40 border-t border-white/10 flex items-center px-3 gap-4 text-[9px] text-gray-400 flex-shrink-0">
        <span>Duration: {audioBuffer.duration.toFixed(3)}s</span>
        <span>Sample Rate: {audioBuffer.sampleRate}Hz</span>
        <span>Channels: {audioBuffer.channels}</span>
        {audioBuffer.bpm && <span>BPM: {audioBuffer.bpm}</span>}
        {audioBuffer.key && <span>Key: {audioBuffer.key}</span>}
        {selection && (
          <span className="text-neon-cyan">
            Selection: {(selection.start * audioBuffer.duration).toFixed(3)}s - {(selection.end * audioBuffer.duration).toFixed(3)}s
            ({((selection.end - selection.start) * audioBuffer.duration).toFixed(3)}s)
          </span>
        )}
      </div>
    </div>
  );
}
