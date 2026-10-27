'use client';

import React, { useState, useEffect } from 'react';
import { Clock, Building2, Users, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';

interface BackendDistrictSnapshot {
  at?: string;
  buildingCount?: number | null;
  population?: number | null;
  activeUsers?: number | null;
}

// Only what a recorded snapshot carries. Power and environment are never recorded.
interface TimelineSnapshot {
  timestamp: string;
  buildingCount: number | null;
  population: number | null;
  activeUsers: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const NOT_RECORDED = 'Not recorded';

const panel = ds.panelFloating;

interface DistrictTimelineProps {
  districtId: string;
}

export default function DistrictTimeline({ districtId }: DistrictTimelineProps) {
  // Real recorded snapshot history from the `district` lens-action domain.
  // Empty until snapshots are recorded — never seed a fabricated growth curve.
  const [snapshots, setSnapshots] = useState<TimelineSnapshot[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!districtId) {
      setSnapshots([]);
      return;
    }
    (async () => {
      try {
        const r = await lensRun('district', 'timeline-list', { districtId });
        const rows = (r.data?.result?.snapshots as BackendDistrictSnapshot[]) || [];
        if (cancelled) return;
        setSnapshots(
          rows.map((s): TimelineSnapshot => ({
            timestamp: s.at || '',
            buildingCount: num(s.buildingCount),
            population: num(s.population),
            activeUsers: num(s.activeUsers),
          })),
        );
      } catch {
        if (!cancelled) setSnapshots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
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
  const maxPop = Math.max(...snapshots.map(s => s.population ?? 0), 1);

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
            <p className="text-xs font-bold text-white">{snapshot.buildingCount ?? NOT_RECORDED}</p>
            <p className="text-[9px] text-gray-400">Buildings</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-purple-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.population == null ? NOT_RECORDED : snapshot.population.toLocaleString()}</p>
            <p className="text-[9px] text-gray-400">Population</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-yellow-400" />
          <div>
            <p className="text-xs font-bold text-white">{snapshot.activeUsers == null ? NOT_RECORDED : snapshot.activeUsers.toLocaleString()}</p>
            <p className="text-[9px] text-gray-400">Active users</p>
          </div>
        </div>
        <div className="p-2 rounded bg-white/5 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-gray-500" />
          <div>
            <p className="text-xs font-bold text-white">{NOT_RECORDED}</p>
            <p className="text-[9px] text-gray-400">Power</p>
          </div>
        </div>
      </div>

      {/* Mini chart */}
      <div className="flex items-end gap-0.5 h-16">
        {snapshots.map((s, i) => {
          const h = maxPop > 0 ? ((s.population ?? 0) / maxPop) * 100 : 0;
          return (
            <div
              key={i}
              className={`flex-1 rounded-t transition-all cursor-pointer ${
                i === selectedWeek ? 'bg-cyan-500' : i <= selectedWeek ? 'bg-cyan-500/30' : 'bg-white/10'
              }`}
              style={{ height: `${Math.max(4, h)}%` }}
              onClick={() => setSelectedWeek(i)}
              title={`${s.timestamp || `Snapshot ${i + 1}`}: ${s.population ?? NOT_RECORDED} pop`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
          );
        })}
      </div>
      <p className="text-[9px] text-gray-400 text-center">Population over time</p>
    </div>
  );
}
