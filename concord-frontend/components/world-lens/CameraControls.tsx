'use client';

import React, { useState, useCallback } from 'react';
import {
  Camera, RotateCw, ZoomIn, ZoomOut, Maximize2, User, Eye,
  Play, Pause, SkipBack, SkipForward, Monitor, ChevronDown,
} from 'lucide-react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type CameraMode = 'isometric' | 'follow' | 'first-person' | 'free' | 'interior' | 'cinematic';
export type ZoomLevel = 'world' | 'district' | 'neighborhood' | 'building' | 'interior';
export type RotationAngle = 'NE' | 'SE' | 'SW' | 'NW';
export type FollowTarget = 'avatar' | 'npc' | 'event';

export interface CameraState {
  mode: CameraMode;
  zoom: number;
  rotation: RotationAngle;
  followTarget: FollowTarget;
  cinematicPlaying: boolean;
  cinematicTime: number;
  cinematicDuration: number;
  transitioning: boolean;
}

interface CameraControlsProps {
  cameraState: CameraState;
  onModeChange: (mode: CameraMode) => void;
  onZoom: (level: number) => void;
  onRotate: (angle: RotationAngle) => void;
  onTransition: (state: Partial<CameraState>) => void;
}

// ── Constants ─────────────────────────────────────────────────────

const cameraModes: { mode: CameraMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'isometric', label: 'Isometric', icon: <Monitor className="w-3.5 h-3.5" /> },
  { mode: 'follow', label: 'Follow', icon: <User className="w-3.5 h-3.5" /> },
  { mode: 'first-person', label: 'First Person', icon: <Eye className="w-3.5 h-3.5" /> },
  { mode: 'free', label: 'Free', icon: <Maximize2 className="w-3.5 h-3.5" /> },
  { mode: 'interior', label: 'Interior', icon: <Eye className="w-3.5 h-3.5" /> },
  { mode: 'cinematic', label: 'Cinematic', icon: <Camera className="w-3.5 h-3.5" /> },
];

const zoomLevels: { level: ZoomLevel; min: number; max: number }[] = [
  { level: 'world', min: 0, max: 20 },
  { level: 'district', min: 20, max: 40 },
  { level: 'neighborhood', min: 40, max: 60 },
  { level: 'building', min: 60, max: 80 },
  { level: 'interior', min: 80, max: 100 },
];

const rotations: RotationAngle[] = ['NE', 'SE', 'SW', 'NW'];

const presets: { name: string; zoom: number; mode: CameraMode }[] = [
  { name: 'Overview', zoom: 15, mode: 'isometric' },
  { name: 'Street Level', zoom: 55, mode: 'follow' },
  { name: "Bird's Eye", zoom: 30, mode: 'isometric' },
];

// ── Helper ────────────────────────────────────────────────────────

function getCurrentZoomLevel(zoom: number): ZoomLevel {
  for (const zl of zoomLevels) {
    if (zoom >= zl.min && zoom < zl.max) return zl.level;
  }
  return 'interior';
}

// ── Component ─────────────────────────────────────────────────────

export default function CameraControls({
  cameraState,
  onModeChange,
  onZoom,
  onRotate,
  onTransition,
}: CameraControlsProps) {
  const [showPresets, setShowPresets] = useState(false);
  const currentZoomLevel = getCurrentZoomLevel(cameraState.zoom);

  const rotateLeft = useCallback(() => {
    const idx = rotations.indexOf(cameraState.rotation);
    onRotate(rotations[(idx - 1 + rotations.length) % rotations.length]);
  }, [cameraState.rotation, onRotate]);

  const rotateRight = useCallback(() => {
    const idx = rotations.indexOf(cameraState.rotation);
    onRotate(rotations[(idx + 1) % rotations.length]);
  }, [cameraState.rotation, onRotate]);

  const applyPreset = useCallback(
    (preset: (typeof presets)[number]) => {
      onModeChange(preset.mode);
      onZoom(preset.zoom);
      setShowPresets(false);
    },
    [onModeChange, onZoom],
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Transition indicator */}
      {cameraState.transitioning && (
        <div className={`${panel} px-3 py-1.5 text-[10px] text-cyan-400 flex items-center gap-2`}>
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Transitioning...
        </div>
      )}

      {/* Mode selector */}
      <div className={`${panel} p-2`}>
        <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Camera Mode</div>
        <div className="flex gap-1">
          {cameraModes.map(({ mode, label, icon }) => (
            <button
              key={mode}
              onClick={() => onModeChange(mode)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-[10px] transition-colors ${
                cameraState.mode === mode
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                  : 'text-gray-400 hover:text-gray-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Zoom slider */}
      <div className={`${panel} p-2`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Zoom</span>
          <span className="text-[10px] text-cyan-400 capitalize">{currentZoomLevel}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onZoom(Math.max(0, cameraState.zoom - 5))}
            className="p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
          aria-label="Zoom out">
            <ZoomOut className="w-3.5 h-3.5 text-gray-400" />
          </button>
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={100}
              value={cameraState.zoom}
              onChange={(e) => onZoom(Number(e.target.value))}
              className="w-full h-1 appearance-none bg-white/10 rounded-full cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-cyan-400"
            />
            {/* Level markers */}
            <div className="flex justify-between mt-1">
              {zoomLevels.map((zl) => (
                <span
                  key={zl.level}
                  className={`text-[8px] ${
                    currentZoomLevel === zl.level ? 'text-cyan-400' : 'text-gray-600'
                  }`}
                >
                  {zl.level.slice(0, 3).toUpperCase()}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => onZoom(Math.min(100, cameraState.zoom + 5))}
            className="p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
          aria-label="Zoom in">
            <ZoomIn className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
        <div className="text-center text-[9px] text-gray-400 mt-1">{cameraState.zoom}%</div>
      </div>

      {/* Rotation controls */}
      <div className={`${panel} p-2`}>
        <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">Rotation</div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={rotateLeft}
            className="p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
          aria-label="Rotate cw">
            <RotateCw className="w-4 h-4 text-gray-400 -scale-x-100" />
          </button>
          <div className="flex gap-1">
            {rotations.map((angle) => (
              <button
                key={angle}
                onClick={() => onRotate(angle)}
                className={`px-2 py-1 rounded text-[10px] transition-colors ${
                  cameraState.rotation === angle
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                    : 'text-gray-400 hover:text-gray-300 bg-white/5 border border-transparent'
                }`}
              >
                {angle}
              </button>
            ))}
          </div>
          <button
            onClick={rotateRight}
            className="p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
          aria-label="Rotate cw">
            <RotateCw className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <div className="text-center text-[9px] text-gray-400 mt-1">90° per step</div>
      </div>

      {/* Follow mode target */}
      {cameraState.mode === 'follow' && (
        <div className={`${panel} p-2`}>
          <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">
            Follow Target
          </div>
          <div className="flex gap-1">
            {(['avatar', 'npc', 'event'] as FollowTarget[]).map((target) => (
              <button
                key={target}
                onClick={() => onTransition({ followTarget: target })}
                className={`flex-1 px-2 py-1.5 rounded text-[10px] capitalize transition-colors ${
                  cameraState.followTarget === target
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                    : 'text-gray-400 hover:text-gray-300 bg-white/5 border border-transparent'
                }`}
              >
                {target === 'avatar' ? 'Your Avatar' : target === 'npc' ? 'NPC' : 'Event'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Free camera hint */}
      {cameraState.mode === 'free' && (
        <div className={`${panel} p-2 text-[10px] text-gray-400`}>
          <div className="flex items-center gap-2 mb-1">
            <Maximize2 className="w-3 h-3 text-gray-400" />
            <span className="text-gray-300">Free Camera Controls</span>
          </div>
          <div className="grid grid-cols-2 gap-1 mt-1">
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[9px]">W</kbd> Forward
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[9px]">S</kbd> Back
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[9px]">A</kbd> Left
            </span>
            <span>
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-gray-400 text-[9px]">D</kbd> Right
            </span>
          </div>
        </div>
      )}

      {/* Cinematic timeline */}
      {cameraState.mode === 'cinematic' && (
        <div className={`${panel} p-2`}>
          <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider">
            Cinematic Timeline
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onTransition({ cinematicTime: 0 })}
              className="p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
            aria-label="Previous track">
              <SkipBack className="w-3.5 h-3.5 text-gray-400" />
            </button>
            <button
              onClick={() =>
                onTransition({ cinematicPlaying: !cameraState.cinematicPlaying })
              }
              className="p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
            >
              {cameraState.cinematicPlaying ? (
                <Pause className="w-3.5 h-3.5 text-cyan-400" />
              ) : (
                <Play className="w-3.5 h-3.5 text-gray-400" />
              )}
            </button>
            <div className="flex-1 relative">
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-cyan-400 rounded-full transition-all"
                  style={{
                    width: `${
                      cameraState.cinematicDuration > 0
                        ? (cameraState.cinematicTime / cameraState.cinematicDuration) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
            <button
              onClick={() =>
                onTransition({ cinematicTime: cameraState.cinematicDuration })
              }
              className="p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
            aria-label="Next track">
              <SkipForward className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 mt-1">
            <span>{formatTime(cameraState.cinematicTime)}</span>
            <span>{formatTime(cameraState.cinematicDuration)}</span>
          </div>
        </div>
      )}

      {/* Presets */}
      <div className="relative">
        <button
          onClick={() => setShowPresets((s) => !s)}
          className={`${panel} px-3 py-1.5 text-xs flex items-center gap-1.5 hover:bg-white/5 transition-colors w-full`}
        >
          <Camera className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-gray-300">Presets</span>
          <ChevronDown
            className={`w-3 h-3 text-gray-400 ml-auto transition-transform ${
              showPresets ? 'rotate-180' : ''
            }`}
          />
        </button>
        {showPresets && (
          <div className={`${panel} absolute top-full mt-1 left-0 right-0 z-10 p-1`}>
            {presets.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className="w-full text-left px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors flex items-center justify-between"
              >
                <span>{preset.name}</span>
                <span className="text-[9px] text-gray-400 capitalize">{preset.mode}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Utility ───────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
