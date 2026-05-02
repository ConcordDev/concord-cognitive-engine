'use client';

import { useEffect, useState } from 'react';
import {
  type QualityPreset,
  getStoredQualityPreset,
  setStoredQualityPreset,
  QUALITY_PRESET_DESCRIPTIONS,
} from '@/lib/world-lens/quality-preset';

const PRESETS: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

const PRESET_LABEL: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

export function QualityPresetSelector() {
  const [current, setCurrent] = useState<QualityPreset>('medium');
  const [pendingChange, setPendingChange] = useState<QualityPreset | null>(null);

  useEffect(() => {
    setCurrent(getStoredQualityPreset());
  }, []);

  const handleSelect = (preset: QualityPreset) => {
    if (preset === current) return;
    setStoredQualityPreset(preset);
    setPendingChange(preset);
  };

  const handleApply = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <div className="bg-gray-900/60 border border-gray-700 rounded p-4 max-w-lg">
      <h3 className="text-sm font-semibold text-cyan-300 mb-1">Graphics quality</h3>
      <p className="text-xs text-gray-400 mb-3">
        Trades shadow detail, bloom intensity, and post-processing for performance.
        Changes take effect after a page refresh.
      </p>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => handleSelect(p)}
            className={
              p === current
                ? 'px-3 py-2 rounded bg-cyan-500/30 text-cyan-200 border border-cyan-500/60 text-xs font-semibold'
                : 'px-3 py-2 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 text-xs'
            }
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">{QUALITY_PRESET_DESCRIPTIONS[current]}</p>
      {pendingChange && pendingChange !== current && (
        <button
          onClick={handleApply}
          className="px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30 border border-yellow-500/40 text-xs font-semibold"
        >
          Reload to apply ({PRESET_LABEL[pendingChange]})
        </button>
      )}
    </div>
  );
}
