'use client';

import { cn } from '@/lib/utils';

export interface MissionData {
  name: string;
  status: 'planning' | 'prelaunch' | 'active' | 'orbit' | 'reentry' | 'completed' | 'aborted';
  missionType: 'orbital' | 'suborbital' | 'deep_space' | 'station_resupply' | 'satellite_deploy';
  launchVehicle: string;
  launchSite: string;
  launchDate: string;
  orbit: string;
  payload: string;
  payloadMass: number;
  crewSize: number;
  duration: string;
  objective: string;
}

export interface SatelliteData {
  designation: string;
  type: 'communications' | 'earth_observation' | 'navigation' | 'science' | 'military' | 'weather';
  status: 'operational' | 'standby' | 'degraded' | 'decommissioned';
  orbit: string;
  altitude: number;
  inclination: number;
  period: string;
  launchDate: string;
  endOfLife: string;
  operator: string;
}

export interface TelemetryData {
  source: string;
  signalStrength: number;
  dataRate: string;
  lastContact: string;
  altitude: number;
  velocity: number;
  temperature: number;
  powerLevel: number;
  anomalies: string[];
}

export type ArtifactDataUnion = MissionData | SatelliteData | TelemetryData | Record<string, unknown>;

export const STATUS_COLORS: Record<string, string> = {
  planning: 'text-blue-400 bg-blue-400/10', prelaunch: 'text-yellow-400 bg-yellow-400/10',
  active: 'text-green-400 bg-green-400/10', orbit: 'text-cyan-400 bg-cyan-400/10',
  reentry: 'text-orange-400 bg-orange-400/10', completed: 'text-gray-400 bg-gray-400/10',
  aborted: 'text-red-400 bg-red-400/10', operational: 'text-green-400 bg-green-400/10',
  standby: 'text-yellow-400 bg-yellow-400/10', degraded: 'text-orange-400 bg-orange-400/10',
  decommissioned: 'text-gray-400 bg-gray-500/10',
};

export const STATUS_DOT_COLORS: Record<string, string> = {
  planning: 'bg-blue-400', prelaunch: 'bg-yellow-400',
  active: 'bg-green-400', orbit: 'bg-cyan-400',
  reentry: 'bg-orange-400', completed: 'bg-gray-400',
  aborted: 'bg-red-400', operational: 'bg-green-400',
  standby: 'bg-yellow-400', degraded: 'bg-orange-400',
  decommissioned: 'bg-gray-500',
};

export function getOrbitalZone(altitude: number): 'LEO' | 'MEO' | 'GEO' {
  if (altitude < 2000) return 'LEO';
  if (altitude < 35000) return 'MEO';
  return 'GEO';
}

export function formatCountdown(targetDateStr: string): string {
  const now = Date.now();
  const target = new Date(targetDateStr).getTime();
  const diff = target - now;
  if (diff <= 0) return 'T-00:00:00';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  return `T-${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function SignalBar({ strength }: { strength: number }) {
  const color = strength > 80 ? 'bg-green-400' : strength >= 50 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1">
      {[20, 40, 60, 80, 100].map(threshold => (
        <div
          key={threshold}
          className={cn(
            'w-1 rounded-sm transition-colors',
            strength >= threshold ? color : 'bg-zinc-700',
          )}
          style={{ height: `${(threshold / 100) * 14 + 4}px` }}
        />
      ))}
    </div>
  );
}
