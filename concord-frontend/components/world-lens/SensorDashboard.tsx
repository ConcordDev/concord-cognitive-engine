'use client';

import React, { useState, useMemo } from 'react';

// NOTE: There is no IoT/sensor domain on the backend (no `sensor`, `device`,
// or `iot` macro exists). The closest real substrate is the embodied
// `environment` signal layer, but it does not model registered devices,
// anomaly alerts, or API keys. Rather than fabricate readings, this panel
// starts empty and shows honest empty states.
// TODO: wire to backend once a sensor/device-registry domain exists.

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

const DEVICE_TYPES = ['Environmental', 'Structural', 'Energy', 'Hydraulic', 'Acoustic', 'Gas'];

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
  // EMPTY by design — no sensor backend exists. See file header TODO.
  const [devices] = useState<SensorDevice[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDevice, setNewDevice] = useState<NewDeviceForm>({
    name: '',
    type: DEVICE_TYPES[0],
    location: '',
    linkedDtu: '',
  });
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
      {filteredDevices.length === 0 && (
        <div className="py-12 text-center text-sm text-white/40 border border-dashed border-white/10 rounded-lg">
          No sensor devices yet.
        </div>
      )}
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
        {anomalies.length === 0 && (
          <p className="text-xs text-white/30">No anomalies yet.</p>
        )}
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
    </div>
  );
}
