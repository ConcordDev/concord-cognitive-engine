'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Bot, Plus, Trash2, RefreshCw, Power, Activity, AlertCircle, Loader2 } from 'lucide-react';

export interface RobotRow {
  id: string;
  name: string;
  type: string;
  status: string;
  firmware: string;
  battery: number;
  batteryCapacityWh: number;
  powerDrawW: number;
  errorCount: number;
  lastCommand: string;
  position?: { x: number; y: number; z: number };
}

const TYPES = ['arm', 'mobile', 'drone', 'humanoid', 'swarm', 'custom'];
const STATUSES = ['idle', 'running', 'error', 'maintenance', 'offline'];
const STATUS_COLOR: Record<string, string> = {
  idle: 'text-blue-400', running: 'text-green-400', error: 'text-red-400',
  maintenance: 'text-yellow-400', offline: 'text-gray-400',
};

/**
 * FleetManager — multi-robot management surface. Wires
 * robotics.fleetList / fleetRegister / fleetUpdate / fleetRemove.
 */
export function FleetManager({ onSelect, selectedId }: { onSelect?: (r: RobotRow) => void; selectedId?: string | null }) {
  const [robots, setRobots] = useState<RobotRow[]>([]);
  const [counts, setCounts] = useState({ total: 0, online: 0, running: 0, errors: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('arm');
  const [capWh, setCapWh] = useState('50');
  const [drawW, setDrawW] = useState('35');

  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    // lensRun never rejects (it wraps its own throw → { ok:false, error }), but
    // guard anyway so a thrown fetch can never strand the spinner or silently
    // empty the fleet list.
    let r: Awaited<ReturnType<typeof lensRun>>;
    try {
      r = await lensRun('robotics', 'fleetList', {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load fleet');
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { robots: RobotRow[]; total: number; online: number; running: number; errors: number };
      setRobots(res.robots || []);
      setCounts({ total: res.total, online: res.online, running: res.running, errors: res.errors });
      setErr(null);
    } else {
      setErr(r.data?.error || 'Failed to load fleet');
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const register = async () => {
    if (!name.trim()) { setErr('Robot name required'); return; }
    setBusy('register'); setErr(null);
    const r = await lensRun('robotics', 'fleetRegister', {
      name: name.trim(), type,
      batteryCapacityWh: parseFloat(capWh) || 50,
      powerDrawW: parseFloat(drawW) || 35,
    });
    if (r.data?.ok) { setName(''); await load(); }
    else setErr(r.data?.error || 'Register failed');
    setBusy(null);
  };

  const updateStatus = async (robotId: string, status: string) => {
    setBusy(robotId); setErr(null);
    const r = await lensRun('robotics', 'fleetUpdate', { robotId, status });
    if (r.data?.ok) await load();
    else setErr(r.data?.error || 'Update failed');
    setBusy(null);
  };

  const remove = async (robotId: string) => {
    setBusy(robotId); setErr(null);
    const r = await lensRun('robotics', 'fleetRemove', { robotId });
    if (r.data?.ok) await load();
    else setErr(r.data?.error || 'Remove failed');
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: counts.total, icon: Bot, color: 'text-neon-cyan' },
          { label: 'Online', value: counts.online, icon: Power, color: 'text-green-400' },
          { label: 'Running', value: counts.running, icon: Activity, color: 'text-neon-cyan' },
          { label: 'Errors', value: counts.errors, icon: AlertCircle, color: 'text-red-400' },
        ].map(c => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="panel p-3 text-center">
              <Icon className={`w-5 h-5 mx-auto mb-1 ${c.color}`} />
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
              <p className="text-[11px] text-gray-400">{c.label}</p>
            </div>
          );
        })}
      </div>

      <div className="panel p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Register Robot</h3>
          <button onClick={load} className="p-1 rounded hover:bg-white/10 text-gray-400" aria-label="Refresh fleet">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Robot name"
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm" />
          <select value={type} onChange={e => setType(e.target.value)}
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm">
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={capWh} onChange={e => setCapWh(e.target.value)} placeholder="Battery Wh" type="number"
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm font-mono" />
          <input value={drawW} onChange={e => setDrawW(e.target.value)} placeholder="Draw W" type="number"
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm font-mono" />
          <button onClick={register} disabled={busy === 'register'}
            className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50 flex items-center justify-center gap-1">
            {busy === 'register' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Register
          </button>
        </div>
      </div>

      {err && !loadFailed && !loading && <p className="text-xs text-red-400">{err}</p>}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-6 text-neon-cyan">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="sr-only">Loading fleet…</span>
        </div>
      ) : loadFailed ? (
        <div role="alert" className="panel p-4 text-center space-y-2 border border-red-500/30 bg-red-500/5">
          <AlertCircle className="w-6 h-6 mx-auto text-red-400" />
          <p className="text-sm text-red-300">{err || 'Failed to load fleet'}</p>
          <button onClick={load}
            className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      ) : robots.length === 0 ? (
        <div className="panel p-4 text-center space-y-1.5 py-6">
          <Bot className="w-6 h-6 mx-auto text-gray-500" />
          <p className="text-gray-400 text-sm">No robots registered yet.</p>
          <p className="text-[11px] text-gray-500">Register your first robot above to start managing a fleet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {robots.map(robot => (
            <div key={robot.id}
              className={`panel p-3 flex items-center justify-between cursor-pointer transition-colors ${selectedId === robot.id ? 'ring-1 ring-neon-cyan/50 bg-neon-cyan/5' : 'hover:bg-white/5'}`}
              onClick={() => onSelect?.(robot)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div className="flex items-center gap-3">
                <Bot className="w-5 h-5 text-neon-cyan shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{robot.name}</span>
                    <span className={`text-[11px] uppercase ${STATUS_COLOR[robot.status] || 'text-gray-400'}`}>{robot.status}</span>
                  </div>
                  <div className="flex gap-3 text-[11px] text-gray-400 mt-0.5">
                    <span>{robot.type}</span>
                    <span>FW {robot.firmware}</span>
                    <span>{Math.round(robot.battery)}% batt</span>
                    {robot.errorCount > 0 && <span className="text-red-400">{robot.errorCount} err</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <select value={robot.status} onChange={e => updateStatus(robot.id, e.target.value)}
                  disabled={busy === robot.id}
                  className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[11px]">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => remove(robot.id)} disabled={busy === robot.id}
                  className="text-gray-400 hover:text-red-400" aria-label="Remove robot">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
