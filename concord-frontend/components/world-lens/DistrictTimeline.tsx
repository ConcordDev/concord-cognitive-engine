'use client';

import React, { useState } from 'react';
import { Clock, Building2, Users, Zap, Leaf } from 'lucide-react';
import type { DistrictSnapshot } from '@/lib/world-lens/types';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const SEED_SNAPSHOTS: DistrictSnapshot[] = [
  { timestamp: '2025-10-01', buildingCount: 0, populationCapacity: 0, powerCapacity: 0, waterCapacity: 0, environmentalScore: 100 },
  { timestamp: '2025-10-08', buildingCount: 1, populationCapacity: 200, powerCapacity: 500, waterCapacity: 10000, environmentalScore: 92 },
  { timestamp: '2025-10-15', buildingCount: 2, populationCapacity: 400, powerCapacity: 1000, waterCapacity: 20000, environmentalScore: 85 },
  { timestamp: '2025-10-22', buildingCount: 3, populationCapacity: 800, powerCapacity: 2000, waterCapacity: 40000, environmentalScore: 82 },
  { timestamp: '2025-11-01', buildingCount: 4, populationCapacity: 1200, powerCapacity: 3000, waterCapacity: 50000, environmentalScore: 78 },
  { timestamp: '2025-11-08', buildingCount: 5, populationCapacity: 1800, powerCapacity: 4000, waterCapacity: 70000, environmentalScore: 75 },
  { timestamp: '2025-11-15', buildingCount: 6, populationCapacity: 2400, powerCapacity: 5000, waterCapacity: 90000, environmentalScore: 72 },
];

interface DistrictTimelineProps {
  districtId: string;
}

export default function DistrictTimeline({ districtId: _districtId }: DistrictTimelineProps) {
  const [selectedWeek, setSelectedWeek] = useState(SEED_SNAPSHOTS.length - 1);
  const snapshot = SEED_SNAPSHOTS[selectedWeek];
  const maxPop = Math.max(...SEED_SNAPSHOTS.map(s => s.populationCapacity), 1);

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
          max={SEED_SNAPSHOTS.length - 1}
          value={selectedWeek}
          onChange={e => setSelectedWeek(parseInt(e.target.value))}
          className="w-full h-1.5 accent-cyan-500"
        />
        <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
          {SEED_SNAPSHOTS.map((s, i) => (
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
            <p className="text-[9px] text-gray-500">Buildings</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-purple-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.populationCapacity.toLocaleString()}</p>
            <p className="text-[9px] text-gray-500">Pop. Capacity</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-yellow-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.powerCapacity.toLocaleString()} kW</p>
            <p className="text-[9px] text-gray-500">Power</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Leaf className="w-3.5 h-3.5 text-green-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.environmentalScore}/100</p>
            <p className="text-[9px] text-gray-500">Environment</p>
          </div>
        </div>
      </div>

      {/* Mini chart */}
      <div className="flex items-end gap-0.5 h-16">
        {SEED_SNAPSHOTS.map((s, i) => {
          const h = maxPop > 0 ? (s.populationCapacity / maxPop) * 100 : 0;
          return (
            <div
              key={i}
              className={`flex-1 rounded-t transition-all cursor-pointer ${
                i === selectedWeek ? 'bg-cyan-500' : i <= selectedWeek ? 'bg-cyan-500/30' : 'bg-white/10'
              }`}
              style={{ height: `${Math.max(4, h)}%` }}
              onClick={() => setSelectedWeek(i)}
              title={`Week ${i + 1}: ${s.populationCapacity} pop`}
            />
          );
        })}
      </div>
      <p className="text-[9px] text-gray-600 text-center">Population capacity over time</p>
    </div>
  );
}
