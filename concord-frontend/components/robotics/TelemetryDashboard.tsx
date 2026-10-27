'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Activity, Play, Pause, AlertTriangle, Cpu, Thermometer, Radio, Loader2 } from 'lucide-react';
import type { RobotRow } from './FleetManager';
import { reasonSentence } from './telemetry-reasons';

// Joint velocity/torque are not produced by robotics.telemetry (no real source), so only angle is typed.
interface JointReading { joint: number; angle: number | null; unit?: string; loggedAt?: string }
interface Fault { code: string; severity: string; detail: string }
interface Telemetry {
  robotId: string; name: string; type: string; status: string;
  timestamp: string;
  joints: JointReading[]; dof: number | null;
  sensors: Record<string, number> | null;
  battery: number | null;
  faults: Fault[]; faultCount: number; health: string;
  telemetrySource: 'sensor_log' | 'none';
  telemetryReason: string | null;
}

function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function sensorValue(sensors: Record<string, number> | null, key: string): number | null {
  if (!sensors) return null;
  return finiteNum(sensors[key]);
}

/** Replaces a null value with "Not available" and the plain-language reason. */
function Unavailable({ reason }: { reason: string }) {
  return (
    <>
      <span className="block text-sm font-semibold text-gray-500">Not available</span>
      <span className="block text-[10px] text-gray-500">{reason}</span>
    </>
  );
}

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

  // Reason shown under every sensor card that has no value. A missing channel
  // on a robot that does have samples is "not recorded"; a robot with no log
  // at all gets the telemetryReason code.
  const sensorReason = reasonSentence(tele?.telemetryReason);
  const batteryValue = finiteNum(tele?.battery);
  const tempValue = sensorValue(tele?.sensors ?? null, 'temperature');
  const cpuValue = sensorValue(tele?.sensors ?? null, 'cpuLoad');
  const proxValue = sensorValue(tele?.sensors ?? null, 'proximity');

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
            <p className="text-xs text-gray-400">Not available — {sensorReason}.</p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="panel p-3 text-center">
              {batteryValue == null ? (
                <Unavailable reason={reasonSentence('not_recorded')} />
              ) : (
                <p className="text-2xl font-bold text-green-400">{`${Math.round(batteryValue)}%`}</p>
              )}
              <p className="text-[11px] text-gray-400">Battery</p>
            </div>
            <div className="panel p-3 text-center">
              <Thermometer className="w-4 h-4 mx-auto text-orange-400 mb-0.5" />
              {tempValue == null ? <Unavailable reason={sensorReason} /> : (
                <p className="text-xl font-bold font-mono">{`${tempValue}°C`}</p>
              )}
              <p className="text-[11px] text-gray-400">Core temp</p>
            </div>
            <div className="panel p-3 text-center">
              <Cpu className="w-4 h-4 mx-auto text-neon-cyan mb-0.5" />
              {cpuValue == null ? <Unavailable reason={sensorReason} /> : (
                <p className="text-xl font-bold font-mono">{`${cpuValue}%`}</p>
              )}
              <p className="text-[11px] text-gray-400">CPU load</p>
            </div>
            <div className="panel p-3 text-center">
              <Radio className="w-4 h-4 mx-auto text-purple-400 mb-0.5" />
              {proxValue == null ? <Unavailable reason={sensorReason} /> : (
                <p className="text-xl font-bold font-mono">{`${proxValue}m`}</p>
              )}
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
                    {finiteNum(value) == null ? (
                      <Unavailable reason={reasonSentence('not_recorded')} />
                    ) : (
                      <p className="font-mono text-neon-cyan">{String(value)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Joint angles bar grid */}
          <div className="panel p-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
              Joint state ({tele.dof == null ? 'Not available' : `${tele.dof} DOF`})
            </p>
            {tele.joints.length === 0 ? (
              <p className="text-xs text-gray-400">Not available — no joint samples logged.</p>
            ) : (
            <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {tele.joints.map(j => {
                const angle = finiteNum(j.angle);
                return (
                <div key={j.joint} className="p-2 rounded bg-black/30">
                  <div className="flex justify-between text-[11px] text-gray-400">
                    <span>Joint {j.joint}</span>
                    <span className="font-mono text-neon-cyan">{angle == null ? 'Not available' : `${angle}°`}</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full mt-1">
                    <div className="h-full bg-neon-cyan rounded-full"
                      style={{ width: `${angle == null ? 0 : (Math.abs(angle) / 180) * 100}%` }} />
                  </div>
                </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              Velocity and torque: Not available — {reasonSentence('not_recorded')}.
            </p>
            </>
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
