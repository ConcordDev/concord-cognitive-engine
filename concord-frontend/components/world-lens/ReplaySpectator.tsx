'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';

// ── Types ──────────────────────────────────────────────────────────

type ReplayMode = 'spectator' | 'replay' | 'record' | 'timelapse';

interface ReplayEvent {
  timestamp: number;
  type: 'build' | 'validate' | 'place' | 'destroy' | 'weather' | 'disaster' | 'milestone';
  actorId: string;
  description: string;
  position?: { x: number; y: number; z: number };
}

interface ReplayRecording {
  id: string;
  worldId: string;
  startTime: string;
  endTime: string;
  events: ReplayEvent[];
  duration: number;
}

interface CameraKeyframe {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number };
  zoom: number;
  timestamp: number;
}

interface ReplaySpectatorProps {
  mode?: ReplayMode;
  recording?: ReplayRecording | null;
  replay?: ReplayRecording | null;
  spectatorCount?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  onRecord?: (action: 'start' | 'stop') => void;
  onShare?: (replayId: string) => void;
  onSpeedChange?: (speed: number) => void;
}

// ── Constants ──────────────────────────────────────────────────────
// NOTE: There is no world build-replay/recording backend (no `replay` domain
// or recorded-event-stream macro). The live spectator COUNT is real
// (`spectator.list_for_world`); the replay timeline itself has no source, so
// it stays empty until a recording backend exists.
// TODO: wire the replay recording to backend once a world-replay domain exists.

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];

const DEFAULT_WORLD_ID = 'concordia-hub';

// ── Component ──────────────────────────────────────────────────────

export default function ReplaySpectator({
  mode = 'replay',
  recording: _recording = null,
  replay = null,
  spectatorCount: spectatorCountProp,
  onPlay,
  onPause,
  onSeek,
  onRecord,
  onShare,
  onSpeedChange,
}: ReplaySpectatorProps) {
  const [currentMode, setCurrentMode] = useState<ReplayMode>(mode);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isRecording, setIsRecording] = useState(false);
  const [showEventList, setShowEventList] = useState(true);
  const [cameraKeyframes, setCameraKeyframes] = useState<CameraKeyframe[]>([]);
  // Real live spectator count from the backend (falls back to caller's prop).
  const [spectatorCount, setSpectatorCount] = useState<number>(spectatorCountProp ?? 0);
  const scrubberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof spectatorCountProp === 'number') return; // caller supplied it
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<{ spectators?: unknown[] }>('spectator', 'list_for_world', { worldId: DEFAULT_WORLD_ID });
        if (cancelled) return;
        const list = r.data?.ok ? r.data.result?.spectators : null;
        setSpectatorCount(Array.isArray(list) ? list.length : 0);
      } catch {
        if (!cancelled) setSpectatorCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [spectatorCountProp]);

  // No replay-recording backend → null means "no replay available".
  const activeReplay = replay;
  const duration = activeReplay?.duration ?? 0;

  const handlePlayPause = useCallback(() => {
    if (isPlaying) { onPause?.(); } else { onPlay?.(); }
    setIsPlaying(!isPlaying);
  }, [isPlaying, onPlay, onPause]);

  const handleSeek = useCallback((time: number) => {
    setCurrentTime(time);
    onSeek?.(time);
  }, [onSeek]);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s);
    onSpeedChange?.(s);
  }, [onSpeedChange]);

  const handleRecord = useCallback(() => {
    const action = isRecording ? 'stop' : 'start';
    setIsRecording(!isRecording);
    onRecord?.(action);
  }, [isRecording, onRecord]);

  const addCameraKeyframe = useCallback(() => {
    setCameraKeyframes(prev => [...prev, {
      position: { x: 0, y: 10, z: 0 }, rotation: { x: -45, y: 0 },
      zoom: 1, timestamp: currentTime,
    }]);
  }, [currentTime]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const eventTypeColors: Record<string, string> = {
    build: 'text-blue-400', validate: 'text-green-400', place: 'text-cyan-400',
    destroy: 'text-red-400', weather: 'text-gray-400', disaster: 'text-orange-400', milestone: 'text-yellow-400',
  };

  const eventTypeIcons: Record<string, string> = {
    build: '🔨', validate: '✅', place: '📍', destroy: '💥', weather: '🌧', disaster: '🌋', milestone: '⭐',
  };

  const visibleEvents = (activeReplay?.events ?? []).filter(e => e.timestamp <= currentTime);

  return (
    <div className="bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['spectator', 'replay', 'record', 'timelapse'] as const).map(m => (
            <button key={m} onClick={() => setCurrentMode(m)}
              className={`px-3 py-1 rounded text-xs capitalize ${currentMode === m ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'}`}
            >{m}</button>
          ))}
        </div>
        {currentMode === 'spectator' && (
          <span className="text-xs text-white/50">👁 {spectatorCount} spectating</span>
        )}
      </div>

      {/* Recording Indicator */}
      {currentMode === 'record' && (
        <div className="flex items-center gap-3">
          <button onClick={handleRecord}
            className={`flex items-center gap-2 px-4 py-2 rounded ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-red-800 hover:bg-red-700'} text-white text-sm`}>
            <span className={`w-3 h-3 rounded-full ${isRecording ? 'bg-white' : 'bg-red-400'}`} />
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>
          {isRecording && <span className="text-xs text-red-400">Recording... {formatTime(currentTime)}</span>}
        </div>
      )}

      {/* No-replay empty state */}
      {(currentMode === 'replay' || currentMode === 'timelapse') && !activeReplay && (
        <div className="py-10 text-center text-xs text-white/40">No replay available yet.</div>
      )}

      {/* Timeline / Scrubber */}
      {(currentMode === 'replay' || currentMode === 'timelapse') && activeReplay && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button onClick={handlePlayPause} className="text-white hover:text-white/80 text-lg w-8 text-center">
              {isPlaying ? '⏸' : '▶'}
            </button>
            <span className="text-xs text-white/60 w-12">{formatTime(currentTime)}</span>
            <input ref={scrubberRef} type="range" min={0} max={duration} value={currentTime}
              onChange={e => handleSeek(Number(e.target.value))}
              className="flex-1 h-1 accent-blue-500 bg-white/20 rounded cursor-pointer" />
            <span className="text-xs text-white/60 w-12 text-right">{formatTime(duration)}</span>
          </div>

          {/* Speed Controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50">Speed:</span>
            {SPEED_OPTIONS.map(s => (
              <button key={s} onClick={() => handleSpeedChange(s)}
                className={`px-2 py-0.5 rounded text-xs ${speed === s ? 'bg-blue-600 text-white' : 'bg-white/10 text-white/50 hover:text-white'}`}
              >{s}x</button>
            ))}
          </div>

          {/* Event markers on timeline */}
          <div className="relative h-4 bg-white/5 rounded">
            {(activeReplay?.events ?? []).map((evt, i) => (
              <div key={i}
                className="absolute w-1.5 h-full rounded-full cursor-pointer hover:opacity-100 opacity-70"
                style={{
                  left: `${(evt.timestamp / duration) * 100}%`,
                  backgroundColor: evt.type === 'disaster' ? '#f59e0b' : evt.type === 'milestone' ? '#eab308' : evt.type === 'validate' ? '#22c55e' : '#3b82f6',
                }}
                title={evt.description}
                onClick={() => handleSeek(evt.timestamp)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
            ))}
            {/* Playhead */}
            <div className="absolute w-0.5 h-full bg-white" style={{ left: `${(currentTime / duration) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Event List */}
      {showEventList && (currentMode === 'replay' || currentMode === 'spectator') && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold text-white/70 uppercase">Events</h4>
            <button onClick={() => setShowEventList(false)} className="text-xs text-white/30 hover:text-white/50">Hide</button>
          </div>
          {(currentMode === 'replay' ? visibleEvents : (activeReplay?.events ?? [])).length === 0 && (
            <p className="text-xs text-white/30">No events yet.</p>
          )}
          {(currentMode === 'replay' ? visibleEvents : (activeReplay?.events ?? [])).map((evt, i) => (
            <div key={i} className={`flex items-start gap-2 p-1.5 rounded text-xs ${evt.timestamp <= currentTime ? 'bg-white/5' : 'opacity-30'}`}
              onClick={() => currentMode === 'replay' && handleSeek(evt.timestamp)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <span>{eventTypeIcons[evt.type] || '•'}</span>
              <div className="flex-1 min-w-0">
                <span className={eventTypeColors[evt.type] || 'text-white/60'}>{evt.description}</span>
                <span className="text-white/30 ml-2">{formatTime(evt.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Camera Path Editor (Timelapse) */}
      {currentMode === 'timelapse' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-white/70">Camera Keyframes</h4>
            <button onClick={addCameraKeyframe} className="text-xs px-2 py-0.5 bg-white/10 rounded hover:bg-white/20 text-white/70">+ Add Keyframe</button>
          </div>
          {cameraKeyframes.length === 0 ? (
            <p className="text-xs text-white/30">No keyframes. Add keyframes to create a cinematic camera path.</p>
          ) : (
            <div className="space-y-1">
              {cameraKeyframes.map((kf, i) => (
                <div key={i} className="flex items-center justify-between p-1.5 bg-white/5 rounded text-xs text-white/60">
                  <span>KF {i + 1} @ {formatTime(kf.timestamp)}</span>
                  <span>({kf.position.x}, {kf.position.y}, {kf.position.z})</span>
                  <button onClick={() => setCameraKeyframes(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Share Button */}
      {activeReplay && (
        <div className="flex items-center justify-between pt-2 border-t border-white/10">
          <button onClick={() => onShare?.(activeReplay.id)}
            className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-xs text-white rounded">
            Share Replay
          </button>
          <span className="text-xs text-white/30">Replay ID: {activeReplay.id}</span>
        </div>
      )}
    </div>
  );
}
