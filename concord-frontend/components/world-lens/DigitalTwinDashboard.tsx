'use client';

import React, { useState, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Sensor {
  id: string;
  name: string;
  type: string;
  member: string;
  value: number;
  unit: string;
  predicted: number;
  status: 'normal' | 'warning' | 'critical';
}

interface Anomaly {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  detectedAt: string;
  recommendation: string;
}

interface Assessment {
  id: string;
  timestamp: string;
  healthScore: number;
  deviation: number;
  notes: string;
}

interface DigitalTwin {
  id: string;
  name: string;
  sourceDTU: string;
  healthScore: number;
  sensors: Sensor[];
  status: 'active' | 'degraded' | 'offline';
  lastAssessment: string;
  anomalies: Anomaly[];
  assessments: Assessment[];
}

// NOTE: There is no digital-twin domain on the backend (no `digital-twin`,
// `twin`, or structural-health-monitoring macro exists). Rather than fabricate
// twins, sensors, anomalies, and assessment history, this panel starts empty.
// TODO: wire to backend once a digital-twin / structural-health domain exists.

// ── Helpers ────────────────────────────────────────────────────────────────────

function healthColor(score: number): string {
  if (score >= 90) return 'text-emerald-400';
  if (score >= 70) return 'text-yellow-400';
  if (score >= 50) return 'text-orange-400';
  return 'text-red-400';
}

function healthBg(score: number): string {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 70) return 'bg-yellow-500';
  if (score >= 50) return 'bg-orange-500';
  return 'bg-red-500';
}

function statusBadge(status: string): string {
  if (status === 'active') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (status === 'degraded') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  return 'bg-red-500/20 text-red-400 border-red-500/30';
}

function severityBadge(severity: string): string {
  if (severity === 'critical') return 'bg-red-500/20 text-red-400 border-red-500/30';
  if (severity === 'high') return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  if (severity === 'medium') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
}

function sensorStatusDot(status: string): string {
  if (status === 'normal') return 'bg-emerald-400';
  if (status === 'warning') return 'bg-yellow-400';
  return 'bg-red-400';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DigitalTwinDashboard() {
  // EMPTY by design — no digital-twin backend exists. See file header TODO.
  const [twins] = useState<DigitalTwin[]>([]);
  const [selectedTwinId, setSelectedTwinId] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'detail' | 'create'>('grid');
  const [createForm, setCreateForm] = useState({
    name: '',
    sourceDTU: '',
    sensorCount: 1,
    alertThreshold: 80,
  });

  const selectedTwin = useMemo(
    () => twins.find((t) => t.id === selectedTwinId) || null,
    [twins, selectedTwinId]
  );

  const openDetail = (id: string) => {
    setSelectedTwinId(id);
    setView('detail');
  };

  // ── Health gauge (SVG arc) ───────────────────────────────────────────────────
  const HealthGauge = ({ score }: { score: number }) => {
    const radius = 60;
    const circumference = Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    return (
      <div className="flex flex-col items-center">
        <svg width="140" height="80" viewBox="0 0 140 80">
          <path
            d="M 10 75 A 60 60 0 0 1 130 75"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M 10 75 A 60 60 0 0 1 130 75"
            fill="none"
            stroke={score >= 90 ? '#34d399' : score >= 70 ? '#fbbf24' : score >= 50 ? '#fb923c' : '#f87171'}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
          <text x="70" y="65" textAnchor="middle" className="fill-white text-2xl font-bold" fontSize="28">
            {score}
          </text>
          <text x="70" y="78" textAnchor="middle" className="fill-white/40" fontSize="10">
            Health Score
          </text>
        </svg>
      </div>
    );
  };

  // ── Grid view ────────────────────────────────────────────────────────────────
  const renderGrid = () => (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Digital Twins</h3>
          <p className="text-[11px] text-white/40">{twins.length} active twins</p>
        </div>
        <button
          onClick={() => setView('create')}
          className="px-3 py-1.5 text-xs rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors"
        >
          + Create Twin
        </button>
      </div>

      {twins.length === 0 && (
        <div className="py-16 text-center text-sm text-white/40 border border-dashed border-white/10 rounded-xl">
          No digital twins yet.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {twins.map((twin) => (
          <button
            key={twin.id}
            onClick={() => openDetail(twin.id)}
            className="p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-all text-left group"
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold group-hover:text-cyan-400 transition-colors">
                {twin.name}
              </h4>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusBadge(twin.status)}`}>
                {twin.status}
              </span>
            </div>

            <div className="text-[10px] text-white/30 font-mono mb-3 truncate">{twin.sourceDTU}</div>

            <div className="flex items-end justify-between">
              <div>
                <div className={`text-2xl font-bold ${healthColor(twin.healthScore)}`}>
                  {twin.healthScore}
                </div>
                <div className="text-[10px] text-white/30">Health Score</div>
              </div>
              <div className="text-right space-y-1">
                <div className="text-[11px] text-white/50">{twin.sensors.length} sensors</div>
                {twin.anomalies.length > 0 && (
                  <div className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                    {twin.anomalies.length} anomal{twin.anomalies.length === 1 ? 'y' : 'ies'}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${healthBg(twin.healthScore)} transition-all`}
                style={{ width: `${twin.healthScore}%` }}
              />
            </div>

            <div className="mt-2 text-[10px] text-white/20">
              Last assessed: {formatTime(twin.lastAssessment)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Detail view ──────────────────────────────────────────────────────────────
  const renderDetail = () => {
    if (!selectedTwin) return null;
    return (
      <div className="p-5 space-y-5 overflow-y-auto flex-1">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('grid')}
            className="text-white/40 hover:text-white text-sm"
          >
            &#8592; Back
          </button>
          <h3 className="text-sm font-semibold">{selectedTwin.name}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusBadge(selectedTwin.status)}`}>
            {selectedTwin.status}
          </span>
        </div>

        {/* Top row: gauge + summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-white/10 bg-white/[0.03] flex flex-col items-center">
            <HealthGauge score={selectedTwin.healthScore} />
            <div className="text-[10px] text-white/30 mt-2 font-mono">{selectedTwin.sourceDTU}</div>
          </div>

          {/* 3D Overlay description */}
          <div className="md:col-span-2 p-4 rounded-xl border border-white/10 bg-white/[0.03]">
            <h4 className="text-xs font-semibold mb-3">3D Sensor Overlay</h4>
            <p className="text-[11px] text-white/40 mb-3">
              Sensor-to-member mapping for the structural model.
            </p>
            <div className="space-y-1.5">
              {selectedTwin.sensors.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <div className={`w-2 h-2 rounded-full ${sensorStatusDot(s.status)}`} />
                  <span className="text-white/60 w-32 truncate">{s.name}</span>
                  <span className="text-white/20">&#8594;</span>
                  <span className="text-cyan-400/70 font-mono text-[11px]">{s.member}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sensor readings */}
        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.03]">
          <h4 className="text-xs font-semibold mb-3">Sensor Readings - Predicted vs Actual</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/30 text-left border-b border-white/5">
                  <th className="pb-2 pr-4">Sensor</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4 text-right">Actual</th>
                  <th className="pb-2 pr-4 text-right">Predicted</th>
                  <th className="pb-2 pr-4 text-right">Deviation</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedTwin.sensors.map((s) => {
                  const dev = Math.abs(((s.value - s.predicted) / s.predicted) * 100);
                  return (
                    <tr key={s.id} className="border-b border-white/[0.03]">
                      <td className="py-2 pr-4 text-white/80">{s.name}</td>
                      <td className="py-2 pr-4 text-white/40">{s.type}</td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {s.value} <span className="text-white/30">{s.unit}</span>
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-white/40">
                        {s.predicted} <span className="text-white/20">{s.unit}</span>
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono ${dev > 10 ? 'text-red-400' : dev > 5 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {dev.toFixed(1)}%
                      </td>
                      <td className="py-2">
                        <div className={`w-2 h-2 rounded-full ${sensorStatusDot(s.status)}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Anomalies */}
        {selectedTwin.anomalies.length > 0 && (
          <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/[0.03]">
            <h4 className="text-xs font-semibold mb-3 text-red-400">Anomalies</h4>
            <div className="space-y-3">
              {selectedTwin.anomalies.map((a) => (
                <div key={a.id} className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${severityBadge(a.severity)}`}>
                      {a.severity.toUpperCase()}
                    </span>
                    <span className="text-xs font-medium">{a.title}</span>
                    <span className="text-[10px] text-white/20 ml-auto">{formatTime(a.detectedAt)}</span>
                  </div>
                  <p className="text-[11px] text-white/50 mb-2">{a.description}</p>
                  <div className="text-[11px] text-cyan-400/80 bg-cyan-500/10 rounded-lg p-2">
                    <span className="font-semibold">Recommendation:</span> {a.recommendation}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assessment history */}
        <div className="p-4 rounded-xl border border-white/10 bg-white/[0.03]">
          <h4 className="text-xs font-semibold mb-3">Assessment History</h4>
          <div className="space-y-2">
            {selectedTwin.assessments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors text-xs"
              >
                <div className={`text-lg font-bold w-10 text-center ${healthColor(a.healthScore)}`}>
                  {a.healthScore}
                </div>
                <div className="flex-1">
                  <div className="text-white/60">{a.notes}</div>
                  <div className="text-[10px] text-white/20">{formatTime(a.timestamp)}</div>
                </div>
                <div className={`text-[11px] font-mono ${a.deviation > 5 ? 'text-yellow-400' : 'text-white/30'}`}>
                  ±{a.deviation.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Create form ──────────────────────────────────────────────────────────────
  const renderCreateForm = () => (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setView('grid')}
          className="text-white/40 hover:text-white text-sm"
        >
          &#8592; Back
        </button>
        <h3 className="text-sm font-semibold">Create Digital Twin</h3>
      </div>

      <div className="max-w-lg space-y-4">
        <div>
          <label className="text-[11px] text-white/40 block mb-1">Twin Name</label>
          <input
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            placeholder="e.g., Civic Center Twin"
            className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none focus:border-cyan-500/50 placeholder-white/20"
          />
        </div>

        <div>
          <label className="text-[11px] text-white/40 block mb-1">Source DTU</label>
          <select
            value={createForm.sourceDTU}
            onChange={(e) => setCreateForm({ ...createForm, sourceDTU: e.target.value })}
            className="w-full px-3 py-2 text-xs bg-white/5 border border-white/10 rounded-lg outline-none focus:border-cyan-500/50"
          >
            <option value="">Select a DTU...</option>
            {/* TODO: populate from a real building/DTU list macro */}
          </select>
        </div>

        <div>
          <label className="text-[11px] text-white/40 block mb-1">
            Attach Sensors ({createForm.sensorCount})
          </label>
          <input
            type="range"
            min={1}
            max={12}
            value={createForm.sensorCount}
            onChange={(e) => setCreateForm({ ...createForm, sensorCount: parseInt(e.target.value) })}
            className="w-full accent-cyan-500"
          />
          <div className="flex justify-between text-[10px] text-white/20">
            <span>1</span>
            <span>12</span>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-white/40 block mb-1">
            Alert Threshold (health below {createForm.alertThreshold})
          </label>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={createForm.alertThreshold}
            onChange={(e) => setCreateForm({ ...createForm, alertThreshold: parseInt(e.target.value) })}
            className="w-full accent-cyan-500"
          />
          <div className="flex justify-between text-[10px] text-white/20">
            <span>50</span>
            <span>95</span>
          </div>
        </div>

        <button
          onClick={() => { window.dispatchEvent(new CustomEvent('digital-twin:create')); }}
          className="w-full py-2.5 text-xs font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 transition-colors"
        >
          Create Digital Twin
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl text-white overflow-hidden flex flex-col h-[700px]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm font-bold">
          DT
        </div>
        <div>
          <h2 className="text-sm font-semibold">Digital Twin Dashboard</h2>
          <p className="text-[11px] text-white/40">Structural health monitoring & sensor overlay</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'grid' && renderGrid()}
        {view === 'detail' && renderDetail()}
        {view === 'create' && renderCreateForm()}
      </div>
    </div>
  );
}
