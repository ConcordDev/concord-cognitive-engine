'use client';

import React from 'react';
import { ShieldCheck, Lock, Eye, AlertTriangle } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface AtlasPrivacyMonitorProps {
  data: PrivacyMonitorData | null;
  loading?: boolean;
}

interface PrivacyMonitorData {
  ok: boolean;
  view: 'zones' | 'stats' | 'verify';
  zones?: {
    count: number;
    zones: PrivacyZone[];
  };
  stats?: {
    totalZones: number;
    byProtectionLevel: Record<string, number>;
    byClassification: Record<string, number>;
    blocksEnforced: number;
    presenceDetectionsSuppressed: number;
    vehicleTrackingSuppressed: number;
  };
  verify?: {
    zone_id: string;
    classification: string;
    protection_level: string;
    interior_data_exists: boolean;
    interior_reconstructable: boolean;
    integrity: string;
  };
  error?: string;
}

interface PrivacyZone {
  id: string;
  classification: string;
  protection_level: string;
  confidence: number;
  established: string;
}

// ── Protection Colors ───────────────────────────────────────────────────────

const protectionColors: Record<string, string> = {
  ABSOLUTE:   'bg-red-900/50 text-red-300 border-red-800/30',
  RESTRICTED: 'bg-orange-900/50 text-orange-300 border-orange-800/30',
  CONTROLLED: 'bg-yellow-900/50 text-yellow-300 border-yellow-800/30',
  OPEN:       'bg-green-900/50 text-green-300 border-green-800/30',
};

const protectionIcons: Record<string, typeof Lock> = {
  ABSOLUTE:   Lock,
  RESTRICTED: ShieldCheck,
  CONTROLLED: Eye,
  OPEN:       Eye,
};

// ── Component ───────────────────────────────────────────────────────────────

export default function AtlasPrivacyMonitor({ data, loading }: AtlasPrivacyMonitorProps) {
  if (loading) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-red-400 animate-pulse" />
          <span className="text-sm text-zinc-400">Loading privacy monitor...</span>
        </div>
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-zinc-400" />
          <span className="text-sm text-zinc-400">
            {data?.error || 'No privacy data available'}
          </span>
        </div>
      </div>
    );
  }

  if (data.view === 'zones' && data.zones) return <ZonesView data={data.zones} />;
  if (data.view === 'stats' && data.stats) return <StatsView data={data.stats} />;
  if (data.view === 'verify' && data.verify) return <VerifyView data={data.verify} />;

  return null;
}

// ── Zones View ──────────────────────────────────────────────────────────────

function ZonesView({ data }: { data: NonNullable<PrivacyMonitorData['zones']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-red-400" />
          <span className="text-sm font-medium text-zinc-200">Privacy Zones</span>
        </div>
        <span className="text-xs text-zinc-400">{data.count} zones</span>
      </div>
      {data.count === 0 ? (
        <p className="text-xs text-zinc-400">No privacy zones established</p>
      ) : (
        <div className="space-y-1.5">
          {data.zones.slice(0, 10).map((zone) => {
            const Icon = protectionIcons[zone.protection_level] || Eye;
            return (
              <div
                key={zone.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs border ${
                  protectionColors[zone.protection_level] || protectionColors.OPEN
                }`}
              >
                <Icon size={12} />
                <span className="font-medium">{zone.classification}</span>
                <span className="opacity-60">{zone.protection_level}</span>
                <span className="ml-auto opacity-50">
                  {Math.round(zone.confidence * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Stats View ──────────────────────────────────────────────────────────────

function StatsView({ data }: { data: NonNullable<PrivacyMonitorData['stats']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-red-400" />
        <span className="text-sm font-medium text-zinc-200">Privacy Statistics</span>
      </div>

      {/* Protection level breakdown */}
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(data.byProtectionLevel).map(([level, count]) => (
          <div
            key={level}
            className={`px-2 py-1.5 rounded text-xs border ${
              protectionColors[level] || protectionColors.OPEN
            }`}
          >
            <div className="font-medium">{level}</div>
            <div className="text-lg">{count}</div>
          </div>
        ))}
      </div>

      {/* Suppression stats */}
      <div className="space-y-1 pt-1 border-t border-zinc-700/50">
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Privacy blocks enforced</span>
          <span className="text-red-400">{data.blocksEnforced}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Presence detections suppressed</span>
          <span className="text-red-400">{data.presenceDetectionsSuppressed}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-400">Vehicle tracking suppressed</span>
          <span className="text-red-400">{data.vehicleTrackingSuppressed}</span>
        </div>
      </div>
    </div>
  );
}

// ── Verify View ─────────────────────────────────────────────────────────────

function VerifyView({ data }: { data: NonNullable<PrivacyMonitorData['verify']> }) {
  const passed = data.integrity === 'verified' && !data.interior_data_exists;
  return (
    <div className={`rounded-lg p-4 space-y-2 border ${
      passed
        ? 'bg-green-900/20 border-green-800/30'
        : 'bg-red-900/20 border-red-800/30'
    }`}>
      <div className="flex items-center gap-2">
        {passed ? (
          <ShieldCheck size={16} className="text-green-400" />
        ) : (
          <AlertTriangle size={16} className="text-red-400" />
        )}
        <span className="text-sm font-medium text-zinc-200">
          Zone Integrity: {data.integrity}
        </span>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-400">Zone</span>
          <span className="text-zinc-300">{data.zone_id.slice(0, 16)}...</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Classification</span>
          <span className="text-zinc-300">{data.classification}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Protection</span>
          <span className={`px-1.5 py-0.5 rounded ${
            protectionColors[data.protection_level] || protectionColors.OPEN
          }`}>
            {data.protection_level}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Interior data exists</span>
          <span className={data.interior_data_exists ? 'text-red-400' : 'text-green-400'}>
            {data.interior_data_exists ? 'YES' : 'NO'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Interior reconstructable</span>
          <span className={data.interior_reconstructable ? 'text-red-400' : 'text-green-400'}>
            {data.interior_reconstructable ? 'YES' : 'NO'}
          </span>
        </div>
      </div>
    </div>
  );
}
