'use client';

import React, { useState } from 'react';
import {
  Activity, Radio, Fingerprint, Zap, Waves, AlertTriangle,
  ShoppingCart, Archive, Combine, Brain, Code2,
  ChevronDown, ChevronUp, Shield, Globe, Signal,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface ModuleStatus {
  name: string;
  key: string;
  initialized: boolean;
  metrics: Record<string, number | string | boolean>;
}

interface FoundationStatus {
  modules: ModuleStatus[];
  emergencyMode: boolean;
  totalModules: number;
  initializedModules: number;
}

interface SensorReading {
  id: string;
  subtype: string;
  channel: string;
  measurements: {
    signal_strength: number | null;
    noise_floor: number | null;
    anomaly_score: number;
  };
  created: string;
}

interface EnergyReading {
  id: string;
  subtype: string;
  grid_health: {
    load_estimate: string;
    anomaly_detected: boolean;
    deviation_from_nominal: number;
  };
  location: { lat: number; lng: number } | null;
}

interface EmergencyAlert {
  id: string;
  severity: number;
  subtype: string;
  content: { situation: string };
  created: string;
  verified: boolean;
}

interface NeuralReadiness {
  ready: boolean;
  readiness: number;
  checks: Record<string, boolean>;
  simulationMode: boolean;
}

interface FoundationCardProps {
  type: 'status' | 'sense' | 'energy' | 'emergency' | 'neural' | 'protocol';
  status?: FoundationStatus;
  readings?: SensorReading[];
  energyReadings?: EnergyReading[];
  alerts?: EmergencyAlert[];
  neuralReadiness?: NeuralReadiness;
  protocolMetrics?: Record<string, unknown>;
}

// ── Module Icons ────────────────────────────────────────────────────────────

const moduleIcons: Record<string, React.ReactNode> = {
  sense: <Waves size={14} />,
  identity: <Fingerprint size={14} />,
  energy: <Zap size={14} />,
  spectrum: <Radio size={14} />,
  emergency: <AlertTriangle size={14} />,
  market: <ShoppingCart size={14} />,
  archive: <Archive size={14} />,
  synthesis: <Combine size={14} />,
  neural: <Brain size={14} />,
  protocol: <Code2 size={14} />,
};

// ── Sub-Components ──────────────────────────────────────────────────────────

function FoundationStatusView({ status }: { status: FoundationStatus }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Globe size={18} className="text-[color:var(--nb-red,#a78bfa)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Foundation Sovereignty</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          status.emergencyMode ? 'bg-red-900 text-red-300 animate-pulse' : 'bg-emerald-900 text-emerald-300'
        }`}>
          {status.emergencyMode ? 'EMERGENCY' : `${status.initializedModules}/${status.totalModules} Active`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {status.modules.map(mod => (
          <div key={mod.key} className={`flex items-center gap-1.5 p-1.5 rounded text-xs ${
            mod.initialized ? 'bg-zinc-800' : 'bg-zinc-850 opacity-50'
          }`}>
            <span className="text-[color:var(--nb-muted,#a1a1aa)]">{moduleIcons[mod.key] || <Activity size={14} />}</span>
            <span className="text-[color:var(--nb-ink-2,#d4d4d8)] flex-1">{mod.name}</span>
            <span className={mod.initialized ? 'text-[color:var(--nb-green,#34d399)]' : 'text-[color:var(--nb-faint,#52525b)]'}>
              {mod.initialized ? 'ON' : 'OFF'}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-[color:var(--nb-muted,#a1a1aa)] hover:text-[color:var(--nb-ink-2,#d4d4d8)] flex items-center gap-1"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded && (
        <div className="space-y-2 text-xs">
          {status.modules.filter(m => m.initialized).map(mod => (
            <div key={mod.key} className="bg-[var(--nb-wash,#27272a)] rounded p-2">
              <div className="text-[color:var(--nb-muted,#a1a1aa)] font-semibold mb-1">{mod.name}</div>
              {Object.entries(mod.metrics).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-[color:var(--nb-muted,#a1a1aa)]">{k.replace(/_/g, ' ')}</span>
                  <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{String(v)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SenseView({ readings }: { readings: SensorReading[] }) {
  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Waves size={18} className="text-[color:var(--nb-red,#a78bfa)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Sensor Readings</span>
        <span className="ml-auto text-xs text-[color:var(--nb-muted,#a1a1aa)]">{readings.length} readings</span>
      </div>

      {readings.length === 0 ? (
        <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] text-center py-3">No sensor readings yet</div>
      ) : (
        <div className="space-y-1">
          {readings.slice(0, 10).map(r => (
            <div key={r.id} className="flex items-center gap-2 p-2 bg-[var(--nb-wash,#27272a)] rounded text-xs">
              <Signal size={12} className={
                (r.measurements.anomaly_score || 0) > 3 ? 'text-[color:var(--nb-red,#f87171)]' :
                (r.measurements.anomaly_score || 0) > 1.5 ? 'text-[color:var(--nb-ochre,#fbbf24)]' : 'text-[color:var(--nb-green,#34d399)]'
              } />
              <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{r.subtype}</span>
              <span className="text-[color:var(--nb-muted,#a1a1aa)] flex-1">{r.channel}</span>
              {r.measurements.signal_strength != null && (
                <span className="text-[color:var(--nb-muted,#a1a1aa)]">{r.measurements.signal_strength} dBm</span>
              )}
              <span className="text-[color:var(--nb-faint,#52525b)]">{new Date(r.created).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmergencyView({ alerts }: { alerts: EmergencyAlert[] }) {
  return (
    <div className="rounded-lg border border-[color:var(--nb-red,rgba(127,29,29,0.5))] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="text-[color:var(--nb-red,#f87171)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Emergency Alerts</span>
      </div>

      {alerts.length === 0 ? (
        <div className="text-xs text-[color:var(--nb-green,#10b981)] text-center py-3">No active emergencies</div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div key={alert.id} className="p-3 bg-[var(--nb-wash,#27272a)] rounded border-l-2 border-[color:var(--nb-red,#ef4444)]">
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                  alert.severity >= 9 ? 'bg-red-900 text-red-300' :
                  alert.severity >= 7 ? 'bg-orange-900 text-orange-300' :
                  alert.severity >= 4 ? 'bg-amber-900 text-amber-300' : 'bg-blue-900 text-blue-300'
                }`}>
                  SEV {alert.severity}
                </span>
                <span className="text-[color:var(--nb-ink-2,#d4d4d8)] flex-1">{alert.subtype}</span>
                {alert.verified && <Shield size={12} className="text-[color:var(--nb-green,#34d399)]" />}
              </div>
              <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] mt-1">{alert.content.situation}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NeuralView({ readiness }: { readiness: NeuralReadiness }) {
  const progressPct = Math.round(readiness.readiness * 100);

  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Brain size={18} className="text-[color:var(--nb-red,#a78bfa)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Neural Interface Readiness</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          readiness.ready ? 'bg-emerald-900 text-emerald-300' : 'bg-amber-900 text-amber-300'
        }`}>
          {readiness.simulationMode ? 'Simulation' : readiness.ready ? 'Ready' : 'Preparing'}
        </span>
      </div>

      <div className="space-y-2">
        <div className="w-full bg-[var(--nb-wash,#27272a)] rounded-full h-2">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-[var(--nb-red-soft,#8b5cf6)] to-[var(--nb-red-soft,#a855f7)] transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] text-right">{progressPct}% ready</div>
      </div>

      <div className="space-y-1">
        {Object.entries(readiness.checks).map(([check, passed]) => (
          <div key={check} className="flex items-center gap-2 text-xs">
            <span className={passed ? 'text-[color:var(--nb-green,#34d399)]' : 'text-[color:var(--nb-faint,#52525b)]'}>
              {passed ? '\u2713' : '\u2717'}
            </span>
            <span className="text-[color:var(--nb-muted,#a1a1aa)]">{check.replace(/_/g, ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function FoundationCard({
  type, status, readings, energyReadings, alerts, neuralReadiness, protocolMetrics,
}: FoundationCardProps) {
  switch (type) {
    case 'status':
      return status ? <FoundationStatusView status={status} /> : null;
    case 'sense':
      return readings ? <SenseView readings={readings} /> : null;
    case 'emergency':
      return alerts ? <EmergencyView alerts={alerts} /> : null;
    case 'neural':
      return neuralReadiness ? <NeuralView readiness={neuralReadiness} /> : null;
    case 'energy':
      return energyReadings ? <EnergyView readings={energyReadings} /> : null;
    case 'protocol':
      return protocolMetrics ? <ProtocolView metrics={protocolMetrics} /> : null;
    default:
      return null;
  }
}

function EnergyView({ readings }: { readings: EnergyReading[] }) {
  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Zap size={18} className="text-[color:var(--nb-red,#a78bfa)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Energy Readings</span>
        <span className="ml-auto text-xs text-[color:var(--nb-muted,#a1a1aa)]">{readings.length} readings</span>
      </div>

      {readings.length === 0 ? (
        <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] text-center py-3">No energy readings yet</div>
      ) : (
        <div className="space-y-1">
          {readings.slice(0, 10).map(r => (
            <div key={r.id} className="flex items-center gap-2 p-2 bg-[var(--nb-wash,#27272a)] rounded text-xs">
              <Signal size={12} className={
                r.grid_health.anomaly_detected ? 'text-[color:var(--nb-red,#f87171)]' : 'text-[color:var(--nb-green,#34d399)]'
              } />
              <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{r.subtype}</span>
              <span className="text-[color:var(--nb-muted,#a1a1aa)] flex-1">{r.grid_health.load_estimate}</span>
              {r.grid_health.anomaly_detected && (
                <span className="text-[color:var(--nb-red,#f87171)]">anomaly</span>
              )}
              <span className="text-[color:var(--nb-muted,#a1a1aa)]">
                {r.grid_health.deviation_from_nominal > 0 ? '+' : ''}{r.grid_health.deviation_from_nominal.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProtocolView({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics);
  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Code2 size={18} className="text-[color:var(--nb-red,#a78bfa)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Protocol Metrics</span>
      </div>

      {entries.length === 0 ? (
        <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] text-center py-3">No protocol data</div>
      ) : (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between p-1.5 bg-[var(--nb-wash,#27272a)] rounded text-xs">
              <span className="text-[color:var(--nb-muted,#a1a1aa)]">{key.replace(/_/g, ' ')}</span>
              <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
