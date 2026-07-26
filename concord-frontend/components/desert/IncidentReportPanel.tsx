'use client';

/**
 * IncidentReportPanel — the real infrastructure/hazard incident reporting
 * surface that closes desert's second "Genuinely missing, deferred" gap
 * (docs/lens-specs/desert-capability-map.md: "no backing macro, previously
 * rendered via the same fake generic-CRUD store. Removed."). Backs onto the
 * persisted desert.incident* macro family (incidentReport / incidentList /
 * incidentUpdateStatus / incidentDelete / incidentsNearby).
 *
 * The genuine differentiator from ResourceNodeMap's static "hazard" node
 * kind is the status lifecycle: an incident report is a dated, categorized
 * event that moves open -> investigating -> resolved, with resolving
 * requiring resolution notes and reopening a resolved incident requiring an
 * explicit confirmation — never a silent one-click un-resolve. This is a
 * safety-relevant panel, so open/critical incidents near a point are
 * surfaced prominently, not buried in a generic list.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { AlertOctagon, Plus, Trash2, Search, RotateCcw, CheckCircle2, ShieldAlert } from 'lucide-react';

const CATEGORIES = [
  'washed_out_crossing',
  'damaged_trail_marker',
  'collapsed_structure',
  'contaminated_water_source',
  'downed_power_line',
  'blocked_access_road',
  'unstable_terrain',
  'wildlife_hazard',
  'equipment_failure',
  'other',
] as const;
const SEVERITIES = ['low', 'moderate', 'high', 'critical'] as const;
const OPEN_STATUSES = ['open', 'investigating'] as const;

type Category = (typeof CATEGORIES)[number];
type Severity = (typeof SEVERITIES)[number];
type Status = 'open' | 'investigating' | 'resolved';

interface Incident {
  id: string;
  category: Category;
  severity: Severity;
  description: string;
  lat: number;
  lng: number;
  status: Status;
  reportedAt: string;
  resolvedAt: string | null;
  resolutionNotes: string;
  statusHistory: Array<{ from: Status | null; to: Status; at: string; note?: string; reopened?: boolean }>;
  createdAt: string;
  updatedAt: string;
  distanceKm?: number;
}

const SEVERITY_BADGE: Record<Severity, string> = {
  low: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  moderate: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const STATUS_BADGE: Record<Status, string> = {
  open: 'bg-red-500/15 text-red-300 border-red-500/30',
  investigating: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

function categoryLabel(c: string): string {
  return c.replace(/_/g, ' ');
}

export function IncidentReportPanel() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [bySeverity, setBySeverity] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState('');

  const [category, setCategory] = useState<Category>('other');
  const [severity, setSeverity] = useState<Severity>('moderate');
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');

  const [nearLat, setNearLat] = useState('');
  const [nearLng, setNearLng] = useState('');
  const [near, setNear] = useState<{ incidents: Incident[]; count: number; openCount: number; criticalCount: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ incidents: Incident[]; count: number; byStatus: Record<string, number>; bySeverity: Record<string, number> }>(
      'desert',
      'incidentList',
      {},
    );
    if (r.data?.ok && r.data.result) {
      setIncidents(r.data.result.incidents);
      setByStatus(r.data.result.byStatus);
      setBySeverity(r.data.result.bySeverity);
    } else {
      setErr(r.data?.error || 'Could not load incident reports');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = statusFilter === 'all' ? incidents : incidents.filter((i) => i.status === statusFilter);
  const selected = incidents.find((i) => i.id === selectedId) || null;

  const submit = useCallback(async () => {
    setErr(null);
    if (!description.trim()) {
      setErr('Description is required');
      return;
    }
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng required');
      return;
    }
    const r = await lensRun('desert', 'incidentReport', {
      category,
      severity,
      description: description.trim(),
      lat: la,
      lng: ln,
    });
    if (r.data?.ok) {
      setDescription('');
      setLat('');
      setLng('');
      await load();
    } else {
      setErr(r.data?.error || 'Could not file the incident report');
    }
  }, [category, severity, description, lat, lng, load]);

  const moveStatus = useCallback(
    async (id: string, status: Status, opts: { reopen?: boolean; resolutionNotes?: string } = {}) => {
      setBusyId(id);
      const r = await lensRun('desert', 'incidentUpdateStatus', {
        id,
        status,
        reopen: opts.reopen || undefined,
        resolutionNotes: opts.resolutionNotes || undefined,
      });
      setBusyId(null);
      if (r.data?.ok) {
        setResolutionDraft('');
        await load();
      } else {
        setErr(r.data?.error || 'Could not update that incident');
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setBusyId(id);
      await lensRun('desert', 'incidentDelete', { id });
      setBusyId(null);
      if (selectedId === id) setSelectedId(null);
      await load();
    },
    [load, selectedId],
  );

  const findNearby = useCallback(async () => {
    setErr(null);
    const la = Number(nearLat);
    const ln = Number(nearLng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Valid lat/lng for proximity search required');
      return;
    }
    const r = await lensRun<{ incidents: Incident[]; count: number; openCount: number; criticalCount: number }>(
      'desert',
      'incidentsNearby',
      { lat: la, lng: ln, radiusKm: 100 },
    );
    if (r.data?.ok && r.data.result) setNear(r.data.result);
    else setErr(r.data?.error || 'Proximity search failed');
  }, [nearLat, nearLng]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-900/40 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 text-red-400" />
          <h3 className="text-sm font-semibold text-white">Infrastructure / hazard incident report</h3>
          <span className="ml-auto text-[10px] text-zinc-500">{incidents.length} on file</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            aria-label="Category"
            className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            aria-label="Severity"
            className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="lat"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="lng"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the incident (what, where, when observed)"
          rows={2}
          className="w-full rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
        />

        <button
          onClick={submit}
          className="flex items-center gap-1 rounded bg-red-600 hover:bg-red-500 px-2.5 py-1.5 text-xs text-white"
        >
          <Plus className="h-3.5 w-3.5" /> File incident report
        </button>

        {err && <p className="text-xs text-red-400" role="alert">{err}</p>}

        <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
          {(['all', ...OPEN_STATUSES, 'resolved'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded px-2 py-1 ${statusFilter === st ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}
            >
              {st === 'all' ? `all (${incidents.length})` : `${st} (${byStatus[st] || 0})`}
            </button>
          ))}
          {SEVERITIES.map((s) => (
            <span key={s} className={`rounded px-1.5 py-0.5 border text-[10px] ${SEVERITY_BADGE[s]}`}>
              {s} · {bySeverity[s] || 0}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Search className="h-4 w-4 text-red-400" />
          <span className="text-sm font-medium text-white">Incidents within 100 km of a point</span>
          <input
            value={nearLat}
            onChange={(e) => setNearLat(e.target.value)}
            placeholder="search lat"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
          />
          <input
            value={nearLng}
            onChange={(e) => setNearLng(e.target.value)}
            placeholder="search lng"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
          />
          <button
            onClick={findNearby}
            className="rounded bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 text-xs text-white"
          >
            Find
          </button>
        </div>
        {near && (
          <div className="space-y-2 pt-1">
            {/* Safety-relevant: open/critical counts are the real differentiator
                from a static hazard pin, so they're the most visually prominent
                numbers in this panel — not buried in the list below. */}
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded border px-3 py-2 ${near.openCount > 0 ? 'border-red-500/40 bg-red-500/10' : 'border-zinc-800 bg-zinc-950'}`}>
                <span className="text-[10px] uppercase tracking-wider text-zinc-400">Open nearby</span>
                <div className={`mt-1 font-mono text-lg ${near.openCount > 0 ? 'text-red-300' : 'text-white'}`}>{near.openCount}</div>
              </div>
              <div className={`rounded border px-3 py-2 ${near.criticalCount > 0 ? 'border-red-500/60 bg-red-500/15' : 'border-zinc-800 bg-zinc-950'}`}>
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" /> Critical &amp; open
                </span>
                <div className={`mt-1 font-mono text-lg ${near.criticalCount > 0 ? 'text-red-300' : 'text-white'}`}>{near.criticalCount}</div>
              </div>
            </div>
            {near.incidents.length === 0 && <p className="text-xs text-zinc-500">No incidents in range.</p>}
            {near.incidents.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={`uppercase px-1.5 py-0.5 rounded border text-[9px] ${SEVERITY_BADGE[i.severity]}`}>{i.severity}</span>
                  <span className="text-white">{categoryLabel(i.category)}</span>
                  <span className={`uppercase px-1.5 py-0.5 rounded border text-[9px] ${STATUS_BADGE[i.status]}`}>{i.status}</span>
                </div>
                <span className="font-mono text-amber-300">{i.distanceKm} km</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-center text-sm text-zinc-400 py-6">Loading…</p>
      ) : (
        <div className="flex flex-col md:flex-row gap-3">
          <div className="md:w-1/2 space-y-1.5">
            {filtered.map((i) => (
              <div
                key={i.id}
                data-testid={`incident-row-${i.id}`}
                role="button"
                tabIndex={0}
                aria-pressed={selectedId === i.id}
                aria-label={`Select incident: ${i.description}`}
                onClick={() => setSelectedId(i.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(i.id);
                  }
                }}
                className={`cursor-pointer rounded bg-zinc-900 border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${selectedId === i.id ? 'border-amber-500/50' : 'border-zinc-800'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-white font-medium truncate">{i.description}</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(i.id);
                    }}
                    aria-label={`Delete incident ${i.id}`}
                    disabled={busyId === i.id}
                    className="p-1 text-zinc-500 hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border ${SEVERITY_BADGE[i.severity]}`}>{i.severity}</span>
                  <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border ${STATUS_BADGE[i.status]}`}>{i.status}</span>
                  <span className="text-[10px] text-zinc-500">{categoryLabel(i.category)}</span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-center text-sm text-zinc-400 py-6">No incidents on file.</p>}
          </div>

          <div className="md:w-1/2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
            {!selected ? (
              <p className="text-xs text-zinc-500 italic text-center py-8">Select an incident to manage its status.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-white font-medium">{selected.description}</p>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] text-zinc-400">
                    <span className={`uppercase px-1.5 py-0.5 rounded border ${SEVERITY_BADGE[selected.severity]}`}>{selected.severity}</span>
                    <span className={`uppercase px-1.5 py-0.5 rounded border ${STATUS_BADGE[selected.status]}`}>{selected.status}</span>
                    <span>{categoryLabel(selected.category)}</span>
                  </div>
                </div>

                {selected.status !== 'resolved' ? (
                  <div className="space-y-1.5">
                    {selected.status === 'open' && (
                      <button
                        onClick={() => moveStatus(selected.id, 'investigating')}
                        disabled={busyId === selected.id}
                        className="w-full rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs px-2 py-1.5 hover:bg-amber-500/25"
                      >
                        Mark investigating
                      </button>
                    )}
                    <textarea
                      value={resolutionDraft}
                      onChange={(e) => setResolutionDraft(e.target.value)}
                      placeholder="Resolution notes (required to resolve)"
                      rows={2}
                      className="w-full rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
                    />
                    <button
                      onClick={() => moveStatus(selected.id, 'resolved', { resolutionNotes: resolutionDraft })}
                      disabled={busyId === selected.id || !resolutionDraft.trim()}
                      className="w-full flex items-center justify-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs px-2 py-1.5 hover:bg-emerald-500/25 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selected.resolutionNotes && (
                      <p className="text-[11px] text-zinc-400 italic">Resolved: {selected.resolutionNotes}</p>
                    )}
                    <button
                      onClick={() => moveStatus(selected.id, 'open', { reopen: true })}
                      disabled={busyId === selected.id}
                      className="w-full flex items-center justify-center gap-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs px-2 py-1.5 hover:text-amber-300"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reopen
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default IncidentReportPanel;
