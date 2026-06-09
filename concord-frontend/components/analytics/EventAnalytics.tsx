'use client';

/**
 * EventAnalytics — Mixpanel / Amplitude 2026-shape product analytics:
 * track events, then build conversion funnels, segment by property and
 * read retention over the stored event log. Wires the analytics.event-*,
 * analytics.funnel-*, analytics.segment, analytics.retention-report and
 * analytics.analytics-dashboard macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Plus, Filter, Loader2, TrendingDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Dash { totalEvents: number; uniqueUsers: number; eventsToday: number; eventTypes: number; savedFunnels: number }
interface TopEvent { name: string; count: number }
interface FunnelStep { step: number; event: string; count: number; conversionFromStart: number; conversionFromPrev: number }
interface FunnelResult { steps: FunnelStep[]; totalStarters: number; overallConversion: number }
interface Segment { value: string; count: number; pct: number }
interface RetentionDay { day: number; retained: number; pct: number }

export function EventAnalytics() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [topEvents, setTopEvents] = useState<TopEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // event tracker
  const [evt, setEvt] = useState({ name: '', distinctId: '', propKey: '', propVal: '' });
  // funnel
  const [steps, setSteps] = useState('');
  const [funnel, setFunnel] = useState<FunnelResult | null>(null);
  // segment
  const [seg, setSeg] = useState({ eventName: '', propertyKey: '' });
  const [segResult, setSegResult] = useState<Segment[] | null>(null);
  // retention
  const [ret, setRet] = useState<RetentionDay[] | null>(null);

  const refresh = useCallback(async () => {
    const [d, st] = await Promise.all([
      lensRun('analytics', 'analytics-dashboard', {}),
      lensRun('analytics', 'event-stats', {}),
    ]);
    setDash((d.data?.result as Dash) || null);
    setTopEvents((st.data?.result?.topEvents as TopEvent[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function track() {
    if (!evt.name.trim()) return;
    const properties = evt.propKey.trim() ? { [evt.propKey.trim()]: evt.propVal.trim() } : {};
    await lensRun('analytics', 'event-track', { name: evt.name.trim(), distinctId: evt.distinctId.trim() || 'anon', properties });
    setEvt({ ...evt, name: '' });
    await refresh();
  }
  async function buildFunnel() {
    const arr = steps.split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length < 2) return;
    const r = await lensRun('analytics', 'funnel-build', { steps: arr });
    setFunnel(r.data?.ok ? (r.data.result as FunnelResult) : null);
  }
  async function runSegment() {
    if (!seg.eventName.trim() || !seg.propertyKey.trim()) return;
    const r = await lensRun('analytics', 'segment', { eventName: seg.eventName.trim(), propertyKey: seg.propertyKey.trim() });
    setSegResult(r.data?.ok ? (r.data.result?.segments as Segment[]) : null);
  }
  async function runRetention() {
    const arr = steps.split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length < 1) return;
    const r = await lensRun('analytics', 'retention-report', { cohortEvent: arr[0], returnEvent: arr[1] || arr[0] });
    setRet(r.data?.ok ? (r.data.result?.retention as RetentionDay[]) : null);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Event Analytics</h3>
        <span className="text-[11px] text-zinc-400">Mixpanel / Amplitude shape</span>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Events', dash.totalEvents], ['Users', dash.uniqueUsers], ['Today', dash.eventsToday], ['Types', dash.eventTypes]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Event tracker */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Track an event</p>
        <div className="flex flex-wrap gap-1.5">
          <input value={evt.name} onChange={e => setEvt({ ...evt, name: e.target.value })} placeholder="event name"
            className="flex-1 min-w-[110px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <input value={evt.distinctId} onChange={e => setEvt({ ...evt, distinctId: e.target.value })} placeholder="user id"
            className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <input value={evt.propKey} onChange={e => setEvt({ ...evt, propKey: e.target.value })} placeholder="prop"
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <input value={evt.propVal} onChange={e => setEvt({ ...evt, propVal: e.target.value })} placeholder="value"
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <button onClick={track} disabled={!evt.name.trim()}
            className="px-2.5 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Track
          </button>
        </div>
        {topEvents.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {topEvents.slice(0, 8).map(e => (
              <button key={e.name} onClick={() => setEvt({ ...evt, name: e.name })}
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-amber-300">{e.name} · {e.count}</button>
            ))}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {/* Funnel + retention */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Funnel / retention</p>
          <input value={steps} onChange={e => setSteps(e.target.value)} placeholder="event steps, comma-separated"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 mb-1.5" />
          <div className="flex gap-1.5 mb-2">
            <button onClick={buildFunnel} className="flex-1 px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold">Build funnel</button>
            <button onClick={runRetention} className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
              <TrendingDown className="w-3 h-3" />Retention
            </button>
          </div>
          {funnel && (
            <div className="space-y-1 mb-2">
              {funnel.steps.map(s => (
                <div key={s.step} className="text-[11px]">
                  <div className="flex justify-between text-zinc-300"><span>{s.step}. {s.event}</span><span>{s.count} · {s.conversionFromStart}%</span></div>
                  <div className="h-1.5 bg-zinc-800 rounded overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${s.conversionFromStart}%` }} /></div>
                </div>
              ))}
              <p className="text-[10px] text-amber-300">Overall conversion: {funnel.overallConversion}%</p>
            </div>
          )}
          {ret && (
            <div className="flex items-end gap-0.5 h-12 mt-1">
              {ret.map(d => (
                <div key={d.day} className="flex-1 bg-emerald-600/70 rounded-sm" style={{ height: `${Math.max(4, d.pct)}%` }} title={`D${d.day}: ${d.pct}%`} />
              ))}
            </div>
          )}
        </div>

        {/* Segment */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Segment by property</p>
          <div className="flex gap-1.5 mb-2">
            <input value={seg.eventName} onChange={e => setSeg({ ...seg, eventName: e.target.value })} placeholder="event"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={seg.propertyKey} onChange={e => setSeg({ ...seg, propertyKey: e.target.value })} placeholder="property"
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button aria-label="Filter" onClick={runSegment} className="px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white inline-flex items-center gap-1">
              <Filter className="w-3 h-3" />
            </button>
          </div>
          {segResult && (
            <ul className="space-y-1">
              {segResult.length === 0 && <li className="text-[11px] text-zinc-400 italic">No data.</li>}
              {segResult.map(s => (
                <li key={s.value} className="text-[11px]">
                  <div className="flex justify-between text-zinc-300"><span className="truncate">{s.value}</span><span>{s.count} · {s.pct}%</span></div>
                  <div className="h-1.5 bg-zinc-800 rounded overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${s.pct}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
