'use client';

import { useEffect, useState } from 'react';
import {
  getStoredSensitivity,
  setStoredSensitivity,
} from '@/lib/world-lens/quality-preset';
import { cameraLookState } from '@/lib/world-lens/camera-look-state';

const MIN = 0.0005;
const MAX = 0.02;
const STEP = 0.0005;

export function MouseSensitivitySlider() {
  const [value, setValue] = useState<number>(0.0025);

  useEffect(() => {
    const v = getStoredSensitivity();
    setValue(v);
    cameraLookState.sensitivity = v;
  }, []);

  const handleChange = (next: number) => {
    setValue(next);
    setStoredSensitivity(next);
    // Apply immediately — no page reload needed since the camera reads
    // cameraLookState.sensitivity each mousemove.
    cameraLookState.sensitivity = next;
  };

  // Map the raw radians-per-pixel value into a friendlier 1-100 display.
  const displayPercent = Math.round(((value - MIN) / (MAX - MIN)) * 100);

  return (
    <div className="bg-gray-900/60 border border-gray-700 rounded p-4 max-w-lg">
      <h3 className="text-sm font-semibold text-cyan-300 mb-1">Mouse sensitivity</h3>
      <p className="text-xs text-gray-400 mb-3">
        How much the camera turns per pixel of mouse movement when you&apos;re in
        first-person or follow mode and the canvas has pointer lock.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="flex-1 accent-cyan-400"
        />
        <span className="text-xs font-mono text-cyan-300 w-12 text-right">{displayPercent}%</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        Default is 0.0025 rad/px (~12% of slider). Higher = faster turn.
      </p>
    </div>
  );
}
