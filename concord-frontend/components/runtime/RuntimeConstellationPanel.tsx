'use client';

/**
 * Runtime constellation — designed ops surface for the sister systems
 * that are Concord domains: Dila, Predict, Zuko, Pentester, Trading,
 * Concordia. Health ≠ authorization; execute-locked domains stay locked
 * even when HEALTHY.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, Lock, Radio, ShieldAlert } from 'lucide-react';

type DomainHealth = {
  status: string;
  role?: string;
  present?: boolean;
  executeLocked?: boolean;
  note?: string;
  reason?: string;
  worldCount?: number;
  labUp?: number;
  inPosition?: number;
  halted?: boolean;
  clients?: { threeJs?: boolean; godot?: boolean; unity?: boolean };
  capabilities?: { registered?: number; reachable?: number };
};

type ConstellationPayload = {
  ok: boolean;
  overall?: string;
  domains?: Record<string, DomainHealth>;
  chain?: string[];
  observedAt?: number;
  recent?: Array<{ name: string; ts: number; payload?: Record<string, unknown> }>;
  error?: string;
};

const DOMAIN_ORDER = ['dila', 'predict', 'pentester', 'zuko', 'trading', 'concordia'] as const;

function tone(status?: string) {
  if (status === 'HEALTHY' || status === 'RUNNING') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'ABSENT') return 'border-slate-600/40 bg-slate-800/40 text-slate-400';
  if (status === 'DEGRADED') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (status === 'LOCKED') return 'border-orange-500/30 bg-orange-500/10 text-orange-200';
  return 'border-red-500/30 bg-red-500/10 text-red-200';
}

export function RuntimeConstellationPanel() {
  const [data, setData] = useState<ConstellationPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/runtime/constellation', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        setErr('admin_required');
        setData(null);
        return;
      }
      const json = (await res.json()) as ConstellationPayload;
      if (!json?.ok) {
        setErr(json?.error || `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData(json);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div data-testid="runtime-constellation-panel" className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[0.03] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
          <Radio className="h-4 w-4" aria-hidden="true" /> Runtime constellation
          {data?.overall && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-normal normal-case ${tone(data.overall)}`}>
              {data.overall}
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[11px] font-medium text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50"
        >
          {loading ? 'reading…' : 're-read'}
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
        Dila → Predict → Pentester → DTU → Zuko → Trading → Concordia. Sister systems are Concord domains on one bus. Health is not authorization — execute stays locked.
      </p>
      {err === 'admin_required' && (
        <p className="text-[11px] text-amber-200">Admin session required to read constellation health.</p>
      )}
      {err && err !== 'admin_required' && (
        <p role="alert" className="text-[11px] text-red-200">{err}</p>
      )}
      {data?.domains && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAIN_ORDER.map((id) => {
            const d = data.domains?.[id];
            if (!d) return null;
            return (
              <article key={id} className={`rounded-lg border px-3 py-2 ${tone(d.status)}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold capitalize tracking-wide">{id}</h3>
                  <span className="text-[10px] uppercase">{d.status}</span>
                </div>
                <p className="mt-0.5 text-[10px] opacity-80">{d.role || 'domain'}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                  {d.present != null && (
                    <>
                      <dt className="opacity-60">home</dt>
                      <dd>{d.present ? 'present' : 'not on this box'}</dd>
                    </>
                  )}
                  {d.capabilities?.registered != null && (
                    <>
                      <dt className="opacity-60">capabilities</dt>
                      <dd>{d.capabilities.reachable}/{d.capabilities.registered} reachable</dd>
                    </>
                  )}
                  {d.inPosition != null && (
                    <>
                      <dt className="opacity-60">in position</dt>
                      <dd>{d.inPosition}</dd>
                    </>
                  )}
                  {d.worldCount != null && (
                    <>
                      <dt className="opacity-60">worlds</dt>
                      <dd>{d.worldCount}</dd>
                    </>
                  )}
                  {d.labUp != null && (
                    <>
                      <dt className="opacity-60">lab ports</dt>
                      <dd>{d.labUp} up</dd>
                    </>
                  )}
                  {d.clients && (
                    <>
                      <dt className="opacity-60">clients</dt>
                      <dd>
                        {[d.clients.threeJs && 'Three', d.clients.godot && 'Godot', d.clients.unity && 'Unity'].filter(Boolean).join(' · ') || 'none'}
                      </dd>
                    </>
                  )}
                </dl>
                {d.executeLocked && (
                  <p className="mt-2 flex items-center gap-1 text-[10px]">
                    <Lock className="h-3 w-3" aria-hidden="true" /> execute locked
                  </p>
                )}
                {d.reason && <p className="mt-1 text-[10px] opacity-70">{d.reason}</p>}
              </article>
            );
          })}
        </div>
      )}
      {data?.recent && data.recent.length > 0 && (
        <div className="mt-3 border-t border-fuchsia-500/10 pt-2">
          <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300/80">
            <Activity className="h-3 w-3" aria-hidden="true" /> bus
          </h3>
          <ul className="max-h-28 space-y-0.5 overflow-auto font-mono text-[10px] text-slate-400">
            {data.recent.slice(0, 12).map((ev, i) => (
              <li key={`${ev.ts}-${ev.name}-${i}`}>
                <span className="text-slate-500">{new Date(ev.ts).toLocaleTimeString()}</span>{' '}
                <span className="text-fuchsia-200/90">{ev.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
        A prediction is not a trade. A finding is not an exploit. A healthy pentester is still locked.
      </p>
    </div>
  );
}
