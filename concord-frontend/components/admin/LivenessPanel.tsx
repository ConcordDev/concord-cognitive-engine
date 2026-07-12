'use client';

/**
 * F2 — Substrate Liveness panel.
 *
 * Renders GET /api/admin/liveness: "is real data accumulating + are people
 * retained?" — substrate gravity (records living here per real creator + 7d
 * growth = the mass of the moat) composed with the funnel (F1), distribution
 * K-factor (F5), and royalty-cascade solvency (F4). Operator surface; auth-gated;
 * 5s auto-refresh while visible. Degrades to a "no data / off" note rather than
 * a white-screen when the endpoint 204s (CONCORD_FTUE_TELEMETRY off) or errors.
 */

import { useCallback, useEffect, useState } from 'react';
import { Database, TrendingUp, Users, Share2, ShieldCheck, AlertTriangle } from 'lucide-react';

interface LivenessHeadline {
  recordsLiving: number;
  recordsPerCreator: number;
  last7dRecords: number;
  conversionRate: number | null;
  abandonRate: number | null;
  kFactor: number | null;
  viral: boolean;
  economySolvent: boolean | null;
}
interface LivenessReport {
  ok: boolean;
  generatedAt?: number;
  headline?: LivenessHeadline;
  reason?: string;
}

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 1000) / 10}%`;
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'bad' ? 'text-red-400' : 'text-white';
  return (
    <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-zinc-400">{icon}<span>{label}</span></div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

interface LivenessPanelProps {
  /**
   * Wave 4 gap-closure (ops-telemetry-capability-map.md) — this panel's own
   * unjittered 5s setInterval used to run independently of the ops-telemetry
   * page's own 5s refresh loop, so the page fired two uncoordinated 5s
   * network round-trips. When a `refreshToken` is supplied, the host page
   * owns the single interval and bumps this token on each tick; this panel
   * refetches on token change instead of running its own timer. Omit it to
   * keep this panel self-sufficient for any other/standalone mount.
   */
  refreshToken?: number;
}

export function LivenessPanel({ refreshToken }: LivenessPanelProps = {}) {
  const [report, setReport] = useState<LivenessReport | null>(null);
  const [off, setOff] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch('/api/admin/liveness', { credentials: 'include' });
      if (res.status === 204) { setOff(true); return; }
      const data = await res.json();
      setOff(false);
      setReport(data);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const externallyDriven = refreshToken !== undefined;
  useEffect(() => {
    if (!externallyDriven || refreshToken === 0) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on the host's shared tick
  }, [refreshToken]);
  useEffect(() => {
    if (externallyDriven) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [refresh, externallyDriven]);

  const h = report?.headline;

  return (
    <section className="space-y-3" data-testid="liveness-panel">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Substrate Liveness</h2>
        <span className="text-xs text-zinc-500">— is real data accumulating + are people retained</span>
      </div>

      {off && (
        <p className="text-xs text-zinc-400 rounded-lg bg-zinc-900/60 border border-zinc-800 p-3">
          Liveness telemetry is off (set <code className="text-zinc-300">CONCORD_FTUE_TELEMETRY=1</code> to enable).
        </p>
      )}
      {err && (
        <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{err}</p>
      )}

      {!off && h && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat icon={<Database className="w-3.5 h-3.5" />} label="Records living" value={h.recordsLiving.toLocaleString()} />
          <Stat icon={<Users className="w-3.5 h-3.5" />} label="Per creator" value={String(h.recordsPerCreator)} />
          <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Last 7d" value={h.last7dRecords.toLocaleString()} tone={h.last7dRecords > 0 ? 'good' : undefined} />
          <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Conversion" value={pct(h.conversionRate)} />
          <Stat icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Abandon" value={pct(h.abandonRate)} tone={h.abandonRate != null && h.abandonRate > 0.3 ? 'warn' : undefined} />
          <Stat icon={<Share2 className="w-3.5 h-3.5" />} label="K-factor" value={h.kFactor == null ? '—' : String(h.kFactor)} tone={h.viral ? 'good' : 'warn'} />
          <Stat icon={<Share2 className="w-3.5 h-3.5" />} label="Viral" value={h.viral ? 'yes' : 'no'} tone={h.viral ? 'good' : undefined} />
          <Stat icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Economy" value={h.economySolvent == null ? '—' : h.economySolvent ? 'solvent' : 'AT RISK'} tone={h.economySolvent === false ? 'bad' : 'good'} />
        </div>
      )}
    </section>
  );
}

export default LivenessPanel;
