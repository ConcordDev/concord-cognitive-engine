'use client';

import { useRef, useCallback, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWTrack, ArrangementSection, ArrangementMarker, SnapMode } from '@/lib/daw/types';

interface ArrangementViewProps {
  tracks: DAWTrack[];
  sections: ArrangementSection[];
  markers: ArrangementMarker[];
  currentBeat: number;
  bpm: number;
  lengthBars: number;
  timeSignature: [number, number];
  selectedTrackId: string | null;
  selectedClipId: string | null;
  zoomLevel: number;
  snap: SnapMode;
  onSelectTrack: (id: string | null) => void;
  onSelectClip: (id: string | null) => void;
  onUpdateTrack: (trackId: string, data: Partial<DAWTrack>) => void;
  onDeleteTrack: (trackId: string) => void;
  onAddTrack: () => void;
  onMoveClip: (clipId: string, trackId: string, startBeat: number) => void;
  onResizeClip: (clipId: string, lengthBeats: number) => void;
  onSeek: (beat: number) => void;
  onZoomChange: (level: number) => void;
  onSnapChange: (snap: SnapMode) => void;
}

const BEAT_WIDTH = 30; // px per beat at zoom 1
const TRACK_HEADER_WIDTH = 192;
const RULER_HEIGHT = 28;

export function ArrangementView({
  tracks,
  sections,
  markers: _markers,
  currentBeat,
  bpm: _bpm,
  lengthBars,
  timeSignature,
  selectedTrackId,
  selectedClipId,
  zoomLevel,
  snap,
  onSelectTrack,
  onSelectClip,
  onUpdateTrack,
  onDeleteTrack,
  onAddTrack,
  onMoveClip,
  onResizeClip,
  onSeek,
  onZoomChange,
  onSnapChange,
}: ArrangementViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    clipId: string;
    trackId: string;
    mode: 'move' | 'resize';
    startX: number;
    origBeat: number;
    origLength: number;
  } | null>(null);

  const handleClipDragStart = useCallback((e: React.MouseEvent, clipId: string, trackId: string, startBeat: number, lengthBeats: number, mode: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    setDragState({ clipId, trackId, mode, startX: e.clientX, origBeat: startBeat, origLength: lengthBeats });
  }, []);

  const handleClipDragMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;
    const deltaX = e.clientX - dragState.startX;
    const deltaBeat = deltaX / (BEAT_WIDTH * zoomLevel);
    if (dragState.mode === 'move') {
      const newStart = Math.max(0, dragState.origBeat + deltaBeat);
      onMoveClip(dragState.clipId, dragState.trackId, Math.round(newStart * 4) / 4);
    } else {
      const newLength = Math.max(1, dragState.origLength + deltaBeat);
      onResizeClip(dragState.clipId, Math.round(newLength * 4) / 4);
    }
  }, [dragState, zoomLevel, onMoveClip, onResizeClip]);

  const handleClipDragEnd = useCallback(() => {
    setDragState(null);
  }, []);

  const beatWidth = BEAT_WIDTH * zoomLevel;
  const beatsPerBar = timeSignature[0];
  const totalBeats = lengthBars * beatsPerBar;

  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const beat = x / beatWidth;
    onSeek(Math.max(0, beat));
  }, [beatWidth, onSeek]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      onZoomChange(Math.max(0.25, Math.min(4, zoomLevel * delta)));
    }
  }, [zoomLevel, onZoomChange]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden" onWheel={handleWheel}>
      {/* Toolbar */}
      <div className="h-8 bg-black/40 border-b border-white/10 flex items-center px-3 gap-3 flex-shrink-0">
        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-gray-500">Snap:</span>
          {(['off', '1/1', '1/2', '1/4', '1/8', '1/16'] as SnapMode[]).map(s => (
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
        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-gray-500">Zoom:</span>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={zoomLevel}
            onChange={e => onZoomChange(parseFloat(e.target.value))}
            className="w-20 h-1 accent-neon-cyan"
          />
          <span className="text-gray-400 w-8">{Math.round(zoomLevel * 100)}%</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Track Headers */}
        <div className="flex-shrink-0 flex flex-col" style={{ width: TRACK_HEADER_WIDTH }}>
          {/* Corner / ruler gutter */}
          <div className="border-b border-r border-white/10 bg-black/60 flex items-center justify-center" style={{ height: RULER_HEIGHT }}>
            <span className="text-[9px] text-gray-500 font-mono">TRACKS</span>
          </div>
          {/* Track headers */}
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {tracks.map(track => (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                className={cn(
                  'border-b border-r border-white/10 bg-black/40 p-1.5 cursor-pointer hover:bg-white/[0.03] transition-colors',
                  selectedTrackId === track.id && 'bg-white/5 border-l-2 border-l-neon-cyan'
                )}
                style={{ height: track.height || 56 }}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: track.color }} />
                  <span className="text-[11px] font-medium truncate flex-1">{track.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteTrack(track.id); }}
                    className="p-0.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                  aria-label="Delete">
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="flex items-center gap-0.5 mt-1">
                  <button
                    onClick={e => { e.stopPropagation(); onUpdateTrack(track.id, { mute: !track.mute }); }}
                    className={cn('px-1 py-0.5 text-[8px] rounded font-bold', track.mute ? 'bg-red-500/30 text-red-400' : 'bg-white/10 text-gray-500')}
                  >
                    M
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onUpdateTrack(track.id, { solo: !track.solo }); }}
                    className={cn('px-1 py-0.5 text-[8px] rounded font-bold', track.solo ? 'bg-yellow-500/30 text-yellow-400' : 'bg-white/10 text-gray-500')}
                  >
                    S
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onUpdateTrack(track.id, { armed: !track.armed }); }}
                    className={cn('px-1 py-0.5 text-[8px] rounded font-bold', track.armed ? 'bg-red-500 text-white' : 'bg-white/10 text-gray-500')}
                  >
                    R
                  </button>
                  <div className="flex-1" />
                  <input
                    type="range"
                    min={-60}
                    max={6}
                    value={track.volume}
                    onChange={e => onUpdateTrack(track.id, { volume: Number(e.target.value) })}
                    onClick={e => e.stopPropagation()}
                    className="w-12 h-0.5 accent-white"
                    title={`${track.volume} dB`}
                  />
                </div>
              </div>
            ))}
            {/* Add track button */}
            <button
              onClick={onAddTrack}
              className="w-full py-2 border-b border-r border-white/10 flex items-center justify-center gap-1.5 text-gray-500 hover:text-white hover:bg-white/5"
            >
              <Plus className="w-3 h-3" />
              <span className="text-[10px]">Add Track</span>
            </button>
          </div>
        </div>

        {/* Timeline Content */}
        <div
          className="flex-1 overflow-auto"
          ref={scrollRef}
          onMouseMove={handleClipDragMove}
          onMouseUp={handleClipDragEnd}
          onMouseLeave={handleClipDragEnd}
        >
          {/* Ruler */}
          <div
            className="sticky top-0 z-10 bg-black/60 border-b border-white/10 cursor-pointer"
            style={{ height: RULER_HEIGHT, width: totalBeats * beatWidth }}
            onClick={handleRulerClick}
          >
            {/* Sections */}
            {sections.map(section => (
              <div
                key={section.id}
                className="absolute top-0 h-3 text-[8px] flex items-center px-1 rounded-b"
                style={{
                  left: section.startBar * beatsPerBar * beatWidth,
                  width: (section.endBar - section.startBar) * beatsPerBar * beatWidth,
                  backgroundColor: section.color + '30',
                  color: section.color,
                }}
              >
                {section.name}
              </div>
            ))}
            {/* Bar numbers */}
            {Array.from({ length: lengthBars }).map((_, i) => (
              <div
                key={i}
                className="absolute bottom-0 text-[9px] text-gray-500 border-l border-white/10 pl-1"
                style={{ left: i * beatsPerBar * beatWidth, height: RULER_HEIGHT / 2 }}
              >
                {i + 1}
              </div>
            ))}
            {/* Playhead on ruler */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-neon-cyan z-20 pointer-events-none"
              style={{ left: currentBeat * beatWidth }}
            />
          </div>

          {/* Track lanes */}
          <div style={{ width: totalBeats * beatWidth }}>
            {tracks.map(track => (
              <div
                key={track.id}
                className={cn('relative border-b border-white/5', selectedTrackId === track.id && 'bg-white/[0.02]')}
                style={{ height: track.height || 56 }}
              >
                {/* Beat grid */}
                {Array.from({ length: lengthBars }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-white/[0.04]"
                    style={{ left: i * beatsPerBar * beatWidth }}
                  />
                ))}

                {/* Clips */}
                {track.clips.map(clip => (
                  <div
                    key={clip.id}
                    onClick={e => { e.stopPropagation(); onSelectClip(clip.id); }}
                    className={cn(
                      'absolute top-1 bottom-1 rounded border cursor-pointer flex items-center px-1.5 text-[10px] truncate group transition-all',
                      selectedClipId === clip.id ? 'ring-1 ring-neon-cyan' : 'hover:brightness-110',
                      clip.midiNotes && clip.midiNotes.length > 0 ? 'border-white/30' : 'border-white/20'
                    )}
                    style={{
                      left: clip.startBeat * beatWidth,
                      width: clip.lengthBeats * beatWidth,
                      backgroundColor: (clip.color || track.color) + '40',
                      borderColor: clip.color || track.color,
                    }}
                  >
                    {/* Mini waveform or note display */}
                    {clip.type === 'midi' && clip.midiNotes && (
                      <div className="absolute inset-0 flex items-end px-0.5 pb-0.5 opacity-40 overflow-hidden">
                        {clip.midiNotes.slice(0, 50).map((note) => (
                          <div
                            key={note.id}
                            className="absolute bg-white/60 rounded-[1px]"
                            style={{
                              left: `${(note.startBeat / clip.lengthBeats) * 100}%`,
                              width: `${Math.max(1, (note.lengthBeats / clip.lengthBeats) * 100)}%`,
                              bottom: `${((note.pitch - 36) / 72) * 100}%`,
                              height: 2,
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <span className="relative z-10 text-white/80">{clip.name}</span>
                    {/* Move handle (left edge) */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-grab opacity-0 group-hover:opacity-100 bg-white/10 z-20"
                      onMouseDown={(e) => handleClipDragStart(e, clip.id, track.id, clip.startBeat, clip.lengthBeats, 'move')}
                    />
                    {/* Resize handle (right edge) */}
                    <div
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/20 z-20"
                      onMouseDown={(e) => handleClipDragStart(e, clip.id, track.id, clip.startBeat, clip.lengthBeats, 'resize')}
                    />
                  </div>
                ))}

                {/* Playhead line */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-neon-cyan/60 pointer-events-none z-10"
                  style={{ left: currentBeat * beatWidth }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
