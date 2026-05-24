'use client';

import { useState, useCallback, useRef } from 'react';
import { PenTool, MousePointer2, Eraser, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { emitAutomationDrawn } from '@/lib/daw/dtu-hooks';
import type { AutomationLane, AutomationPoint, DAWTrack } from '@/lib/daw/types';

interface AutomationViewProps {
  track: DAWTrack | null;
  lanes: AutomationLane[];
  currentBeat: number;
  lengthBeats: number;
  zoomLevel: number;
  projectId: string;
  onAddLane: (trackId: string, parameterPath: string, parameterName: string) => void;
  onRemoveLane: (trackId: string, laneId: string) => void;
  onToggleLane: (trackId: string, laneId: string) => void;
  onAddPoint: (trackId: string, laneId: string, point: AutomationPoint) => void;
  onUpdatePoint: (trackId: string, laneId: string, pointId: string, data: Partial<AutomationPoint>) => void;
  onDeletePoint: (trackId: string, laneId: string, pointId: string) => void;
}

type AutoTool = 'select' | 'draw' | 'erase';

const AUTOMATABLE_PARAMS = [
  { path: 'volume', name: 'Volume', min: -60, max: 6 },
  { path: 'pan', name: 'Pan', min: -1, max: 1 },
  { path: 'effectChain[0].wet', name: 'FX1 Wet', min: 0, max: 1 },
  { path: 'effectChain[0].params.frequency', name: 'FX1 Freq', min: 20, max: 20000 },
  { path: 'effectChain[0].params.resonance', name: 'FX1 Res', min: 0, max: 20 },
  { path: 'effectChain[1].wet', name: 'FX2 Wet', min: 0, max: 1 },
  { path: 'filter.frequency', name: 'Filter Freq', min: 20, max: 20000 },
  { path: 'filter.resonance', name: 'Filter Res', min: 0, max: 20 },
];

const LANE_COLORS = ['#00fff7', '#a855f7', '#ec4899', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#14b8a6'];
const BEAT_WIDTH = 30;

export function AutomationView({
  track,
  lanes,
  currentBeat,
  lengthBeats,
  zoomLevel,
  projectId,
  onAddLane,
  onRemoveLane,
  onToggleLane,
  onAddPoint,
  onUpdatePoint,
  onDeletePoint,
}: AutomationViewProps) {
  const [tool, setTool] = useState<AutoTool>('draw');
  const [_selectedLaneId, _setSelectedLaneId] = useState<string | null>(null);
  const [showAddParam, setShowAddParam] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const beatWidth = BEAT_WIDTH * zoomLevel;
  const laneHeight = 120;
  const totalWidth = lengthBeats * beatWidth;

  const handleCanvasClick = useCallback((e: React.MouseEvent, laneId: string) => {
    if (tool !== 'draw' || !canvasRef.current || !track) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beat = x / beatWidth;
    const value = 1 - (y / laneHeight);

    const point: AutomationPoint = {
      id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      beat: Math.max(0, beat),
      value: Math.max(0, Math.min(1, value)),
      curve: 'linear',
    };

    onAddPoint(track.id, laneId, point);

    // Emit DTU for automation curve
    const lane = lanes.find(l => l.id === laneId);
    if (lane) {
      emitAutomationDrawn(
        { parameterPath: lane.parameterPath, parameterName: lane.parameterName },
        lane.points.length + 1,
        track.id,
        projectId
      );
    }
  }, [tool, track, beatWidth, laneHeight, lanes, projectId, onAddPoint]);

  const [draggingPoint, setDraggingPoint] = useState<{ laneId: string; pointId: string } | null>(null);

  const handlePointMouseDown = useCallback((e: React.MouseEvent, laneId: string, pointId: string) => {
    e.stopPropagation();
    if (tool === 'erase' && track) {
      onDeletePoint(track.id, laneId, pointId);
    } else if (tool === 'select') {
      setDraggingPoint({ laneId, pointId });
    }
  }, [tool, track, onDeletePoint]);

  const handlePointDrag = useCallback((e: React.MouseEvent, laneId: string) => {
    if (!draggingPoint || draggingPoint.laneId !== laneId || !track) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const beat = Math.max(0, x / beatWidth);
    const value = Math.max(0, Math.min(1, 1 - (y / laneHeight)));
    onUpdatePoint(track.id, laneId, draggingPoint.pointId, { beat, value });
  }, [draggingPoint, track, beatWidth, laneHeight, onUpdatePoint]);

  const handlePointDragEnd = useCallback(() => {
    setDraggingPoint(null);
  }, []);

  if (!track) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <PenTool className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a track to edit automation</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-8 bg-black/40 border-b border-white/10 flex items-center px-3 gap-2 flex-shrink-0">
        <span className="text-[10px] text-gray-400 font-semibold">Automation — {track.name}</span>

        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-0.5">
          {([
            { id: 'select' as const, icon: MousePointer2, label: 'Select' },
            { id: 'draw' as const, icon: PenTool, label: 'Draw' },
            { id: 'erase' as const, icon: Eraser, label: 'Erase' },
          ]).map(t => (
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

        <div className="flex-1" />

        <button
          onClick={() => setShowAddParam(!showAddParam)}
          className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-neon-purple/10 text-neon-purple rounded hover:bg-neon-purple/20"
        >
          <Plus className="w-3 h-3" /> Add Parameter
        </button>
      </div>

      {/* Add parameter dropdown */}
      {showAddParam && (
        <div className="bg-black/60 border-b border-white/10 p-2 flex flex-wrap gap-1">
          {AUTOMATABLE_PARAMS.filter(p => !lanes.some(l => l.parameterPath === p.path)).map(param => (
            <button
              key={param.path}
              onClick={() => {
                onAddLane(track.id, param.path, param.name);
                setShowAddParam(false);
              }}
              className="px-2 py-1 rounded text-[10px] bg-white/5 border border-white/10 hover:border-neon-purple/30 hover:text-neon-purple"
            >
              {param.name}
            </button>
          ))}
        </div>
      )}

      {/* Automation lanes */}
      <div className="flex-1 overflow-auto" ref={canvasRef}>
        {lanes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <PenTool className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No automation lanes</p>
              <p className="text-[10px] text-gray-600 mt-1">Click &quot;Add Parameter&quot; to start automating</p>
            </div>
          </div>
        ) : (
          lanes.map((lane, laneIdx) => (
            <div key={lane.id} className="border-b border-white/10">
              {/* Lane header */}
              <div className="h-6 bg-black/40 flex items-center px-2 gap-2 sticky left-0">
                <button
                  onClick={() => onToggleLane(track.id, lane.id)}
                  className={cn('p-0.5', lane.visible ? 'text-white' : 'text-gray-600')}
                >
                  {lane.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                </button>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: lane.color || LANE_COLORS[laneIdx % LANE_COLORS.length] }} />
                <span className="text-[10px] font-medium flex-1">{lane.parameterName}</span>
                <span className="text-[8px] text-gray-500">{lane.points.length} pts</span>
                <button
                  onClick={() => onRemoveLane(track.id, lane.id)}
                  className="p-0.5 text-gray-600 hover:text-red-400"
                aria-label="Delete">
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>

              {/* Lane canvas */}
              {lane.visible && (
                <div
                  className="relative bg-black/20 cursor-crosshair"
                  style={{ height: laneHeight, width: totalWidth, minWidth: '100%' }}
                  onClick={(e) => handleCanvasClick(e, lane.id)}
                  onMouseMove={(e) => handlePointDrag(e, lane.id)}
                  onMouseUp={handlePointDragEnd}
                  onMouseLeave={handlePointDragEnd} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  {/* Beat grid */}
                  {Array.from({ length: Math.ceil(lengthBeats / 4) }).map((_, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-l border-white/[0.05]"
                      style={{ left: i * 4 * beatWidth }}
                    />
                  ))}

                  {/* Automation curve */}
                  {lane.points.length > 0 && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
                      <polyline
                        points={
                          lane.points
                            .sort((a, b) => a.beat - b.beat)
                            .map(p => `${p.beat * beatWidth},${(1 - p.value) * laneHeight}`)
                            .join(' ')
                        }
                        fill="none"
                        stroke={lane.color || LANE_COLORS[laneIdx % LANE_COLORS.length]}
                        strokeWidth="1.5"
                        opacity="0.7"
                      />
                      {/* Fill under curve */}
                      <polygon
                        points={
                          `0,${laneHeight} ` +
                          lane.points
                            .sort((a, b) => a.beat - b.beat)
                            .map(p => `${p.beat * beatWidth},${(1 - p.value) * laneHeight}`)
                            .join(' ') +
                          ` ${(lane.points.at(-1)?.beat ?? 0) * beatWidth},${laneHeight}`
                        }
                        fill={lane.color || LANE_COLORS[laneIdx % LANE_COLORS.length]}
                        opacity="0.1"
                      />
                    </svg>
                  )}

                  {/* Points */}
                  {lane.points.map(point => (
                    <div
                      key={point.id}
                      className={cn(
                        'absolute w-2.5 h-2.5 rounded-full border-2 cursor-pointer hover:scale-150 transition-transform z-10',
                        tool === 'erase' ? 'hover:bg-red-500' : 'hover:bg-white'
                      )}
                      style={{
                        left: point.beat * beatWidth - 5,
                        top: (1 - point.value) * laneHeight - 5,
                        backgroundColor: lane.color || LANE_COLORS[laneIdx % LANE_COLORS.length],
                        borderColor: 'white',
                      }}
                      onMouseDown={(e) => handlePointMouseDown(e, lane.id, point.id)}
                      title={`Beat: ${point.beat.toFixed(2)} | Value: ${(point.value * 100).toFixed(0)}%`}
                    />
                  ))}

                  {/* Playhead */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-neon-cyan pointer-events-none"
                    style={{ left: currentBeat * beatWidth }}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
