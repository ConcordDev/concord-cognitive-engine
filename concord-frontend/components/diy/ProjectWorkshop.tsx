/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Hammer,
  Plus,
  Trash2,
  ListChecks,
  Package,
  Wrench,
  CheckCircle2,
  Circle,
  ArrowUp,
  ArrowDown,
  GitFork,
  Globe,
  ExternalLink,
  X,
  Camera,
  Loader2,
  ShoppingCart,
  Filter,
  Scissors,
} from 'lucide-react';

// ── Shapes mirrored from server/domains/diy.js ──────────────────────
interface DStep {
  id: string;
  order: number;
  title: string;
  text: string;
  photoUrl: string;
  resultPhotoUrl: string;
  estimatedMinutes: number;
  complete: boolean;
  completedAt: string | null;
}
interface DBomLink { retailer: string; url: string }
interface DBomLine {
  id: string;
  item: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  supplier: string;
  owned: boolean;
  links: DBomLink[];
  lineTotal?: number;
}
interface DProject {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  description: string;
  estimatedHours: number;
  tags: string[];
  steps: DStep[];
  bom: DBomLine[];
  status: string;
  published?: boolean;
  forkedFrom: { projectId: string; name: string } | null;
  createdAt: string;
  stepCount: number;
  completeSteps: number;
  progressPct: number;
  bomLineCount: number;
  bomOwnedCount: number;
  materialsCost: number;
  toBuyCost: number;
}
interface DRollup {
  projectName: string;
  lines: DBomLine[];
  lineCount: number;
  totalCost: number;
  ownedValue: number;
  toBuyCost: number;
  toBuyCount: number;
  bySupplier: Record<string, number>;
  budgetTip: string;
}
interface DToolCheck { tool: string; owned: boolean; condition: string | null; usable: boolean }
interface DGate {
  projectName: string;
  checks: DToolCheck[];
  readyToStart: boolean;
  missing: string[];
  unusable: string[];
  verdict: string;
}
interface DFacets {
  total: number;
  byDifficulty: Record<string, number>;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  costBands: Record<string, number>;
  timeBands: Record<string, number>;
}
interface DCatalogEntry {
  projectId: string;
  name: string;
  category: string;
  difficulty: string;
  estimatedHours: number;
  stepCount: number;
  bomLineCount: number;
  materialsCost: number;
  publishedAt: string;
  isMine: boolean;
}
interface DCutBoard { board: number; cuts: string[]; remaining: number; utilization: number }
interface DCutList {
  stockLength: number;
  kerfWidth: number;
  totalCuts: number;
  boardsNeeded: number;
  boards: DCutBoard[];
  efficiency: number;
  totalWaste: number;
  wasteTip: string;
}

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'expert'];
const CATEGORIES = ['Woodworking', 'Electronics', 'Sewing', 'Metalwork', 'Painting', '3D Printing', 'Plumbing', 'Automotive', 'Garden', 'Other'];
const TOOL_CONDITIONS = ['Good', 'Fair', 'Needs Repair', 'Out of Service'];

const diffColor: Record<string, string> = {
  beginner: 'text-green-400',
  intermediate: 'text-cyan-400',
  advanced: 'text-orange-400',
  expert: 'text-red-400',
};
const statusColor: Record<string, string> = {
  planning: 'bg-gray-500/20 text-gray-300',
  in_progress: 'bg-cyan-500/20 text-cyan-300',
  completed: 'bg-green-500/20 text-green-300',
};

type WTab = 'steps' | 'bom' | 'tools' | 'cutlist';

export function ProjectWorkshop() {
  const [projects, setProjects] = useState<DProject[]>([]);
  const [facets, setFacets] = useState<DFacets | null>(null);
  const [catalog, setCatalog] = useState<DCatalogEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<DProject | null>(null);
  const [tab, setTab] = useState<WTab>('steps');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'mine' | 'browse'>('mine');
  const [filterDiff, setFilterDiff] = useState('all');

  // create-project form
  const [showCreate, setShowCreate] = useState(false);
  const [npName, setNpName] = useState('');
  const [npCategory, setNpCategory] = useState(CATEGORIES[0]);
  const [npDifficulty, setNpDifficulty] = useState('intermediate');
  const [npHours, setNpHours] = useState('');
  const [npDesc, setNpDesc] = useState('');

  // unwrap the double-wrapped { ok, result: { ok, result } } envelope
  const unwrap = <T,>(d: { ok: boolean; result: any }): T | null => {
    if (!d.ok) return null;
    const macro = d.result as { ok?: boolean; result?: T } | null;
    if (!macro || macro.ok === false) return null;
    return (macro && 'result' in macro ? macro.result : (macro as unknown as T)) ?? null;
  };

  const refreshList = useCallback(async () => {
    const [pl, fc, cat] = await Promise.all([
      lensRun('diy', 'project-list', {}),
      lensRun('diy', 'project-facets', {}),
      lensRun('diy', 'project-browse-published', {}),
    ]);
    const plr = unwrap<{ projects: DProject[]; count: number }>(pl.data);
    const fcr = unwrap<DFacets>(fc.data);
    const catr = unwrap<{ catalog: DCatalogEntry[] }>(cat.data);
    if (plr) setProjects(plr.projects);
    if (fcr) setFacets(fcr);
    if (catr) setCatalog(catr.catalog);
  }, []);

  const loadProject = useCallback(async (id: string) => {
    const r = await lensRun('diy', 'project-get', { projectId: id });
    const res = unwrap<{ project: DProject }>(r.data);
    if (res) {
      setActive(res.project);
      setActiveId(id);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refreshList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'load failed');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // /api/lens/run double-wraps: route returns { ok, result } where `result`
  // is the macro's own { ok, result } envelope. Unwrap to the inner result.
  const run = useCallback(
    async (action: string, input: Record<string, unknown>, after?: (res: any) => void) => {
      setBusy(true);
      setErr(null);
      try {
        const r = await lensRun('diy', action, input);
        if (!r.data.ok) {
          setErr(r.data.error || `${action} failed`);
          return null;
        }
        const macro = r.data.result as { ok?: boolean; result?: any; error?: string } | null;
        if (macro && macro.ok === false) {
          setErr(macro.error || `${action} failed`);
          return null;
        }
        const inner = macro && 'result' in macro ? macro.result : macro;
        if (after) after(inner);
        return inner;
      } catch (e) {
        setErr(e instanceof Error ? e.message : `${action} failed`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const createProject = async () => {
    if (!npName.trim()) return;
    const res = await run('project-create', {
      name: npName.trim(),
      category: npCategory,
      difficulty: npDifficulty,
      estimatedHours: npHours ? parseFloat(npHours) : 0,
      description: npDesc,
    });
    if (res?.project) {
      setShowCreate(false);
      setNpName('');
      setNpHours('');
      setNpDesc('');
      await refreshList();
      await loadProject(res.project.id);
    }
  };

  const filteredProjects = useMemo(
    () => (filterDiff === 'all' ? projects : projects.filter((p) => p.difficulty === filterDiff)),
    [projects, filterDiff],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Hammer className="h-5 w-5 text-orange-400" />
          <h2 className={ds.heading3}>Project Workshop</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            <button
              onClick={() => setView('mine')}
              className={cn('px-3 py-1.5 text-xs', view === 'mine' ? 'bg-orange-500/20 text-orange-300' : 'text-zinc-400')}
            >
              My Builds
            </button>
            <button
              onClick={() => setView('browse')}
              className={cn('px-3 py-1.5 text-xs', view === 'browse' ? 'bg-orange-500/20 text-orange-300' : 'text-zinc-400')}
            >
              Remix Catalog
            </button>
          </div>
          <button onClick={() => setShowCreate(true)} className={ds.btnPrimary}>
            <Plus className="h-4 w-4" /> New Project
          </button>
        </div>
      </header>

      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workshop…
        </div>
      )}

      {!loading && view === 'browse' && (
        <RemixCatalog
          catalog={catalog}
          busy={busy}
          onFork={async (id) => {
            const res = await run('project-fork', { projectId: id });
            if (res?.project) {
              setView('mine');
              await refreshList();
              await loadProject(res.project.id);
            }
          }}
        />
      )}

      {!loading && view === 'mine' && (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          {/* project list + facets */}
          <div className="space-y-3">
            {facets && facets.total > 0 && <FacetPanel facets={facets} onPick={setFilterDiff} active={filterDiff} />}
            <div className="space-y-1.5">
              {filteredProjects.length === 0 && (
                <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">
                  No projects yet. Start a new build.
                </div>
              )}
              {filteredProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => loadProject(p.id)}
                  className={cn(
                    'w-full rounded-lg border p-2.5 text-left transition-colors',
                    activeId === p.id
                      ? 'border-orange-500/50 bg-orange-500/10'
                      : 'border-zinc-800 bg-zinc-950 hover:border-orange-500/30',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-white">{p.name}</span>
                    {p.published && <Globe className="h-3 w-3 shrink-0 text-cyan-400" />}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
                    <span className={diffColor[p.difficulty] || 'text-zinc-400'}>{p.difficulty}</span>
                    <span>· {p.category}</span>
                    {p.forkedFrom && <GitFork className="h-3 w-3 text-zinc-400" />}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-orange-500"
                      style={{ width: `${p.progressPct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-400">
                    <span>
                      {p.completeSteps}/{p.stepCount} steps
                    </span>
                    <span>${p.materialsCost.toFixed(0)} mat</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* active project detail */}
          <div>
            {!active && (
              <div className="rounded-lg border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-400">
                Select a project to open the workshop.
              </div>
            )}
            {active && (
              <ProjectDetail
                project={active}
                tab={tab}
                setTab={setTab}
                busy={busy}
                run={run}
                onChanged={async (proj) => {
                  if (proj) setActive(proj);
                  await refreshList();
                }}
                onReload={() => activeId && loadProject(activeId)}
                onDelete={async () => {
                  await run('project-delete', { projectId: active.id });
                  setActive(null);
                  setActiveId(null);
                  await refreshList();
                }}
              />
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowCreate(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className={cn(ds.panel, 'w-full max-w-md')} onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className={ds.heading3}>New Project</h3>
              <button onClick={() => setShowCreate(false)} className={ds.btnGhost} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={ds.label}>Project name</label>
                <input className={ds.input} value={npName} onChange={(e) => setNpName(e.target.value)} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={ds.label}>Category</label>
                  <select className={ds.select} value={npCategory} onChange={(e) => setNpCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={ds.label}>Difficulty</label>
                  <select className={ds.select} value={npDifficulty} onChange={(e) => setNpDifficulty(e.target.value)}>
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={ds.label}>Estimated hours</label>
                <input
                  type="number"
                  className={ds.input}
                  value={npHours}
                  onChange={(e) => setNpHours(e.target.value)}
                />
              </div>
              <div>
                <label className={ds.label}>Description</label>
                <textarea
                  className={ds.textarea}
                  rows={2}
                  value={npDesc}
                  onChange={(e) => setNpDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className={ds.btnSecondary}>
                Cancel
              </button>
              <button onClick={createProject} className={ds.btnPrimary} disabled={!npName.trim() || busy}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Browse facets ───────────────────────────────────────────────────
function FacetPanel({
  facets,
  onPick,
  active,
}: {
  facets: DFacets;
  onPick: (d: string) => void;
  active: string;
}) {
  return (
    <div className={cn(ds.panel, 'space-y-2')}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
        <Filter className="h-3.5 w-3.5 text-orange-400" /> Browse by difficulty
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onPick('all')}
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px]',
            active === 'all' ? 'bg-orange-500/30 text-orange-200' : 'bg-zinc-800 text-zinc-400',
          )}
        >
          all ({facets.total})
        </button>
        {Object.entries(facets.byDifficulty).map(([d, n]) => (
          <button
            key={d}
            onClick={() => onPick(d)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px]',
              active === d ? 'bg-orange-500/30 text-orange-200' : 'bg-zinc-800 text-zinc-400',
            )}
          >
            {d} ({n})
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px] text-zinc-400">
        <div>
          <div className="mb-0.5 uppercase tracking-wider">Cost bands</div>
          {Object.entries(facets.costBands).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span>{k}</span>
              <span className="text-zinc-300">{v}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-0.5 uppercase tracking-wider">Time bands</div>
          {Object.entries(facets.timeBands).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span>{k}</span>
              <span className="text-zinc-300">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Remix catalog ───────────────────────────────────────────────────
function RemixCatalog({
  catalog,
  busy,
  onFork,
}: {
  catalog: DCatalogEntry[];
  busy: boolean;
  onFork: (id: string) => void;
}) {
  if (catalog.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-400">
        No published projects to remix yet. Publish one of your builds to share it.
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {catalog.map((c) => (
        <div key={c.projectId} className={cn(ds.panel, 'space-y-2')}>
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium text-white">{c.name}</span>
            {c.isMine && (
              <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] text-cyan-300">yours</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] text-zinc-400">
            <span className={diffColor[c.difficulty] || 'text-zinc-400'}>{c.difficulty}</span>
            <span>· {c.category}</span>
            <span>· {c.stepCount} steps</span>
            <span>· {c.bomLineCount} materials</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <span>~{c.estimatedHours}h · ${c.materialsCost.toFixed(0)} materials</span>
          </div>
          <button
            onClick={() => onFork(c.projectId)}
            disabled={busy}
            className={cn(ds.btnSecondary, 'w-full justify-center text-xs')}
          >
            <GitFork className="h-3.5 w-3.5" /> Remix this build
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Project detail (steps / bom / tools / cutlist) ──────────────────
function ProjectDetail({
  project,
  tab,
  setTab,
  busy,
  run,
  onChanged,
  onReload,
  onDelete,
}: {
  project: DProject;
  tab: WTab;
  setTab: (t: WTab) => void;
  busy: boolean;
  run: (a: string, i: Record<string, unknown>, after?: (r: any) => void) => Promise<any>;
  onChanged: (p: DProject | null) => void;
  onReload: () => void;
  onDelete: () => void;
}) {
  const togglePublish = async () => {
    await run(project.published ? 'project-unpublish' : 'project-publish', { projectId: project.id });
    onReload();
    onChanged(null);
  };

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-800 pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-white">{project.name}</h3>
            <span className={cn('rounded px-1.5 py-0.5 text-[9px]', statusColor[project.status] || statusColor.planning)}>
              {project.status.replace('_', ' ')}
            </span>
          </div>
          {project.forkedFrom && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-400">
              <GitFork className="h-3 w-3" /> remixed from {project.forkedFrom.name}
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-400">{project.description || 'No description.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={togglePublish} disabled={busy} className={cn(ds.btnSecondary, 'text-xs')}>
            <Globe className="h-3.5 w-3.5" /> {project.published ? 'Unpublish' : 'Publish'}
          </button>
          <button onClick={onDelete} disabled={busy} className={ds.btnGhost} aria-label="Delete project">
            <Trash2 className="h-4 w-4 text-red-400" />
          </button>
        </div>
      </div>

      {/* progress summary */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Progress" value={`${project.progressPct}%`} />
        <Stat label="Steps" value={`${project.completeSteps}/${project.stepCount}`} />
        <Stat label="Materials" value={`$${project.materialsCost.toFixed(0)}`} />
        <Stat label="To buy" value={`$${project.toBuyCost.toFixed(0)}`} />
      </div>

      <nav className="flex gap-1.5 border-b border-zinc-800 pb-2">
        {([
          { id: 'steps', label: 'Steps', icon: ListChecks },
          { id: 'bom', label: 'Materials', icon: Package },
          { id: 'tools', label: 'Tool Gate', icon: Wrench },
          { id: 'cutlist', label: 'Cut List', icon: Scissors },
        ] as { id: WTab; label: string; icon: typeof ListChecks }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs',
              tab === t.id ? 'bg-orange-500/20 text-orange-300' : 'text-zinc-400 hover:text-white',
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </nav>

      {tab === 'steps' && <StepBuilder project={project} busy={busy} run={run} onChanged={onChanged} />}
      {tab === 'bom' && <BomEditor project={project} busy={busy} run={run} onChanged={onChanged} />}
      {tab === 'tools' && <ToolGate project={project} busy={busy} run={run} />}
      {tab === 'cutlist' && <CutListPanel busy={busy} run={run} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="font-mono text-sm text-orange-300">{value}</div>
    </div>
  );
}

// ── Step builder + progress ─────────────────────────────────────────
function StepBuilder({
  project,
  busy,
  run,
  onChanged,
}: {
  project: DProject;
  busy: boolean;
  run: (a: string, i: Record<string, unknown>, after?: (r: any) => void) => Promise<any>;
  onChanged: (p: DProject) => void;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState('');
  const [minutes, setMinutes] = useState('');

  const apply = (res: any) => {
    if (res?.project) onChanged(res.project);
  };

  const addStep = async () => {
    if (!text.trim()) return;
    await run(
      'step-add',
      {
        projectId: project.id,
        title: title.trim(),
        text: text.trim(),
        photoUrl: photo.trim(),
        estimatedMinutes: minutes ? parseFloat(minutes) : 0,
      },
      apply,
    );
    setTitle('');
    setText('');
    setPhoto('');
    setMinutes('');
  };

  return (
    <div className="space-y-3">
      {project.steps.length === 0 && (
        <p className="text-xs text-zinc-400">No steps yet. Build your illustrated guide below.</p>
      )}
      <ol className="space-y-2">
        {project.steps.map((s, i) => (
          <li key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
            <div className="flex items-start gap-2.5">
              <button
                onClick={() => run('step-progress', { projectId: project.id, stepId: s.id }, apply)}
                disabled={busy}
                aria-label={s.complete ? 'Mark incomplete' : 'Mark complete'}
                className="mt-0.5 shrink-0"
              >
                {s.complete ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : (
                  <Circle className="h-5 w-5 text-zinc-600" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-orange-500/20 px-1.5 py-0.5 font-mono text-[10px] text-orange-300">
                    {s.order}
                  </span>
                  <span className={cn('text-sm', s.complete ? 'text-zinc-400 line-through' : 'text-white')}>
                    {s.title}
                  </span>
                  {s.estimatedMinutes > 0 && (
                    <span className="text-[10px] text-zinc-400">~{s.estimatedMinutes} min</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-400">{s.text}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {s.photoUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.photoUrl}
                      alt={`Step ${s.order} guide`}
                      className="h-20 w-28 rounded border border-zinc-800 object-cover"
                    />
                  )}
                  {s.resultPhotoUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.resultPhotoUrl}
                      alt={`Step ${s.order} result`}
                      className="h-20 w-28 rounded border border-green-500/30 object-cover"
                    />
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <ResultPhotoInput
                    onSave={(url) =>
                      run('step-progress', { projectId: project.id, stepId: s.id, complete: s.complete, resultPhotoUrl: url }, apply)
                    }
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  onClick={() => run('step-reorder', { projectId: project.id, stepId: s.id, toIndex: i - 1 }, apply)}
                  disabled={busy || i === 0}
                  aria-label="Move step up"
                  className={ds.btnGhost}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => run('step-reorder', { projectId: project.id, stepId: s.id, toIndex: i + 1 }, apply)}
                  disabled={busy || i === project.steps.length - 1}
                  aria-label="Move step down"
                  className={ds.btnGhost}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => run('step-delete', { projectId: project.id, stepId: s.id }, apply)}
                  disabled={busy}
                  aria-label="Delete step"
                  className={ds.btnGhost}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-orange-300">
          <Plus className="h-3.5 w-3.5" /> Add a step
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className={ds.input} placeholder="Step title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            type="number"
            className={ds.input}
            placeholder="Est. minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <textarea
          className={ds.textarea}
          rows={2}
          placeholder="What to do in this step…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          className={ds.input}
          placeholder="Photo URL for this step (optional)"
          value={photo}
          onChange={(e) => setPhoto(e.target.value)}
        />
        <button onClick={addStep} className={ds.btnPrimary} disabled={!text.trim() || busy}>
          <Plus className="h-4 w-4" /> Add step
        </button>
      </div>
    </div>
  );
}

function ResultPhotoInput({ onSave }: { onSave: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300">
        <Camera className="h-3 w-3" /> Add result photo
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        className={cn(ds.input, 'h-7 py-0 text-[11px]')}
        placeholder="Result photo URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button
        onClick={() => {
          if (url.trim()) onSave(url.trim());
          setOpen(false);
          setUrl('');
        }}
        className="text-[10px] text-green-400"
      >
        save
      </button>
      <button onClick={() => setOpen(false)} className="text-[10px] text-zinc-400">
        cancel
      </button>
    </div>
  );
}

// ── BOM editor with cost rollup ─────────────────────────────────────
function BomEditor({
  project,
  busy,
  run,
  onChanged,
}: {
  project: DProject;
  busy: boolean;
  run: (a: string, i: Record<string, unknown>, after?: (r: any) => void) => Promise<any>;
  onChanged: (p: DProject) => void;
}) {
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('pcs');
  const [price, setPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [rollup, setRollup] = useState<DRollup | null>(null);

  const refreshRollup = useCallback(async () => {
    const r = await run('bom-rollup', { projectId: project.id });
    if (r) setRollup(r as DRollup);
  }, [project.id, run]);

  useEffect(() => {
    refreshRollup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.bomLineCount]);

  const apply = async (res: any) => {
    if (res?.project) onChanged(res.project);
    await refreshRollup();
  };

  const addLine = async () => {
    if (!item.trim()) return;
    await run(
      'bom-add',
      {
        projectId: project.id,
        item: item.trim(),
        quantity: parseFloat(qty) || 1,
        unit,
        unitPrice: parseFloat(price) || 0,
        supplier: supplier.trim(),
      },
      apply,
    );
    setItem('');
    setQty('1');
    setPrice('');
    setSupplier('');
  };

  return (
    <div className="space-y-3">
      {rollup && rollup.lineCount > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Total cost" value={`$${rollup.totalCost.toFixed(2)}`} />
          <Stat label="Owned value" value={`$${rollup.ownedValue.toFixed(2)}`} />
          <Stat label="Still to buy" value={`$${rollup.toBuyCost.toFixed(2)}`} />
        </div>
      )}
      {rollup && Object.keys(rollup.bySupplier).length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Shopping cost by supplier</div>
          <ChartKit
            kind="bar"
            height={140}
            xKey="supplier"
            showLegend={false}
            data={Object.entries(rollup.bySupplier).map(([supplier, cost]) => ({ supplier, cost }))}
            series={[{ key: 'cost', label: 'To buy ($)', color: '#fb923c' }]}
          />
        </div>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-[10px] uppercase tracking-wider text-zinc-400">
            <th className="py-1.5">Material</th>
            <th>Qty</th>
            <th>Unit $</th>
            <th>Line $</th>
            <th>Have</th>
            <th>Shop</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(rollup?.lines || []).map((l) => (
            <tr key={l.id} className="border-b border-zinc-900">
              <td className="py-1.5 text-white">
                {l.item}
                {l.supplier && <span className="ml-1 text-[10px] text-zinc-400">· {l.supplier}</span>}
              </td>
              <td className="text-zinc-400">
                {l.quantity} {l.unit}
              </td>
              <td className="text-zinc-400">${l.unitPrice.toFixed(2)}</td>
              <td className="font-mono text-orange-300">${(l.lineTotal ?? l.quantity * l.unitPrice).toFixed(2)}</td>
              <td>
                <button
                  onClick={() => run('bom-update', { projectId: project.id, lineId: l.id, owned: !l.owned }, apply)}
                  disabled={busy}
                  aria-label="Toggle owned"
                >
                  {l.owned ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : (
                    <Circle className="h-4 w-4 text-zinc-600" />
                  )}
                </button>
              </td>
              <td>
                <div className="flex gap-1">
                  {l.links.slice(0, 3).map((lk) => (
                    <a
                      key={lk.retailer}
                      href={lk.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Search ${lk.retailer}`}
                      className="text-zinc-400 hover:text-orange-400"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" />
                    </a>
                  ))}
                </div>
              </td>
              <td>
                <button
                  onClick={() => run('bom-delete', { projectId: project.id, lineId: l.id }, apply)}
                  disabled={busy}
                  aria-label="Delete material"
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
              </td>
            </tr>
          ))}
          {(!rollup || rollup.lineCount === 0) && (
            <tr>
              <td colSpan={7} className="py-3 text-center text-zinc-400">
                No materials yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {rollup && rollup.lineCount > 0 && (
        <p className="text-[11px] text-zinc-400">{rollup.budgetTip}</p>
      )}

      <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-orange-300">
          <Plus className="h-3.5 w-3.5" /> Add a material
        </div>
        <input className={ds.input} placeholder="Material name" value={item} onChange={(e) => setItem(e.target.value)} />
        <div className="grid grid-cols-4 gap-2">
          <input type="number" className={ds.input} placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
          <input className={ds.input} placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <input
            type="number"
            className={ds.input}
            placeholder="Unit $"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <input
            className={ds.input}
            placeholder="Supplier"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
        </div>
        <button onClick={addLine} className={ds.btnPrimary} disabled={!item.trim() || busy}>
          <Plus className="h-4 w-4" /> Add to BOM
        </button>
      </div>
    </div>
  );
}

// ── Tool availability gate ──────────────────────────────────────────
function ToolGate({
  project,
  busy,
  run,
}: {
  project: DProject;
  busy: boolean;
  run: (a: string, i: Record<string, unknown>, after?: (r: any) => void) => Promise<any>;
}) {
  const [required, setRequired] = useState('');
  const [inventory, setInventory] = useState<{ name: string; condition: string }[]>([]);
  const [invName, setInvName] = useState('');
  const [invCond, setInvCond] = useState('Good');
  const [gate, setGate] = useState<DGate | null>(null);

  const addTool = () => {
    if (!invName.trim()) return;
    setInventory((prev) => [...prev, { name: invName.trim(), condition: invCond }]);
    setInvName('');
  };

  const checkGate = async () => {
    const tools = required
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tools.length === 0) return;
    const r = await run('project-tool-gate', {
      projectId: project.id,
      requiredTools: tools,
      inventory,
      persist: true,
    });
    if (r) setGate(r as DGate);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
        <label className={ds.label}>Required tools for this project (comma-separated)</label>
        <input
          className={ds.input}
          placeholder="table saw, drill, sander…"
          value={required}
          onChange={(e) => setRequired(e.target.value)}
        />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
        <label className={ds.label}>Your tool inventory</label>
        <div className="flex gap-2">
          <input className={ds.input} placeholder="Tool name" value={invName} onChange={(e) => setInvName(e.target.value)} />
          <select className={cn(ds.select, 'w-36')} value={invCond} onChange={(e) => setInvCond(e.target.value)}>
            {TOOL_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button aria-label="Add" onClick={addTool} className={ds.btnSecondary}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {inventory.map((t, i) => (
            <span
              key={`${t.name}-${i}`}
              className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300"
            >
              {t.name} · {t.condition}
              <button onClick={() => setInventory((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove tool">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {inventory.length === 0 && <span className="text-[11px] text-zinc-400">No tools added.</span>}
        </div>
      </div>

      <button onClick={checkGate} className={ds.btnPrimary} disabled={busy || !required.trim()}>
        <Wrench className="h-4 w-4" /> Check readiness
      </button>

      {gate && (
        <div
          className={cn(
            'rounded-lg border p-3',
            gate.readyToStart ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5',
          )}
        >
          <div className={cn('text-sm font-medium', gate.readyToStart ? 'text-green-300' : 'text-red-300')}>
            {gate.verdict}
          </div>
          <ul className="mt-2 space-y-1">
            {gate.checks.map((c) => (
              <li key={c.tool} className="flex items-center gap-2 text-xs">
                {c.usable ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-red-400" />
                )}
                <span className="text-white">{c.tool}</span>
                <span className="text-zinc-400">
                  {c.owned ? `owned · ${c.condition}` : 'missing'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Cut-list optimizer with board-layout diagram ────────────────────
function CutListPanel({
  busy,
  run,
}: {
  busy: boolean;
  run: (a: string, i: Record<string, unknown>, after?: (r: any) => void) => Promise<any>;
}) {
  const [stock, setStock] = useState('96');
  const [cuts, setCuts] = useState<{ label: string; length: string; quantity: string }[]>([]);
  const [cLabel, setCLabel] = useState('');
  const [cLen, setCLen] = useState('');
  const [cQty, setCQty] = useState('1');
  const [result, setResult] = useState<DCutList | null>(null);

  const addCut = () => {
    if (!cLen.trim()) return;
    setCuts((prev) => [
      ...prev,
      { label: cLabel.trim() || `Cut ${prev.length + 1}`, length: cLen.trim(), quantity: cQty || '1' },
    ]);
    setCLabel('');
    setCLen('');
    setCQty('1');
  };

  const optimize = async () => {
    if (cuts.length === 0) return;
    // cutList is a pure-compute macro that reads artifact.data; the /api/lens/run
    // route builds the virtual artifact's `data` from the input payload, so the
    // stockLength + cuts fields go at the top level of the input.
    const r = await run('cutList', {
      stockLength: parseFloat(stock) || 96,
      cuts: cuts.map((c) => ({
        label: c.label,
        length: parseFloat(c.length) || 0,
        quantity: parseInt(c.quantity) || 1,
      })),
    });
    if (r) setResult(r as DCutList);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
        <label className={ds.label}>Stock board length (inches)</label>
        <input type="number" className={cn(ds.input, 'w-40')} value={stock} onChange={(e) => setStock(e.target.value)} />
        <div className="grid grid-cols-4 gap-2">
          <input className={ds.input} placeholder="Label" value={cLabel} onChange={(e) => setCLabel(e.target.value)} />
          <input
            type="number"
            className={ds.input}
            placeholder="Length"
            value={cLen}
            onChange={(e) => setCLen(e.target.value)}
          />
          <input
            type="number"
            className={ds.input}
            placeholder="Qty"
            value={cQty}
            onChange={(e) => setCQty(e.target.value)}
          />
          <button onClick={addCut} className={ds.btnSecondary}>
            <Plus className="h-4 w-4" /> Add cut
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cuts.map((c, i) => (
            <span
              key={`${c.label}-${i}`}
              className="flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300"
            >
              {c.label}: {c.length}&quot; ×{c.quantity}
              <button onClick={() => setCuts((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove cut">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <button onClick={optimize} className={ds.btnPrimary} disabled={busy || cuts.length === 0}>
          <Scissors className="h-4 w-4" /> Optimize cut list
        </button>
      </div>

      {result && result.boards && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Boards needed" value={`${result.boardsNeeded}`} />
            <Stat label="Efficiency" value={`${result.efficiency}%`} />
            <Stat label="Total waste" value={`${result.totalWaste}"`} />
          </div>
          {/* board-layout diagram: each board as a proportional strip */}
          <div className="space-y-2">
            {result.boards.map((b) => {
              const usedPct = Math.max(0, Math.min(100, b.utilization));
              return (
                <div key={b.board}>
                  <div className="mb-0.5 flex justify-between text-[10px] text-zinc-400">
                    <span>Board {b.board}</span>
                    <span>{usedPct}% used · {b.remaining}&quot; left</span>
                  </div>
                  <div className="flex h-7 overflow-hidden rounded border border-zinc-700 bg-zinc-900">
                    {b.cuts.map((c, ci) => {
                      // parse "Label: 40"" → numeric length for proportional width
                      const m = c.match(/:\s*([\d.]+)/);
                      const len = m ? parseFloat(m[1]) : 0;
                      const widthPct = (len / result.stockLength) * 100;
                      return (
                        <div
                          key={ci}
                          className="flex items-center justify-center border-r border-zinc-950 bg-orange-500/40 text-[9px] text-orange-100"
                          style={{ width: `${widthPct}%` }}
                          title={c}
                        >
                          {widthPct > 8 ? c.split(':')[0] : ''}
                        </div>
                      );
                    })}
                    <div className="flex-1 bg-zinc-800/60" title={`${b.remaining}" offcut`} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="flex items-center gap-1 text-[11px] text-zinc-400">
            <ExternalLink className="h-3 w-3" /> {result.wasteTip}
          </p>
        </div>
      )}
    </div>
  );
}
