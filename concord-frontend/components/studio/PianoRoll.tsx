'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Pencil, MousePointer2, Eraser, Scissors, BarChart3, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { midiToNoteName } from '@/lib/daw/engine';
import type { MIDINote, DAWClip, SnapMode } from '@/lib/daw/types';

interface PianoRollProps {
  clip: DAWClip | null;
  notes: MIDINote[];
  currentBeat: number;
  clipStartBeat: number;
  clipLengthBeats: number;
  snap: SnapMode;
  onAddNote: (note: MIDINote) => void;
  onUpdateNote: (noteId: string, data: Partial<MIDINote>) => void;
  onDeleteNote: (noteId: string) => void;
  onSnapChange: (snap: SnapMode) => void;
}

type PianoRollTool = 'select' | 'draw' | 'erase' | 'slice' | 'velocity';

const NOTE_HEIGHT = 14;
const BEAT_WIDTH = 40;
const KEY_WIDTH = 48;
const NOTE_RANGE = { low: 24, high: 108 }; // C1 to C8
const TOTAL_NOTES = NOTE_RANGE.high - NOTE_RANGE.low;
const BLACK_KEYS = [1, 3, 6, 8, 10];

function getSnapBeats(snap: SnapMode): number {
  switch (snap) {
    case '1/1': return 4;
    case '1/2': return 2;
    case '1/4': return 1;
    case '1/8': return 0.5;
    case '1/16': return 0.25;
    case '1/32': return 0.125;
    default: return 0;
  }
}

export function PianoRoll({
  clip,
  notes,
  currentBeat,
  clipStartBeat,
  clipLengthBeats,
  snap,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onSnapChange,
}: PianoRollProps) {
  const [tool, setTool] = useState<PianoRollTool>('draw');
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [zoomX, setZoomX] = useState(1);
  const [zoomY, setZoomY] = useState(1);
  const [showVelocity, setShowVelocity] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const beatWidth = BEAT_WIDTH * zoomX;
  const noteHeight = NOTE_HEIGHT * zoomY;
  const totalWidth = clipLengthBeats * beatWidth;
  const totalHeight = TOTAL_NOTES * noteHeight;
  const snapBeats = getSnapBeats(snap);

  const quantize = useCallback((beat: number): number => {
    if (snapBeats <= 0) return beat;
    return Math.round(beat / snapBeats) * snapBeats;
  }, [snapBeats]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (tool !== 'draw' || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const beat = quantize(x / beatWidth);
    const pitch = NOTE_RANGE.high - Math.floor(y / noteHeight);

    if (pitch >= NOTE_RANGE.low && pitch <= NOTE_RANGE.high && beat >= 0 && beat < clipLengthBeats) {
      const noteLength = snapBeats > 0 ? snapBeats : 0.25;
      onAddNote({
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pitch,
        velocity: 100,
        startBeat: beat,
        lengthBeats: noteLength,
        channel: 0,
      });
    }
  }, [tool, beatWidth, noteHeight, clipLengthBeats, snapBeats, quantize, onAddNote]);

  const handleNoteClick = useCallback((e: React.MouseEvent, noteId: string) => {
    e.stopPropagation();
    if (tool === 'erase') {
      onDeleteNote(noteId);
    } else if (tool === 'select') {
      if (e.shiftKey) {
        setSelectedNotes(prev => {
          const next = new Set(prev);
          if (next.has(noteId)) next.delete(noteId);
          else next.add(noteId);
          return next;
        });
      } else {
        setSelectedNotes(new Set([noteId]));
      }
    }
  }, [tool, onDeleteNote]);

  // Scroll to middle C on mount
  useEffect(() => {
    if (scrollRef.current) {
      const middleC = 60;
      const y = (NOTE_RANGE.high - middleC) * noteHeight - scrollRef.current.clientHeight / 2;
      scrollRef.current.scrollTop = Math.max(0, y);
    }
  }, [noteHeight]);

  if (!clip) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a MIDI clip to edit notes</p>
          <p className="text-xs text-gray-600 mt-1">Double-click a clip in the arrangement view</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-8 bg-black/40 border-b border-white/10 flex items-center px-3 gap-2 flex-shrink-0">
        <div className="flex items-center gap-0.5">
          {([
            { id: 'select', icon: MousePointer2, label: 'Select' },
            { id: 'draw', icon: Pencil, label: 'Draw' },
            { id: 'erase', icon: Eraser, label: 'Erase' },
            { id: 'slice', icon: Scissors, label: 'Slice' },
            { id: 'velocity', icon: BarChart3, label: 'Velocity' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={cn('p-1 rounded', tool === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-500 hover:text-white')}
              title={t.label}
            >
              <t.icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-gray-500">Snap:</span>
          {(['off', '1/4', '1/8', '1/16', '1/32'] as SnapMode[]).map(s => (
            <button
              key={s}
              onClick={() => onSnapChange(s)}
              className={cn('px-1.5 py-0.5 rounded', snap === s ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-500 hover:text-white')}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setShowVelocity(!showVelocity)}
          className={cn('text-[10px] px-2 py-0.5 rounded', showVelocity ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-500 hover:text-white')}
        >
          Velocity
        </button>

        <div className="flex items-center gap-1" title="Horizontal Zoom">
          <button onClick={() => setZoomX(Math.max(0.25, zoomX - 0.25))} className="p-0.5 text-gray-500 hover:text-white" aria-label="Zoom out">
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-gray-400 w-8 text-center">{Math.round(zoomX * 100)}%</span>
          <button onClick={() => setZoomX(Math.min(4, zoomX + 0.25))} className="p-0.5 text-gray-500 hover:text-white" aria-label="Zoom in">
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>

        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-1" title="Vertical Zoom">
          <span className="text-[10px] text-gray-500">V:</span>
          <button onClick={() => setZoomY(Math.max(0.5, zoomY - 0.25))} className="p-0.5 text-gray-500 hover:text-white" aria-label="Zoom out">
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-gray-400 w-8 text-center">{Math.round(zoomY * 100)}%</span>
          <button onClick={() => setZoomY(Math.min(3, zoomY + 0.25))} className="p-0.5 text-gray-500 hover:text-white" aria-label="Zoom in">
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Piano keys */}
        <div className="flex-shrink-0 overflow-hidden" style={{ width: KEY_WIDTH }}>
          <div className="overflow-y-hidden" style={{ height: totalHeight }}>
            {Array.from({ length: TOTAL_NOTES }).map((_, i) => {
              const pitch = NOTE_RANGE.high - i;
              const isBlack = BLACK_KEYS.includes(pitch % 12);
              const isC = pitch % 12 === 0;
              return (
                <div
                  key={pitch}
                  className={cn(
                    'border-b border-white/5 flex items-center justify-end pr-1 text-[9px] font-mono',
                    isBlack ? 'bg-black/60 text-gray-500' : 'bg-lattice-deep text-gray-400',
                    isC && 'border-b-white/20 font-bold text-white/60'
                  )}
                  style={{ height: noteHeight }}
                >
                  {(isC || pitch === NOTE_RANGE.high) && midiToNoteName(pitch)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Note grid */}
        <div ref={scrollRef} className="flex-1 overflow-auto relative">
          <div
            ref={canvasRef}
            className="relative"
            style={{ width: totalWidth, height: totalHeight, minWidth: '100%' }}
            onClick={handleCanvasClick}
          >
            {/* Grid lines */}
            {Array.from({ length: TOTAL_NOTES }).map((_, i) => {
              const pitch = NOTE_RANGE.high - i;
              const isBlack = BLACK_KEYS.includes(pitch % 12);
              const isC = pitch % 12 === 0;
              return (
                <div
                  key={`row-${i}`}
                  className={cn(
                    'absolute w-full border-b',
                    isBlack ? 'bg-black/20 border-white/[0.03]' : 'border-white/[0.05]',
                    isC && 'border-b-white/15'
                  )}
                  style={{ top: i * noteHeight, height: noteHeight }}
                />
              );
            })}

            {/* Beat grid lines */}
            {Array.from({ length: Math.ceil(clipLengthBeats) }).map((_, i) => (
              <div
                key={`beat-${i}`}
                className={cn(
                  'absolute top-0 bottom-0 border-l',
                  i % 4 === 0 ? 'border-white/15' : 'border-white/[0.04]'
                )}
                style={{ left: i * beatWidth }}
              />
            ))}

            {/* Notes */}
            {notes.map(note => {
              const isSelected = selectedNotes.has(note.id);
              return (
                <div
                  key={note.id}
                  onClick={e => handleNoteClick(e, note.id)}
                  className={cn(
                    'absolute rounded-[2px] cursor-pointer transition-opacity',
                    isSelected ? 'ring-1 ring-white' : 'hover:brightness-125',
                    tool === 'erase' && 'hover:opacity-50'
                  )}
                  style={{
                    left: note.startBeat * beatWidth,
                    width: Math.max(4, note.lengthBeats * beatWidth - 1),
                    top: (NOTE_RANGE.high - note.pitch) * noteHeight + 1,
                    height: noteHeight - 2,
                    backgroundColor: `hsl(${(note.velocity / 127) * 120}, 80%, ${40 + (note.velocity / 127) * 20}%)`,
                    opacity: 0.5 + (note.velocity / 127) * 0.5,
                  }}
                  title={`${midiToNoteName(note.pitch)} vel:${note.velocity}`}
                />
              );
            })}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-neon-cyan z-10 pointer-events-none"
              style={{ left: (currentBeat - clipStartBeat) * beatWidth }}
            />
          </div>
        </div>
      </div>

      {/* Velocity lane */}
      {showVelocity && (
        <div className="h-24 border-t border-white/10 bg-black/40 flex">
          <div style={{ width: KEY_WIDTH }} className="flex-shrink-0 flex items-center justify-center border-r border-white/10">
            <span className="text-[9px] text-gray-500 -rotate-90">VELOCITY</span>
          </div>
          <div className="flex-1 relative overflow-hidden">
            {notes.map(note => (
              <div
                key={note.id}
                className="absolute bottom-0 cursor-pointer hover:brightness-125"
                style={{
                  left: note.startBeat * beatWidth,
                  width: Math.max(3, note.lengthBeats * beatWidth * 0.5),
                  height: `${(note.velocity / 127) * 100}%`,
                  backgroundColor: `hsl(${(note.velocity / 127) * 120}, 70%, 50%)`,
                }}
                onClick={() => {
                  const newVel = Math.min(127, Math.max(1, note.velocity === 127 ? 80 : note.velocity + 20));
                  onUpdateNote(note.id, { velocity: newVel });
                }}
                title={`Velocity: ${note.velocity}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
