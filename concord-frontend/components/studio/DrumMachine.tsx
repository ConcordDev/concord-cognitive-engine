'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { DrumPattern, DrumPad } from '@/lib/daw/types';
import { emitPatternDTU } from '@/lib/daw/dtu-hooks';

interface DrumMachineProps {
  pattern: DrumPattern | null;
  pads: DrumPad[];
  currentStep: number;
  isPlaying: boolean;
  bpm: number;
  genre: string;
  onToggleStep: (padId: string, stepIndex: number) => void;
  onUpdateStepVelocity: (padId: string, stepIndex: number, velocity: number) => void;
  onUpdatePad: (padId: string, data: Partial<DrumPad>) => void;
  onTriggerPad: (padId: string, velocity?: number) => void;
  onSetSteps: (steps: number) => void;
  onClearPattern: () => void;
  onRandomize: () => void;
  onSavePattern: () => void;
}

const DEFAULT_PAD_NAMES = ['Kick', 'Snare', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Tom High', 'Tom Low', 'Perc', 'Crash', 'Ride', 'Shaker', 'Cowbell', 'Rim', 'Snap', 'Click', 'FX'];
const DEFAULT_PAD_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#fb923c', '#84cc16', '#2dd4bf', '#38bdf8', '#c084fc'];

export function DrumMachine({
  pattern,
  pads,
  currentStep,
  isPlaying,
  bpm,
  genre,
  onToggleStep,
  onUpdateStepVelocity,
  onUpdatePad,
  onTriggerPad,
  onSetSteps,
  onClearPattern,
  onRandomize,
  onSavePattern,
}: DrumMachineProps) {
  const [selectedPadId, setSelectedPadId] = useState<string | null>(null);
  const [stepCount, setStepCount] = useState(pattern?.steps || 16);
  const [showVelocity, setShowVelocity] = useState(false);

  const steps = pattern?.steps || 16;
  const tracks = pattern?.tracks || [];

  const handleSave = useCallback(() => {
    if (pattern) {
      emitPatternDTU(pattern, bpm, genre);
    }
    onSavePattern();
  }, [pattern, bpm, genre, onSavePattern]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-8 bg-black/40 border-b border-white/10 flex items-center px-3 gap-3 flex-shrink-0">
        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Drum Machine</span>
        <span className="text-[10px] text-gray-400 ml-1">{stepCount} steps</span>
        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-gray-400">Steps:</span>
          {[8, 16, 32, 64].map(s => (
            <button
              key={s}
              onClick={() => { setStepCount(s); onSetSteps(s); }}
              className={cn('px-1.5 py-0.5 rounded', steps === s ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white')}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button onClick={onRandomize} className="text-[10px] px-2 py-0.5 rounded bg-neon-purple/10 text-neon-purple hover:bg-neon-purple/20">
          Randomize
        </button>
        <button onClick={onClearPattern} className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">
          Clear
        </button>
        <button
          onClick={() => setShowVelocity(!showVelocity)}
          className={cn('text-[10px] px-2 py-0.5 rounded', showVelocity ? 'bg-neon-green/20 text-neon-green' : 'text-gray-400 hover:text-white')}
        >
          Velocity
        </button>
        <button onClick={handleSave} className="text-[10px] px-2 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20">
          Save as DTU
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Pad triggers (left side) */}
        <div className="flex-shrink-0 w-28 overflow-y-auto border-r border-white/10">
          {pads.slice(0, tracks.length || 8).map((pad, i) => (
            <div
              key={pad.id}
              onClick={() => { setSelectedPadId(pad.id); onTriggerPad(pad.id); }}
              className={cn(
                'h-10 flex items-center gap-2 px-2 border-b border-white/5 cursor-pointer hover:bg-white/5',
                selectedPadId === pad.id && 'bg-white/5'
              )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div
                className="w-6 h-6 rounded flex items-center justify-center text-[8px] font-bold text-black"
                style={{ backgroundColor: pad.color || DEFAULT_PAD_COLORS[i % DEFAULT_PAD_COLORS.length] }}
              >
                {i + 1}
              </div>
              <span className="text-[10px] truncate flex-1">
                {pad.name || DEFAULT_PAD_NAMES[i % DEFAULT_PAD_NAMES.length]}
              </span>
              <button
                onClick={e => { e.stopPropagation(); onUpdatePad(pad.id, { mute: !pad.mute }); }}
                className={cn('text-[7px] font-bold px-1 rounded', pad.mute ? 'bg-red-500/30 text-red-400' : 'text-gray-600')}
              >
                M
              </button>
            </div>
          ))}
        </div>

        {/* Step grid */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-max">
            {/* Step numbers header */}
            <div className="h-6 flex items-center border-b border-white/10 sticky top-0 z-10 bg-black/60">
              {Array.from({ length: steps }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex-shrink-0 text-center text-[8px] font-mono border-r border-white/5',
                    i % 4 === 0 ? 'text-gray-400' : 'text-gray-600',
                    currentStep === i && isPlaying && 'text-neon-cyan font-bold'
                  )}
                  style={{ width: 28 }}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Step rows */}
            {tracks.map((track, trackIdx) => {
              const pad = pads[trackIdx];
              const padColor = pad?.color || DEFAULT_PAD_COLORS[trackIdx % DEFAULT_PAD_COLORS.length];

              return (
                <div key={track.padId} className="h-10 flex items-center border-b border-white/5">
                  {track.steps.map((step, stepIdx) => (
                    <div
                      key={stepIdx}
                      className={cn(
                        'flex-shrink-0 h-full p-0.5 border-r',
                        stepIdx % 4 === 0 ? 'border-white/10' : 'border-white/[0.03]',
                        currentStep === stepIdx && isPlaying && 'bg-white/10'
                      )}
                      style={{ width: 28 }}
                    >
                      <button
                        onClick={() => onToggleStep(track.padId, stepIdx)}
                        className={cn(
                          'w-full h-full rounded transition-all',
                          step.active
                            ? 'shadow-lg'
                            : 'bg-white/[0.04] hover:bg-white/10'
                        )}
                        style={step.active ? {
                          backgroundColor: padColor,
                          opacity: showVelocity ? 0.3 + (step.velocity / 127) * 0.7 : 1,
                        } : undefined}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Velocity lane */}
      {showVelocity && selectedPadId && (
        <div className="h-20 border-t border-white/10 bg-black/40 flex overflow-hidden">
          <div className="w-28 flex-shrink-0 flex items-center justify-center border-r border-white/10">
            <span className="text-[9px] text-gray-400">VELOCITY</span>
          </div>
          <div className="flex-1 flex items-end overflow-auto">
            {tracks.find(t => t.padId === selectedPadId)?.steps.map((step, i) => (
              <div
                key={i}
                className="flex-shrink-0 flex flex-col items-center justify-end"
                style={{ width: 28, height: '100%' }}
              >
                {step.active && (
                  <div
                    className="w-5 rounded-t cursor-pointer hover:brightness-125"
                    style={{
                      height: `${(step.velocity / 127) * 100}%`,
                      backgroundColor: pads.find(p => p.id === selectedPadId)?.color || '#22c55e',
                    }}
                    onClick={() => {
                      const newVel = step.velocity >= 120 ? 40 : step.velocity + 20;
                      onUpdateStepVelocity(selectedPadId, i, Math.min(127, newVel));
                    }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
