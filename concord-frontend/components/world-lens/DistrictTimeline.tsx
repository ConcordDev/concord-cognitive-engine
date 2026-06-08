'use client';

import React, { useState, useEffect } from 'react';
import { Clock, Building2, Users, Zap, Leaf } from 'lucide-react';
import type { DistrictSnapshot } from '@/lib/world-lens/types';
import { ds } from '@/lib/design-system';

const panel = ds.panelFloating;

interface DistrictTimelineProps {
  districtId: string;
}

export default function DistrictTimeline({ districtId }: DistrictTimelineProps) {
  // District snapshot history has no backend timeseries surface yet. Start
  // EMPTY — never seed fabricated growth curves. When a real
  // district-snapshot history API exists, fetch it here and map → snapshots.
  // TODO: wire to backend (no /api district-snapshot-history endpoint exists).
  const [snapshots, setSnapshots] = useState<DistrictSnapshot[]>([]);
  useEffect(() => {
    // Placeholder for the real fetch once a backend surface exists.
    // Intentionally leaves snapshots empty rather than fabricating data.
    setSnapshots([]);
  }, [districtId]);

  const [selectedWeek, setSelectedWeek] = useState(0);
  useEffect(() => {
    setSelectedWeek(Math.max(0, snapshots.length - 1));
  }, [snapshots.length]);

  if (snapshots.length === 0) {
    return (
      <div className={`${panel} p-4 space-y-3`}>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">District Timeline</h3>
        </div>
        <div className="py-8 text-center">
          <Clock className="w-6 h-6 text-gray-700 mx-auto mb-1" />
          <p className="text-[10px] text-gray-400">No snapshot history for this district yet.</p>
        </div>
      </div>
    );
  }

  const snapshot = snapshots[Math.min(selectedWeek, snapshots.length - 1)];
  const maxPop = Math.max(...snapshots.map(s => s.populationCapacity), 1);

  return (
    <div className={`${panel} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">District Timeline</h3>
      </div>

      {/* Timeline slider */}
      <div>
        <input
          type="range"
          min={0}
          max={snapshots.length - 1}
          value={selectedWeek}
          onChange={e => setSelectedWeek(parseInt(e.target.value))}
          className="w-full h-1.5 accent-cyan-500"
        />
        <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
          {snapshots.map((s, i) => (
            <span key={i} className={i === selectedWeek ? 'text-cyan-400' : ''}>
              {s.timestamp.slice(5)}
            </span>
          ))}
        </div>
      </div>

      {/* Snapshot stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5 text-cyan-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.buildingCount}</p>
            <p className="text-[9px] text-gray-400">Buildings</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-purple-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.populationCapacity.toLocaleString()}</p>
            <p className="text-[9px] text-gray-400">Pop. Capacity</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-yellow-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.powerCapacity.toLocaleString()} kW</p>
            <p className="text-[9px] text-gray-400">Power</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Leaf className="w-3.5 h-3.5 text-green-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.environmentalScore}/100</p>
            <p className="text-[9px] text-gray-400">Environment</p>
          </div>
        </div>
      </div>

      {/* Mini chart */}
      <div className="flex items-end gap-0.5 h-16">
        {snapshots.map((s, i) => {
          const h = maxPop > 0 ? (s.populationCapacity / maxPop) * 100 : 0;
          return (
            <div
              key={i}
              className={`flex-1 rounded-t transition-all cursor-pointer ${
                i === selectedWeek ? 'bg-cyan-500' : i <= selectedWeek ? 'bg-cyan-500/30' : 'bg-white/10'
              }`}
              style={{ height: `${Math.max(4, h)}%` }}
              onClick={() => setSelectedWeek(i)}
              title={`Week ${i + 1}: ${s.populationCapacity} pop`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
          );
        })}
      </div>
      <p className="text-[9px] text-gray-400 text-center">Population capacity over time</p>
    </div>
  );
}
