'use client';

import { useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  AlertOctagon, Gauge, Network, Plus, Trash2, Play, Loader2, ShieldAlert,
} from 'lucide-react';

type AnalysisTab = 'incidents' | 'capacity' | 'dependencies';

interface IncidentRow {
  id: string;
  service: string;
  severity: 'critical' | 'major' | 'minor';
  start: string; // datetime-local value
  end: string; // datetime-local value, optional
}

interface MetricRow {
  id: string;
  timestamp: string;
  cpu: number;
  memory: number;
  disk: number;
  connections: number;
}

interface ServiceRow {
  id: string;
  name: string;
  tier: string;
  dependencies: string; // comma-separated names
}

const uid = () => Math.random().toString(36).slice(2, 9);
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function StatChip({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  const cls = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-neon-green' : 'text-white';
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-sm font-semibold font-mono ${cls}`}>{value}</p>
    </div>
  );
}

export function PlatformAnalysisPanel() {
  const [tab, setTab] = useState<AnalysisTab>('incidents');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Incidents (feeds both slaCompute + incidentTimeline) ─────────────────
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [incidentDraft, setIncidentDraft] = useState<Omit<IncidentRow, 'id'>>({
    service: '', severity: 'major', start: nowLocal(), end: '',
  });
  const [slaTarget, setSlaTarget] = useState(99.9);
  const [slaResult, setSlaResult] = useState<Record<string, unknown> | null>(null);
  const [timelineResult, setTimelineResult] = useState<Record<string, unknown> | null>(null);

  const addIncident = () => {
    if (!incidentDraft.service.trim() || !incidentDraft.start) return;
    setIncidents((prev) => [...prev, { id: uid(), ...incidentDraft, service: incidentDraft.service.trim() }]);
    setIncidentDraft({ service: '', severity: 'major', start: nowLocal(), end: '' });
  };
  const removeIncident = (id: string) => setIncidents((prev) => prev.filter((r) => r.id !== id));

  const runSla = async () => {
    if (incidents.length === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await lensRun('platform', 'slaCompute', {
        incidents: incidents.map((i) => ({ service: i.service, severity: i.severity, start: new Date(i.start).toISOString(), end: i.end ? new Date(i.end).toISOString() : undefined })),
        target: slaTarget,
      });
      if (res.data.ok === false) setError(res.data.error || 'SLA compute failed');
      else setSlaResult(res.data.result as Record<string, unknown>);
    } catch (e) { setError(e instanceof Error ? e.message : 'SLA compute failed'); }
    finally { setBusy(false); }
  };

  const runTimeline = async () => {
    if (incidents.length === 0) return;
    setBusy(true); setError(null);
    try {
      const events: Record<string, unknown>[] = [];
      for (const i of incidents) {
        events.push({ timestamp: new Date(i.start).toISOString(), type: 'alert', service: i.service, message: `${i.service} incident opened`, severity: i.severity });
        if (i.end) events.push({ timestamp: new Date(i.end).toISOString(), type: 'resolution', service: i.service, message: `${i.service} incident resolved`, severity: i.severity });
      }
      const res = await lensRun('platform', 'incidentTimeline', { events });
      if (res.data.ok === false) setError(res.data.error || 'Timeline analysis failed');
      else setTimelineResult(res.data.result as Record<string, unknown>);
    } catch (e) { setError(e instanceof Error ? e.message : 'Timeline analysis failed'); }
    finally { setBusy(false); }
  };

  // ── Capacity plan ─────────────────────────────────────────────────────────
  const [metricRows, setMetricRows] = useState<MetricRow[]>([]);
  const [metricDraft, setMetricDraft] = useState<Omit<MetricRow, 'id' | 'timestamp'>>({ cpu: 50, memory: 50, disk: 50, connections: 50 });
  const [forecastDays, setForecastDays] = useState(30);
  const [capacityResult, setCapacityResult] = useState<Record<string, unknown> | null>(null);

  const addMetric = () => {
    setMetricRows((prev) => [...prev, { id: uid(), timestamp: new Date(Date.now() - (prev.length ? 0 : 0)).toISOString(), ...metricDraft }]);
  };
  const removeMetric = (id: string) => setMetricRows((prev) => prev.filter((r) => r.id !== id));

  const runCapacity = async () => {
    if (metricRows.length < 2) return;
    setBusy(true); setError(null);
    try {
      // Space samples a day apart so the macro's day-based forecast reads sensibly.
      const base = Date.now() - metricRows.length * 86400000;
      const metrics = metricRows.map((m, i) => ({ timestamp: new Date(base + i * 86400000).toISOString(), cpu: m.cpu, memory: m.memory, disk: m.disk, connections: m.connections }));
      const res = await lensRun('platform', 'capacityPlan', { metrics, forecastDays });
      if (res.data.ok === false) setError(res.data.error || 'Capacity plan failed');
      else setCapacityResult(res.data.result as Record<string, unknown>);
    } catch (e) { setError(e instanceof Error ? e.message : 'Capacity plan failed'); }
    finally { setBusy(false); }
  };

  // ── Dependency map ─────────────────────────────────────────────────────────
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [serviceDraft, setServiceDraft] = useState<Omit<ServiceRow, 'id'>>({ name: '', tier: 'app', dependencies: '' });
  const [depResult, setDepResult] = useState<Record<string, unknown> | null>(null);

  const addService = () => {
    if (!serviceDraft.name.trim()) return;
    setServices((prev) => [...prev, { id: uid(), ...serviceDraft, name: serviceDraft.name.trim() }]);
    setServiceDraft({ name: '', tier: 'app', dependencies: '' });
  };
  const removeService = (id: string) => setServices((prev) => prev.filter((r) => r.id !== id));

  const runDependencies = async () => {
    if (services.length === 0) return;
    setBusy(true); setError(null);
    try {
      const res = await lensRun('platform', 'dependencyMap', {
        services: services.map((s) => ({
          name: s.name, tier: s.tier,
          dependencies: s.dependencies.split(',').map((d) => d.trim()).filter(Boolean),
        })),
      });
      if (res.data.ok === false) setError(res.data.error || 'Dependency analysis failed');
      else setDepResult(res.data.result as Record<string, unknown>);
    } catch (e) { setError(e instanceof Error ? e.message : 'Dependency analysis failed'); }
    finally { setBusy(false); }
  };

  const serviceNames = useMemo(() => services.map((s) => s.name), [services]);

  return (
    <div className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-neon-blue" /> Platform Analysis
        </h2>
        <div className="flex gap-1 rounded-lg bg-lattice-deep p-1 text-xs">
          {([
            { key: 'incidents', label: 'Incidents & SLA', icon: AlertOctagon },
            { key: 'capacity', label: 'Capacity Plan', icon: Gauge },
            { key: 'dependencies', label: 'Dependency Map', icon: Network },
          ] as const).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${tab === t.key ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white'}`}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">{error}</p>}

      {tab === 'incidents' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Log real incidents (service, severity, start/end) — computes an actual SLA/error-budget
            report and an incident timeline with cascade + service-correlation detection from the
            same log. Nothing here is fabricated; both analyses are only as good as what you record.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <input value={incidentDraft.service} onChange={(e) => setIncidentDraft((d) => ({ ...d, service: e.target.value }))}
              placeholder="Service name" className="input-lattice text-xs col-span-2 sm:col-span-1" />
            <select value={incidentDraft.severity} onChange={(e) => setIncidentDraft((d) => ({ ...d, severity: e.target.value as IncidentRow['severity'] }))}
              className="input-lattice text-xs">
              <option value="critical">Critical</option>
              <option value="major">Major</option>
              <option value="minor">Minor</option>
            </select>
            <input type="datetime-local" value={incidentDraft.start} onChange={(e) => setIncidentDraft((d) => ({ ...d, start: e.target.value }))}
              className="input-lattice text-xs" />
            <input type="datetime-local" value={incidentDraft.end} onChange={(e) => setIncidentDraft((d) => ({ ...d, end: e.target.value }))}
              placeholder="Resolved at (optional)" className="input-lattice text-xs" />
            <button onClick={addIncident} disabled={!incidentDraft.service.trim()}
              className="btn-secondary text-xs flex items-center justify-center gap-1 disabled:opacity-40">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {incidents.length > 0 && (
            <div className="space-y-1">
              {incidents.map((i) => (
                <div key={i.id} className="flex items-center gap-2 rounded bg-black/30 px-2 py-1 text-xs">
                  <ShieldAlert className={`w-3 h-3 ${i.severity === 'critical' ? 'text-rose-400' : i.severity === 'major' ? 'text-amber-400' : 'text-zinc-400'}`} />
                  <span className="font-medium">{i.service}</span>
                  <span className="text-gray-500">{i.severity}</span>
                  <span className="flex-1 text-gray-500">{new Date(i.start).toLocaleString()} → {i.end ? new Date(i.end).toLocaleString() : 'ongoing'}</span>
                  <button onClick={() => removeIncident(i.id)} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">SLA target %</label>
            <input type="number" step={0.01} min={90} max={100} value={slaTarget} onChange={(e) => setSlaTarget(Number(e.target.value) || 99.9)}
              className="input-lattice w-20 text-xs" />
            <button onClick={runSla} disabled={busy || incidents.length === 0} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Compute SLA
            </button>
            <button onClick={runTimeline} disabled={busy || incidents.length === 0} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Build Timeline
            </button>
          </div>
          {slaResult && !('message' in slaResult) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatChip label="Uptime" value={`${String(slaResult.uptimePercent)}%`} tone={slaResult.meetsTarget ? 'good' : 'bad'} />
              <StatChip label="Nines" value={String(slaResult.nines)} />
              <StatChip label="MTTR" value={slaResult.mttr != null ? `${slaResult.mttr}m` : '—'} />
              <StatChip label="MTBF" value={slaResult.mtbf != null ? `${slaResult.mtbf}m` : '—'} />
            </div>
          )}
          {timelineResult && Array.isArray(timelineResult.phases) && (
            <div className="space-y-1 rounded-lg border border-white/10 bg-black/30 p-2 text-xs">
              <p className="text-gray-400">{(timelineResult.phases as unknown[]).length} phase(s) · noisiest: {String(timelineResult.noisiest ?? '—')}</p>
              {Array.isArray(timelineResult.cascades) && (timelineResult.cascades as unknown[]).length > 0 && (
                <p className="text-rose-400">⚠ {(timelineResult.cascades as unknown[]).length} cascade(s) detected across services</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'capacity' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Record resource-usage samples (one per day) to run a real linear-regression forecast —
            trend classification, days-to-threshold, and P95/P99 per resource.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(['cpu', 'memory', 'disk', 'connections'] as const).map((k) => (
              <label key={k} className="text-xs text-gray-400 flex flex-col gap-1">
                {k}
                <input type="number" min={0} max={100} value={metricDraft[k]} onChange={(e) => setMetricDraft((d) => ({ ...d, [k]: Number(e.target.value) || 0 }))}
                  className="input-lattice text-xs" />
              </label>
            ))}
            <button onClick={addMetric} className="btn-secondary text-xs flex items-center justify-center gap-1 self-end">
              <Plus className="w-3 h-3" /> Add sample
            </button>
          </div>
          {metricRows.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {metricRows.map((m, i) => (
                <span key={m.id} className="flex items-center gap-1 rounded bg-black/30 px-2 py-1 text-[11px] text-gray-300">
                  day {i + 1}: cpu {m.cpu} · mem {m.memory} · disk {m.disk} · conn {m.connections}
                  <button onClick={() => removeMetric(m.id)} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Forecast days</label>
            <input type="number" min={1} max={365} value={forecastDays} onChange={(e) => setForecastDays(Number(e.target.value) || 30)}
              className="input-lattice w-20 text-xs" />
            <button onClick={runCapacity} disabled={busy || metricRows.length < 2} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Forecast
            </button>
          </div>
          {capacityResult && typeof capacityResult.resources === 'object' && (
            <div className="space-y-2">
              <p className="text-xs">Overall: <span className={`font-semibold ${capacityResult.overallHealth === 'healthy' ? 'text-neon-green' : capacityResult.overallHealth === 'critical' ? 'text-rose-400' : 'text-amber-400'}`}>{String(capacityResult.overallHealth)}</span></p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(capacityResult.resources as Record<string, Record<string, unknown>>).map(([k, v]) => (
                  <div key={k} className="rounded bg-black/30 px-2 py-1.5 text-xs">
                    <p className="text-gray-500 uppercase text-[10px]">{k}</p>
                    <p className="text-white">{String(v.current)}% → {String((v.forecast as Record<string, unknown>)?.projectedValue)}%</p>
                    <p className="text-gray-500">{String((v.trend as Record<string, unknown>)?.classification)}</p>
                  </div>
                ))}
              </div>
              {Array.isArray(capacityResult.recommendations) && (capacityResult.recommendations as string[]).length > 0 && (
                <ul className="space-y-0.5 text-xs text-amber-300">
                  {(capacityResult.recommendations as string[]).map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'dependencies' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Build a service dependency graph — single-point-of-failure detection, blast-radius, and
            circular-dependency analysis computed from the real edges below.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input value={serviceDraft.name} onChange={(e) => setServiceDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Service name" className="input-lattice text-xs" />
            <select value={serviceDraft.tier} onChange={(e) => setServiceDraft((d) => ({ ...d, tier: e.target.value }))} className="input-lattice text-xs">
              <option value="edge">edge</option>
              <option value="app">app</option>
              <option value="data">data</option>
              <option value="infra">infra</option>
            </select>
            <select multiple value={serviceDraft.dependencies ? serviceDraft.dependencies.split(',') : []}
              onChange={(e) => setServiceDraft((d) => ({ ...d, dependencies: Array.from(e.target.selectedOptions).map((o) => o.value).join(',') }))}
              className="input-lattice text-xs h-16" disabled={serviceNames.length === 0}>
              {serviceNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button onClick={addService} disabled={!serviceDraft.name.trim()} className="btn-secondary text-xs flex items-center justify-center gap-1 disabled:opacity-40">
              <Plus className="w-3 h-3" /> Add service
            </button>
          </div>
          {services.length > 0 && (
            <div className="space-y-1">
              {services.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded bg-black/30 px-2 py-1 text-xs">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-gray-500">{s.tier}</span>
                  <span className="flex-1 text-gray-500">{s.dependencies ? `depends on ${s.dependencies}` : 'no dependencies'}</span>
                  <button onClick={() => removeService(s.id)} className="text-gray-500 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
          <button onClick={runDependencies} disabled={busy || services.length === 0} className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Analyze
          </button>
          {depResult && typeof depResult.healthScore === 'number' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatChip label="Health" value={`${depResult.healthScore}%`} tone={(depResult.healthScore as number) >= 80 ? 'good' : (depResult.healthScore as number) >= 50 ? 'warn' : 'bad'} />
                <StatChip label="SPOFs" value={String((depResult.singlePointsOfFailure as unknown[])?.length ?? 0)} tone={(depResult.singlePointsOfFailure as unknown[])?.length ? 'bad' : 'good'} />
                <StatChip label="Circular deps" value={String((depResult.circularDependencies as unknown[])?.length ?? 0)} tone={(depResult.circularDependencies as unknown[])?.length ? 'bad' : 'good'} />
                <StatChip label="Max depth" value={String(depResult.maxDependencyDepth ?? 0)} />
              </div>
              {Array.isArray(depResult.singlePointsOfFailure) && depResult.singlePointsOfFailure.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(depResult.singlePointsOfFailure as Array<{ service: string; dependentCount: number }>).map((s, i) => (
                    <span key={i} className="rounded bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[11px] text-rose-300">{s.service} ({s.dependentCount} dependents)</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
