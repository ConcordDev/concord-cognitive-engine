'use client';

/**
 * ProjectTracker — honest project/permit-status tracking
 * (proposed → approved → under_construction → built, plus the honest
 * denied/cancelled terminals). Closes the "Genuinely missing" gap in
 * docs/lens-specs/urban-planning-capability-map.md: the prior "Projects"
 * tab faked this with a client-only artifact store with no backing macro
 * at all (and was removed rather than kept as a fake surface — see the
 * lens page header comment). This is the real build against
 * `urban-planning.project-*` (server/domains/urbanplanning.js) — no
 * client-invented fields.
 *
 * The parcel link is OPTIONAL and, when used, sourced live from
 * `parcel-list` (a real select, never free text) — same discipline as
 * ParcelManager / PublicCommentPanel elsewhere in this lens. The status
 * control is a designed button group of the valid NEXT stages for the
 * project's current status, not a raw enum dropdown — the backend
 * (`project-status-update`) HARD-rejects any status outside the six-stage
 * lifecycle, so the UI only ever offers legal next moves.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  ClipboardList,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  DollarSign,
  FileText,
  CalendarClock,
  History,
  ArrowRight,
  Ban,
} from 'lucide-react';

type ProjectType =
  | 'residential_development' | 'commercial_development' | 'mixed_use'
  | 'infrastructure' | 'public_space' | 'transit' | 'rezoning' | 'other';
type ProjectStatus = 'proposed' | 'approved' | 'under_construction' | 'built' | 'denied' | 'cancelled';

interface Parcel {
  id: string;
  apn: string;
  address: string;
}

interface StatusEvent {
  status: ProjectStatus;
  at: string;
  note: string | null;
}

interface Project {
  id: string;
  name: string;
  description: string;
  parcelId: string | null;
  parcelApn: string | null;
  parcelAddress: string | null;
  projectType: ProjectType;
  budget: number;
  permitNumber: string;
  targetCompletionDate: string;
  status: ProjectStatus;
  statusHistory: StatusEvent[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectListResult {
  projects: Project[];
  count: number;
  byStatus: Record<string, number>;
  totalBudget: number;
}

const PROJECT_TYPES: { id: ProjectType; label: string }[] = [
  { id: 'residential_development', label: 'Residential Development' },
  { id: 'commercial_development', label: 'Commercial Development' },
  { id: 'mixed_use', label: 'Mixed Use' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'public_space', label: 'Public Space' },
  { id: 'transit', label: 'Transit' },
  { id: 'rezoning', label: 'Rezoning' },
  { id: 'other', label: 'Other' },
];
const PROJECT_TYPE_LABEL: Record<ProjectType, string> = PROJECT_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.label }),
  {} as Record<ProjectType, string>,
);

const STATUS_LABEL: Record<ProjectStatus, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  under_construction: 'Under Construction',
  built: 'Built',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

// A real progression: zinc (idea stage) -> amber (cleared review) -> cyan
// (in motion) -> emerald (done). The two honest non-happy-path terminals
// read unambiguously negative (rose/red), never a muted "still fine" tone.
const STATUS_BADGE: Record<ProjectStatus, string> = {
  proposed: 'bg-zinc-500/20 text-zinc-300 border border-zinc-500/30',
  approved: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  under_construction: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  built: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  denied: 'bg-red-500/20 text-red-300 border border-red-500/30',
  cancelled: 'bg-rose-900/30 text-rose-300 border border-rose-800/40',
};

// The designed forward-workflow the button group offers. The backend
// itself accepts any of the six statuses on project-status-update (an
// external system-of-record correction is a real need), but the UI only
// ever surfaces legal *next* moves so the control reads as a workflow,
// not a free-for-all enum.
const NEXT_STATUSES: Record<ProjectStatus, ProjectStatus[]> = {
  proposed: ['approved', 'denied', 'cancelled'],
  approved: ['under_construction', 'cancelled'],
  under_construction: ['built', 'cancelled'],
  built: [],
  denied: [],
  cancelled: [],
};

const inputCls = 'px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 text-xs w-full placeholder-zinc-600';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50';

const EMPTY_FORM = {
  name: '', description: '', parcelId: '', projectType: 'residential_development' as ProjectType,
  budget: '', permitNumber: '', targetCompletionDate: '',
};

function fmtMoney(n: number): string {
  if (!n) return '$0';
  return `$${n.toLocaleString()}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ProjectTracker() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [totalBudget, setTotalBudget] = useState(0);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAdd, setBusyAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [projR, parcelR] = await Promise.all([
      lensRun<ProjectListResult>('urban-planning', 'project-list', {}),
      lensRun<{ parcels: Parcel[] }>('urban-planning', 'parcel-list', {}),
    ]);
    if (projR.data.ok && projR.data.result) {
      setProjects(projR.data.result.projects);
      setByStatus(projR.data.result.byStatus);
      setTotalBudget(projR.data.result.totalBudget);
    } else {
      setError(projR.data.error || 'failed to load projects');
    }
    if (parcelR.data.ok && parcelR.data.result) {
      setParcels(parcelR.data.result.parcels);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = useCallback(async () => {
    if (!form.name.trim()) {
      setError('project name is required');
      return;
    }
    setBusyAdd(true);
    setError(null);
    const r = await lensRun('urban-planning', 'project-add', {
      name: form.name,
      description: form.description,
      parcelId: form.parcelId || undefined,
      projectType: form.projectType,
      budget: form.budget ? Number(form.budget) : 0,
      permitNumber: form.permitNumber,
      targetCompletionDate: form.targetCompletionDate,
    });
    setBusyAdd(false);
    if (r.data.ok) {
      setForm(EMPTY_FORM);
      await refresh();
    } else {
      setError(r.data.error || 'add failed');
    }
  }, [form, refresh]);

  const remove = useCallback(
    async (id: string) => {
      setBusyId(id);
      const r = await lensRun('urban-planning', 'project-remove', { id });
      setBusyId(null);
      if (!r.data.ok) {
        setError(r.data.error || 'remove failed');
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const transition = useCallback(
    async (id: string, status: ProjectStatus) => {
      setBusyId(id);
      setError(null);
      const r = await lensRun('urban-planning', 'project-status-update', { id, status });
      setBusyId(null);
      if (!r.data.ok) {
        setError(r.data.error || 'status update failed');
        return;
      }
      await refresh();
    },
    [refresh],
  );

  const toggleHistory = useCallback((id: string) => {
    setExpandedHistory((m) => ({ ...m, [id]: !m[id] }));
  }, []);

  const statusOrder: ProjectStatus[] = useMemo(
    () => ['proposed', 'approved', 'under_construction', 'built', 'denied', 'cancelled'],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <ClipboardList className="h-4 w-4 text-emerald-400" /> New Project
        </h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Project name"
            className={inputCls}
          />
          <select
            aria-label="Project type"
            value={form.projectType}
            onChange={(e) => setForm((f) => ({ ...f, projectType: e.target.value as ProjectType }))}
            className={inputCls}
          >
            {PROJECT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Linked parcel"
            value={form.parcelId}
            onChange={(e) => setForm((f) => ({ ...f, parcelId: e.target.value }))}
            className={inputCls}
          >
            <option value="">No parcel link (optional)</option>
            {parcels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.apn}
                {p.address ? ` — ${p.address}` : ''}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Description (optional)"
          rows={2}
          className={cn(inputCls, 'mt-2')}
        />
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            value={form.budget}
            onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))}
            type="number"
            placeholder="Budget ($, optional)"
            className={inputCls}
          />
          <input
            value={form.permitNumber}
            onChange={(e) => setForm((f) => ({ ...f, permitNumber: e.target.value }))}
            placeholder="Permit number (optional)"
            className={inputCls}
          />
          <input
            value={form.targetCompletionDate}
            onChange={(e) => setForm((f) => ({ ...f, targetCompletionDate: e.target.value }))}
            type="date"
            aria-label="Target completion date"
            className={inputCls}
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={add} disabled={busyAdd} className={btnPrimary}>
            {busyAdd ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add Project
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Refresh projects"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-300">
            {projects.length} projects · {fmtMoney(totalBudget)} tracked
          </span>
          {statusOrder
            .filter((st) => byStatus[st])
            .map((st) => (
              <span key={st} className={cn('rounded px-2 py-0.5', STATUS_BADGE[st])}>
                {byStatus[st]} {STATUS_LABEL[st]}
              </span>
            ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading projects…
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-400">
          No projects tracked yet. Add one above to open its proposed → approved → built record.
        </div>
      ) : (
        <div className="grid gap-2">
          {projects.map((p) => {
            const nextOptions = NEXT_STATUSES[p.status] || [];
            const historyOpen = !!expandedHistory[p.id];
            const rowBusy = busyId === p.id;
            return (
              <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-white">{p.name}</h4>
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_BADGE[p.status])}>
                        {STATUS_LABEL[p.status]}
                      </span>
                      <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] text-zinc-400">
                        {PROJECT_TYPE_LABEL[p.projectType]}
                      </span>
                    </div>
                    {p.description && <p className="mt-0.5 text-xs text-zinc-400">{p.description}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                      {p.parcelId && (
                        <span>
                          Parcel: {p.parcelApn}
                          {p.parcelAddress ? ` (${p.parcelAddress})` : ''}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <DollarSign className="h-3 w-3" /> {fmtMoney(p.budget)}
                      </span>
                      {p.permitNumber && (
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-3 w-3" /> {p.permitNumber}
                        </span>
                      )}
                      {p.targetCompletionDate && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="h-3 w-3" /> target {p.targetCompletionDate}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(p.id)}
                    disabled={rowBusy}
                    className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                    aria-label={`Delete project ${p.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {nextOptions.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-zinc-500">Advance:</span>
                    {nextOptions.map((st) => (
                      <button
                        key={st}
                        onClick={() => transition(p.id, st)}
                        disabled={rowBusy}
                        className={cn(
                          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] hover:opacity-80 disabled:opacity-40',
                          st === 'denied' || st === 'cancelled'
                            ? 'border-red-500/30 bg-red-500/5 text-red-300'
                            : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
                        )}
                      >
                        {st === 'denied' || st === 'cancelled' ? (
                          <Ban className="h-3 w-3" />
                        ) : (
                          <ArrowRight className="h-3 w-3" />
                        )}
                        {STATUS_LABEL[st]}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => toggleHistory(p.id)}
                  className="mt-2 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  <History className="h-3 w-3" />
                  {historyOpen ? 'Hide' : 'Show'} status history ({p.statusHistory.length})
                </button>
                {historyOpen && (
                  <ol className="mt-1.5 space-y-1 border-l border-zinc-800 pl-3">
                    {p.statusHistory.map((h, i) => (
                      <li key={i} className="text-[10px] text-zinc-400">
                        <span className={cn('mr-1.5 rounded px-1 py-0.5 font-medium', STATUS_BADGE[h.status])}>
                          {STATUS_LABEL[h.status]}
                        </span>
                        {fmtDate(h.at)}
                        {h.note ? ` — ${h.note}` : ''}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ProjectTracker;
