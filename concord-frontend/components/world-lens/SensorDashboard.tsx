'use client';

import React, { useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeviceStatus = 'online' | 'warning' | 'offline';

interface SensorReading {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
}

interface SensorDevice {
  id: string;
  name: string;
  type: string;
  typeIcon: string;
  status: DeviceStatus;
  location: string;
  linkedDtu: string;
  lastReadingTime: string;
  anomalyCount: number;
  readings: SensorReading[];
  history: number[]; // last 12 data points for mini chart
}

interface AnomalyAlert {
  id: string;
  deviceId: string;
  deviceName: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  acknowledged: boolean;
}

interface NewDeviceForm {
  name: string;
  type: string;
  location: string;
  linkedDtu: string;
}

// ---------------------------------------------------------------------------
// Seed Data
// ---------------------------------------------------------------------------

const SEED_DEVICES: SensorDevice[] = [
  {
    id: 'dev-ws-alpha',
    name: 'Weather Station Alpha',
    type: 'Environmental',
    typeIcon: '🌤',
    status: 'online',
    location: 'District-7 Rooftop',
    linkedDtu: 'dtu-dist-7-env',
    lastReadingTime: '2026-04-05T14:32:08Z',
    anomalyCount: 0,
    readings: [
      { label: 'Temperature', value: 22.4, unit: '°C', min: -20, max: 50 },
      { label: 'Humidity', value: 61, unit: '%', min: 0, max: 100 },
      { label: 'Wind Speed', value: 14.2, unit: 'km/h', min: 0, max: 150 },
    ],
    history: [18, 19, 20, 21, 22, 23, 23, 22, 22, 21, 22, 22],
  },
  {
    id: 'dev-struct-b7',
    name: 'Structural Monitor B7',
    type: 'Structural',
    typeIcon: '🏗',
    status: 'warning',
    location: 'Bridge Span 02 — Pier 4',
    linkedDtu: 'dtu-bridge-span-02',
    lastReadingTime: '2026-04-05T14:31:55Z',
    anomalyCount: 3,
    readings: [
      { label: 'Strain', value: 342, unit: 'με', min: 0, max: 1000 },
      { label: 'Vibration', value: 2.8, unit: 'mm/s', min: 0, max: 10 },
      { label: 'Displacement', value: 1.4, unit: 'mm', min: 0, max: 5 },
    ],
    history: [280, 290, 310, 325, 340, 355, 350, 342, 338, 330, 340, 342],
  },
  {
    id: 'dev-energy-g3',
    name: 'Energy Meter Grid-3',
    type: 'Energy',
    typeIcon: '⚡',
    status: 'online',
    location: 'Substation North',
    linkedDtu: 'dtu-grid-north-3',
    lastReadingTime: '2026-04-05T14:32:01Z',
    anomalyCount: 1,
    readings: [
      { label: 'Voltage', value: 237.8, unit: 'V', min: 200, max: 260 },
      { label: 'Current', value: 42.1, unit: 'A', min: 0, max: 100 },
      { label: 'Power', value: 10.02, unit: 'kW', min: 0, max: 25 },
    ],
    history: [9.4, 9.8, 10.1, 10.3, 10.5, 10.2, 10.0, 9.9, 10.0, 10.1, 10.0, 10.0],
  },
  {
    id: 'dev-water-w12',
    name: 'Water Flow Sensor W-12',
    type: 'Hydraulic',
    typeIcon: '💧',
    status: 'offline',
    location: 'Pipeline Junction W-12',
    linkedDtu: 'dtu-pipe-west-12',
    lastReadingTime: '2026-04-05T11:04:22Z',
    anomalyCount: 5,
    readings: [
      { label: 'Flow Rate', value: 0, unit: 'L/min', min: 0, max: 500 },
      { label: 'Pressure', value: 0, unit: 'bar', min: 0, max: 10 },
    ],
    history: [220, 215, 210, 200, 180, 140, 90, 40, 10, 0, 0, 0],
  },
];

const SEED_ANOMALIES: AnomalyAlert[] = [
  {
    id: 'ano-001',
    deviceId: 'dev-struct-b7',
    deviceName: 'Structural Monitor B7',
    severity: 'critical',
    message:
      'Strain reading exceeded threshold of 330 με for 12 consecutive minutes. Possible structural fatigue at Pier 4.',
    timestamp: '2026-04-05T13:48:10Z',
    acknowledged: false,
  },
  {
    id: 'ano-002',
    deviceId: 'dev-water-w12',
    deviceName: 'Water Flow Sensor W-12',
    severity: 'warning',
    message:
      'Device went offline at 11:04. Last pressure reading dropped from 3.2 bar to 0 bar in under 60 seconds — possible pipe burst or valve closure.',
    timestamp: '2026-04-05T11:04:22Z',
    acknowledged: true,
  },
];

const DEVICE_TYPES = ['Environmental', 'Structural', 'Energy', 'Hydraulic', 'Acoustic', 'Gas'];

const API_KEY = 'csk_live_9f3a7b2e1d4c8a6f5e0b3d7c2a9f4e1b';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const statusColor: Record<DeviceStatus, string> = {
  online: 'bg-green-500',
  warning: 'bg-yellow-500',
  offline: 'bg-red-500',
};

const statusRing: Record<DeviceStatus, string> = {
  online: 'ring-green-500/30',
  warning: 'ring-yellow-500/30',
  offline: 'ring-red-500/30',
};

const severityBadge: Record<string, string> = {
  critical: 'bg-red-600/40 text-red-300',
  warning: 'bg-yellow-600/40 text-yellow-300',
  info: 'bg-blue-600/40 text-blue-300',
};

function MiniBarChart({ data, color = 'bg-cyan-500' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-px h-8">
      {data.map((v, i) => (
        <div
          key={i}
          className={`${color} rounded-t-sm flex-1 min-w-[3px] opacity-70`}
          style={{ height: `${(v / max) * 100}%` }}
          title={String(v)}
        />
      ))}
    </div>
  );
}

function ReadingBar({ reading }: { reading: SensorReading }) {
  const pct = ((reading.value - reading.min) / (reading.max - reading.min)) * 100;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-white/50">{reading.label}</span>
        <span className="font-mono text-cyan-400">
          {reading.value} {reading.unit}
        </span>
      </div>
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="bg-cyan-500 h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SensorDashboard() {
  const [devices] = useState<SensorDevice[]>(SEED_DEVICES);
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>(SEED_ANOMALIES);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDevice, setNewDevice] = useState<NewDeviceForm>({
    name: '',
    type: DEVICE_TYPES[0],
    location: '',
    linkedDtu: '',
  });
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [filterStatus, setFilterStatus] = useState<DeviceStatus | 'all'>('all');

  const filteredDevices = useMemo(
    () => (filterStatus === 'all' ? devices : devices.filter(d => d.status === filterStatus)),
    [devices, filterStatus],
  );

  const selectedDeviceData = useMemo(
    () => devices.find(d => d.id === selectedDevice) ?? null,
    [devices, selectedDevice],
  );

  const acknowledgeAnomaly = (id: string) =>
    setAnomalies(prev => prev.map(a => (a.id === id ? { ...a, acknowledged: true } : a)));

  const maskedKey = API_KEY.slice(0, 9) + '•'.repeat(API_KEY.length - 13) + API_KEY.slice(-4);

  return (
    <div className={`${panel} p-5 space-y-5 text-white max-w-3xl`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Sensor Dashboard</h2>
        <div className="flex gap-2">
          {(['all', 'online', 'warning', 'offline'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
                filterStatus === s
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                  : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Device Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filteredDevices.map(device => (
          <button
            key={device.id}
            onClick={() => setSelectedDevice(device.id === selectedDevice ? null : device.id)}
            className={`text-left p-4 rounded-lg border transition-all ${
              selectedDevice === device.id
                ? 'border-cyan-500 bg-cyan-500/10'
                : 'border-white/10 hover:border-white/25 bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">{device.typeIcon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{device.name}</div>
                <div className="text-[11px] text-white/40">{device.type}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {device.anomalyCount > 0 && (
                  <span className="text-[10px] font-bold text-red-400">
                    {device.anomalyCount} ⚠
                  </span>
                )}
                <span
                  className={`w-2.5 h-2.5 rounded-full ${statusColor[device.status]} ring-4 ${statusRing[device.status]}`}
                />
              </div>
            </div>

            {/* Readings */}
            <div className="space-y-1.5 mb-2">
              {device.readings.map(r => (
                <ReadingBar key={r.label} reading={r} />
              ))}
            </div>

            {/* Mini chart */}
            <MiniBarChart
              data={device.history}
              color={device.status === 'offline' ? 'bg-red-500' : 'bg-cyan-500'}
            />

            <div className="text-[10px] text-white/25 mt-1.5">
              Last: {new Date(device.lastReadingTime).toLocaleTimeString()}
            </div>
          </button>
        ))}
      </section>

      {/* Selected device detail */}
      {selectedDeviceData && (
        <section className="p-4 rounded-lg border border-cyan-500/30 bg-cyan-900/10 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">{selectedDeviceData.name} — Details</h3>
            <Badge
              color={
                selectedDeviceData.status === 'online'
                  ? 'bg-green-600/40 text-green-300'
                  : selectedDeviceData.status === 'warning'
                    ? 'bg-yellow-600/40 text-yellow-300'
                    : 'bg-red-600/40 text-red-300'
              }
            >
              {selectedDeviceData.status}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-white/50">
            <div>
              <span className="text-white/30">Location:</span> {selectedDeviceData.location}
            </div>
            <div>
              <span className="text-white/30">Linked DTU:</span>{' '}
              <span className="font-mono text-cyan-400">{selectedDeviceData.linkedDtu}</span>
            </div>
            <div>
              <span className="text-white/30">Device ID:</span>{' '}
              <span className="font-mono">{selectedDeviceData.id}</span>
            </div>
            <div>
              <span className="text-white/30">Anomalies:</span> {selectedDeviceData.anomalyCount}
            </div>
          </div>

          {/* Text-based time series */}
          <div>
            <div className="text-[10px] text-white/30 mb-1 uppercase tracking-wider">
              12-Point History (Primary Sensor)
            </div>
            <div className="font-mono text-[10px] text-cyan-400/70 bg-black/40 rounded p-2 overflow-x-auto">
              {selectedDeviceData.history.map((v, i) => (
                <span key={i}>
                  {i > 0 ? ' → ' : ''}
                  {v}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Anomaly Alerts */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Anomaly Alerts
        </h3>
        {anomalies.map(a => (
          <div
            key={a.id}
            className={`p-3 rounded-lg border space-y-1 ${
              a.acknowledged
                ? 'border-white/5 bg-white/[0.02] opacity-60'
                : 'border-red-500/20 bg-red-900/10'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge color={severityBadge[a.severity]}>{a.severity}</Badge>
                <span className="text-xs font-semibold">{a.deviceName}</span>
              </div>
              {!a.acknowledged && (
                <button
                  onClick={() => acknowledgeAnomaly(a.id)}
                  className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/40 hover:text-white/70 transition-colors"
                >
                  Acknowledge
                </button>
              )}
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">{a.message}</p>
            <p className="text-[10px] text-white/25">
              {new Date(a.timestamp).toLocaleString()}
            </p>
          </div>
        ))}
      </section>

      {/* Add Device */}
      <section className="space-y-2">
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs font-semibold uppercase tracking-wider text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          {showAddForm ? '− Cancel' : '+ Add Device'}
        </button>

        {showAddForm && (
          <div className="p-4 rounded-lg border border-white/10 bg-white/5 space-y-3">
            <div>
              <label className="text-[11px] text-white/40 block mb-1">Device Name</label>
              <input
                type="text"
                value={newDevice.name}
                onChange={e => setNewDevice(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Air Quality Sensor AQ-01"
                className="w-full bg-black/60 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/20 focus:border-cyan-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 block mb-1">Type</label>
              <select
                value={newDevice.type}
                onChange={e => setNewDevice(d => ({ ...d, type: e.target.value }))}
                className="w-full bg-black/60 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white focus:border-cyan-500 outline-none"
              >
                {DEVICE_TYPES.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-white/40 block mb-1">Location</label>
              <input
                type="text"
                value={newDevice.location}
                onChange={e => setNewDevice(d => ({ ...d, location: e.target.value }))}
                placeholder="e.g. District-3 Basement Level"
                className="w-full bg-black/60 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/20 focus:border-cyan-500 outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 block mb-1">Link to DTU / District</label>
              <input
                type="text"
                value={newDevice.linkedDtu}
                onChange={e => setNewDevice(d => ({ ...d, linkedDtu: e.target.value }))}
                placeholder="e.g. dtu-dist-3-air"
                className="w-full bg-black/60 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white placeholder:text-white/20 focus:border-cyan-500 outline-none"
              />
            </div>
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('sensor:register-device')); }}
              className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm font-semibold transition-colors"
            >
              Register Device
            </button>
          </div>
        )}
      </section>

      {/* API Key */}
      <section className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Sensor API Key
        </h4>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-white/60 bg-black/40 rounded px-2 py-1 break-all">
            {apiKeyRevealed ? API_KEY : maskedKey}
          </code>
          <button
            onClick={() => setApiKeyRevealed(!apiKeyRevealed)}
            className="text-[10px] px-2 py-1 rounded border border-white/10 text-white/40 hover:text-white/70 transition-colors whitespace-nowrap"
          >
            {apiKeyRevealed ? 'Hide' : 'Reveal'}
          </button>
        </div>
      </section>
    </div>
  );
}
