'use client';

import React from 'react';
import { Radio, AlertTriangle, Shield, Zap } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface AtlasSignalViewProps {
  data: SignalViewData | null;
  loading?: boolean;
}

interface SignalViewData {
  ok: boolean;
  view: 'taxonomy' | 'unknown' | 'anomalies' | 'spectrum';
  taxonomy?: {
    totalClassified: number;
    category: string;
    count: number;
    signals: ClassifiedSignal[];
  };
  unknown?: {
    count: number;
    total: number;
    signals: ClassifiedSignal[];
  };
  anomalies?: {
    count: number;
    signals: ClassifiedSignal[];
  };
  spectrum?: {
    totalSignals: number;
    bands: Record<string, number>;
  };
  error?: string;
}

interface ClassifiedSignal {
  id: string;
  category: string;
  purpose: string;
  frequency: number;
  adjustability: string;
  classified_at: string;
}

// ── Category Colors ─────────────────────────────────────────────────────────

const categoryColors: Record<string, string> = {
  INFRASTRUCTURE: 'bg-amber-900/50 text-amber-300',
  COMMUNICATION:  'bg-blue-900/50 text-blue-300',
  NAVIGATION:     'bg-green-900/50 text-green-300',
  SCIENTIFIC:     'bg-purple-900/50 text-purple-300',
  BIOLOGICAL:     'bg-pink-900/50 text-pink-300',
  GEOLOGICAL:     'bg-orange-900/50 text-orange-300',
  UNKNOWN:        'bg-zinc-800 text-zinc-400',
};

const adjustColors: Record<string, string> = {
  OBSERVE_ONLY:      'text-zinc-400',
  RESPOND_ALLOWED:   'text-blue-400',
  MODULATE_ALLOWED:  'text-green-400',
  ADJUST_RESTRICTED: 'text-yellow-400',
  ADJUST_FORBIDDEN:  'text-red-400',
};

// ── Component ───────────────────────────────────────────────────────────────

export default function AtlasSignalView({ data, loading }: AtlasSignalViewProps) {
  if (loading) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-blue-400 animate-pulse" />
          <span className="text-sm text-zinc-400">Loading signal cortex...</span>
        </div>
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-zinc-400" />
          <span className="text-sm text-zinc-400">
            {data?.error || 'No signal cortex data available'}
          </span>
        </div>
      </div>
    );
  }

  if (data.view === 'taxonomy' && data.taxonomy) return <TaxonomyView data={data.taxonomy} />;
  if (data.view === 'unknown' && data.unknown) return <UnknownView data={data.unknown} />;
  if (data.view === 'anomalies' && data.anomalies) return <AnomalyView data={data.anomalies} />;
  if (data.view === 'spectrum' && data.spectrum) return <SpectrumView data={data.spectrum} />;

  return null;
}

// ── Taxonomy View ───────────────────────────────────────────────────────────

function TaxonomyView({ data }: { data: NonNullable<SignalViewData['taxonomy']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-blue-400" />
          <span className="text-sm font-medium text-zinc-200">Signal Taxonomy</span>
        </div>
        <span className="text-xs text-zinc-400">{data.totalClassified} classified</span>
      </div>
      <div className="space-y-1">
        {data.signals.slice(0, 10).map((sig) => (
          <div key={sig.id} className="flex items-center gap-2 text-xs">
            <span className={`px-1.5 py-0.5 rounded ${categoryColors[sig.category] || categoryColors.UNKNOWN}`}>
              {sig.category}
            </span>
            <span className="text-zinc-400">{sig.frequency} MHz</span>
            <span className="text-zinc-600">{sig.purpose}</span>
            <span className={adjustColors[sig.adjustability] || 'text-zinc-400'}>
              {sig.adjustability === 'ADJUST_FORBIDDEN' ? '⛔' :
               sig.adjustability === 'ADJUST_RESTRICTED' ? '⚠' :
               sig.adjustability === 'OBSERVE_ONLY' ? '👁' : '✓'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Unknown Signals View ────────────────────────────────────────────────────

function UnknownView({ data }: { data: NonNullable<SignalViewData['unknown']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-yellow-400" />
          <span className="text-sm font-medium text-zinc-200">Unclassified Signals</span>
        </div>
        <span className="text-xs text-zinc-400">{data.total} total</span>
      </div>
      {data.count === 0 ? (
        <p className="text-xs text-zinc-400">No unclassified signals in queue</p>
      ) : (
        <div className="space-y-1">
          {data.signals.slice(0, 8).map((sig) => (
            <div key={sig.id} className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400 font-mono">{sig.id.slice(0, 12)}...</span>
              <span className="text-zinc-400">{sig.frequency} MHz</span>
              <span className="text-zinc-600">{sig.classified_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Anomaly View ────────────────────────────────────────────────────────────

function AnomalyView({ data }: { data: NonNullable<SignalViewData['anomalies']> }) {
  return (
    <div className="rounded-lg bg-zinc-800/50 border border-red-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-red-400" />
          <span className="text-sm font-medium text-zinc-200">Signal Anomalies</span>
        </div>
        <span className="text-xs text-red-400">{data.count} detected</span>
      </div>
      {data.count === 0 ? (
        <p className="text-xs text-zinc-400">No anomalies detected</p>
      ) : (
        <div className="space-y-1">
          {data.signals.slice(0, 8).map((sig) => (
            <div key={sig.id} className="flex items-center gap-2 text-xs">
              <span className={`px-1.5 py-0.5 rounded ${categoryColors[sig.category] || categoryColors.UNKNOWN}`}>
                {sig.category}
              </span>
              <span className="text-zinc-400">{sig.frequency} MHz</span>
              <span className="text-red-400/60">{sig.purpose}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Spectrum View ───────────────────────────────────────────────────────────

function SpectrumView({ data }: { data: NonNullable<SignalViewData['spectrum']> }) {
  const bands = Object.entries(data.bands);
  const maxCount = Math.max(...bands.map(([, c]) => c), 1);

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-purple-400" />
          <span className="text-sm font-medium text-zinc-200">Spectral Occupancy</span>
        </div>
        <span className="text-xs text-zinc-400">{data.totalSignals} signals</span>
      </div>
      <div className="space-y-2">
        {bands.map(([band, count]) => (
          <div key={band} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">{band}</span>
              <span className="text-zinc-400">{count}</span>
            </div>
            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500/60 rounded-full"
                style={{ width: `${(count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
