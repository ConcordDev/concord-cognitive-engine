'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Activity, Play, Pause, AlertTriangle, Cpu, Thermometer, Radio, Loader2 } from 'lucide-react';
import type { RobotRow } from './FleetManager';

interface JointReading { joint: number; angle: number | null; velocity?: number | null; torque?: number | null; unit?: string }
interface Fault { code: string; severity: string; detail: string }
interface Telemetry {
  robotId: string; name: string; type: string; status: string;
  tick?: number; timestamp: string;
  joints: JointReading[]; dof: number | null;
  sensors: Record<string, number> | null;
  battery: number | null;
  faults: Fault[]; faultCount: number; health: string;
  telemetrySource?: string;
  telemetryReason?: string | null;
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function sensorValue(sensors: Record<string, number> | null, key: string): number | null {
  if (!sensors) return null;
  return finiteNum(sensors[key]);
}

const SENSOR_REASON: Record<string, string> = {
  no_sensor_log: 'No sensor samples logged — use the Sensors tab / sensorLog',
};

const HEALTH_COLOR: Record<string, string> = {
  nominal: 'text-green-400', degraded: 'text-yellow-400', critical: 'text-red-400',
};

/**
 * TelemetryDashboard — live joint angles, sensors, battery, fault states.
 * Polls robotics.telemetry on a tick while streaming, charts joint history.
 */
export function TelemetryDashboard({ robot }: { robot: RobotRow | null }) {
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<Array<Record<string, number>>>([]);
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tickRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async (robotId: string) => {
    tickRef.current += 1;
    const r = await lensRun('robotics', 'telemetry', { robotId, tick: tickRef.current });
    if (r.data?.ok && r.data.result) {
      const t = r.data.result as Telemetry;
      setTele(t);
      setHistory(prev => {
        const row: Record<string, number> = { tick: tickRef.current };
        const battery = finiteNum(t.battery);
        if (battery != null) row.battery = battery;
        const sensors = t.sensors && typeof t.sensors === 'object' ? t.sensors : null;
        if (sensors) {
          for (const [channel, value] of Object.entries(sensors)) {
            const n = finiteNum(value);
            if (n != null) row[channel] = n;
          }
        }
        for (const j of (Array.isArray(t.joints) ? t.joints : []).slice(0, 3)) {
          const angle = finiteNum(j.angle);
          if (angle != null) row[`j${j.joint}`] = angle;
        }
        return [...prev.slice(-39), row];
      });
      setErr(null);
    } else setErr(r.data?.error || 'Telemetry failed');
  }, []);

  // Stop streaming and reset when robot changes.
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setStreaming(false);
    setHistory([]);
    setTele(null);
    tickRef.current = 0;
    if (robot) poll(robot.id);
  }, [robot, poll]);

  useEffect(() => {
    if (streaming && robot) {
      timerRef.current = setInterval(() => poll(robot.id), 1500);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
  }, [streaming, robot, poll]);

  if (!robot) {
    return <p className="text-gray-400 text-sm text-center py-6">Select a robot to view live telemetry.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-cyan" /> Telemetry · {robot.name}
          {tele && <span className={`text-[11px] uppercase ${HEALTH_COLOR[tele.health]}`}>{tele.health}</span>}
        </h3>
        <button onClick={() => setStreaming(s => !s)}
          className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 ${streaming ? 'bg-red-400/20 text-red-400' : 'bg-green-400/20 text-green-400'}`}>
          {streaming ? <><Pause className="w-3.5 h-3.5" /> Stop stream</> : <><Play className="w-3.5 h-3.5" /> Stream live</>}
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {!tele ? (
        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-neon-cyan" /></div>
      ) : (
        <>
          {tele.telemetryReason && (
            <p className="text-xs text-gray-400">{SENSOR_REASON[tele.telemetryReason] || tele.telemetryReason}</p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="panel p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{finiteNum(tele.battery) == null ? '—' : `${Math.round(finiteNum(tele.battery)!)}%`}</p>
              <p className="text-[11px] text-gray-400">Battery</p>
            </div>
            <div className="panel p-3 text-center">
              <Thermometer className="w-4 h-4 mx-auto text-orange-400 mb-0.5" />
              <p className="text-xl font-bold font-mono">{sensorValue(tele.sensors, 'temperature') == null ? '—' : `${sensorValue(tele.sensors, 'temperature')}°C`}</p>
              <p className="text-[11px] text-gray-400">Core temp</p>
            </div>
            <div className="panel p-3 text-center">
              <Cpu className="w-4 h-4 mx-auto text-neon-cyan mb-0.5" />
              <p className="text-xl font-bold font-mono">{sensorValue(tele.sensors, 'cpuLoad') == null ? '—' : `${sensorValue(tele.sensors, 'cpuLoad')}%`}</p>
              <p className="text-[11px] text-gray-400">CPU load</p>
            </div>
            <div className="panel p-3 text-center">
              <Radio className="w-4 h-4 mx-auto text-purple-400 mb-0.5" />
              <p className="text-xl font-bold font-mono">{sensorValue(tele.sensors, 'proximity') == null ? '—' : `${sensorValue(tele.sensors, 'proximity')}m`}</p>
              <p className="text-[11px] text-gray-400">Proximity</p>
            </div>
          </div>

          {tele.sensors && Object.keys(tele.sensors).some(k => !['temperature', 'cpuLoad', 'proximity'].includes(k)) && (
            <div className="panel p-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Logged channels</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(tele.sensors).filter(([k]) => !['temperature', 'cpuLoad', 'proximity'].includes(k)).map(([channel, value]) => (
                  <div key={channel} className="p-2 rounded bg-black/30 text-xs">
                    <p className="text-gray-400">{channel}</p>
                    <p className="font-mono text-neon-cyan">{finiteNum(value) == null ? '—' : String(value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Joint angles bar grid */}
          <div className="panel p-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Joint state ({tele.dof == null ? '—' : tele.dof} DOF)</p>
            {tele.joints.length === 0 ? (
              <p className="text-xs text-gray-400">No joint samples logged.</p>
            ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {tele.joints.map(j => {
                const angle = finiteNum(j.angle);
                return (
                <div key={j.joint} className="p-2 rounded bg-black/30">
                  <div className="flex justify-between text-[11px] text-gray-400">
                    <span>Joint {j.joint}</span>
                    <span className="font-mono text-neon-cyan">{angle == null ? '—' : `${angle}°`}</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full mt-1">
                    <div className="h-full bg-neon-cyan rounded-full"
                      style={{ width: `${angle == null ? 0 : (Math.abs(angle) / 180) * 100}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                    <span>ω {finiteNum(j.velocity) == null ? '—' : j.velocity}</span>
                    <span>τ {finiteNum(j.torque) == null ? '—' : j.torque}</span>
                  </div>
                </div>
                );
              })}
            </div>
            )}
          </div>

          {/* Joint history chart */}
          <div className="panel p-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Joint angle trace</p>
            <ChartKit
              kind="line"
              data={history}
              xKey="tick"
              series={[
                { key: 'j1', label: 'Joint 1', color: '#22d3ee' },
                { key: 'j2', label: 'Joint 2', color: '#a855f7' },
                { key: 'j3', label: 'Joint 3', color: '#f59e0b' },
              ]}
              height={180}
            />
          </div>

          {/* Faults */}
          <div className="panel p-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Fault states ({tele.faultCount})
            </p>
            {tele.faults.length === 0 ? (
              <p className="text-xs text-green-400">All systems nominal — no active faults.</p>
            ) : (
              <div className="space-y-1.5">
                {tele.faults.map(f => (
                  <div key={f.code} className={`p-2 rounded text-xs flex items-start gap-2 ${f.severity === 'critical' ? 'bg-red-400/10 text-red-400' : 'bg-yellow-400/10 text-yellow-400'}`}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-mono font-semibold">{f.code}</span>
                      <p className="text-gray-400">{f.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
