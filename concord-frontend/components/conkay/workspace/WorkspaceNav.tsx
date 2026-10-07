'use client';

/**
 * WorkspaceNav — the ConKay workspace's left rail.
 *
 * Every section reads a real store: Projects = Chat projects, Models = saved
 * engineering parts, Simulations = this user's sim jobs, Data Vault = the
 * user's own DTUs, Library = the engineering material library, Workspaces =
 * ConKay agent projects (each keeps its own study). Empty stores say so.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Boxes, ChevronLeft, Database, FolderKanban, Library, Loader2, MessageSquare, Plus, Search,
} from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import type { BeamDims } from '@/lib/conkay/workspace-commands';
import type { Material } from './useConKayWorkspace';

export type NavSection = 'projects' | 'models' | 'simulations' | 'vault' | 'library';

export interface WorkspaceSummary {
  id: string;
  name: string;
}

interface Props {
  section: NavSection | null;
  onSection: (s: NavSection | null) => void;
  workspaces: WorkspaceSummary[];
  workspacesError: string;
  workspaceId: string | null;
  onWorkspace: (id: string | null) => void;
  onCreateWorkspace: (name: string) => Promise<string | null>;
  materials: Material[];
  materialId: string;
  onMaterial: (id: string) => void;
  onOpenModel: (name: string, dims: BeamDims, materialId: string | null) => void;
  onAskAboutDtu: (dtu: { id: string; title: string }) => void;
  /** Bumped after a save/solve so open lists refetch. */
  refreshKey: number;
}

const SECTIONS: Array<{ id: NavSection; label: string; icon: typeof Boxes }> = [
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'models', label: 'Models', icon: Boxes },
  { id: 'simulations', label: 'Simulations', icon: Activity },
  { id: 'vault', label: 'Data Vault', icon: Database },
  { id: 'library', label: 'Library', icon: Library },
];

const itemCls = 'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors';

function when(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1 py-3 text-xs leading-relaxed text-slate-400">{children}</p>;
}

function useList<T>(load: () => Promise<{ items: T[]; error?: string }>, deps: unknown[]) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setItems(null);
    setError('');
    void load().then((r) => {
      if (!live) return;
      setItems(r.items);
      setError(r.error || '');
    }).catch((e: unknown) => { if (live) { setItems([]); setError(e instanceof Error ? e.message : 'Could not load.'); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { items, error };
}

function ListState({ items, error, empty }: { items: unknown[] | null; error: string; empty: React.ReactNode }) {
  if (items === null) return <p className="flex items-center gap-2 px-1 py-3 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading…</p>;
  if (error) return <p className="px-1 py-3 text-xs text-rose-300">{error}</p>;
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return null;
}

interface ChatProject { id: string; name: string; threadIds?: string[]; updatedAt?: string }
interface Part { id: string; name: string; kind: string; params?: Record<string, number>; material?: string | null; geometry?: { mass?: number }; updatedAt?: string }
interface SimJob { id: string; name?: string; type?: string; status?: string; elapsedMs?: number; summary?: { maxUtilization?: number; allPass?: boolean; runs?: number; passing?: number }; createdAt?: string }
interface VaultDtu { id: string; title?: string; tags?: string[]; createdAt?: string }

function ProjectsPanel({ refreshKey }: { refreshKey: number }) {
  const { items, error } = useList<ChatProject>(async () => {
    const r = await lensRun<{ projects: ChatProject[] }>('chat', 'projects-list', {});
    return { items: r.data?.result?.projects ?? [], error: r.data?.ok === false ? r.data.error || 'Could not load projects.' : '' };
  }, [refreshKey]);
  return (
    <div className="space-y-1">
      <ListState items={items} error={error} empty={<>No Chat projects yet. <Link className="text-sky-300 underline" href="/lenses/chat">Create one in Chat</Link>.</>} />
      {items?.map((p) => (
        <Link key={p.id} href={`/lenses/chat?project=${encodeURIComponent(p.id)}`} className={`${itemCls} block text-slate-200 hover:bg-white/5`}>
          <span className="block truncate">{p.name}</span>
          <span className="text-[11px] text-slate-400">{(p.threadIds?.length ?? 0)} conversation{p.threadIds?.length === 1 ? '' : 's'} · {when(p.updatedAt)}</span>
        </Link>
      ))}
    </div>
  );
}

function ModelsPanel({ refreshKey, onOpenModel }: { refreshKey: number; onOpenModel: Props['onOpenModel'] }) {
  const { items, error } = useList<Part>(async () => {
    const r = await lensRun<{ parts: Part[] }>('engineering', 'listParts', {});
    return { items: r.data?.result?.parts ?? [], error: r.data?.ok === false ? r.data.error || 'Could not load models.' : '' };
  }, [refreshKey]);
  return (
    <div className="space-y-1">
      <ListState items={items} error={error} empty="No saved models. Say “save model” or use Save model to keep the current beam." />
      {items?.map((p) => {
        const isBeam = p.kind === 'i-beam' && p.params;
        const mm = (v?: number) => Math.round((v ?? 0) * 1000 * 1000) / 1000;
        return (
          <div key={p.id} className={`${itemCls} flex items-center justify-between gap-2 text-slate-200 hover:bg-white/5`}>
            <span className="min-w-0">
              <span className="block truncate">{p.name}</span>
              <span className="text-[11px] text-slate-400">
                {p.kind}{typeof p.geometry?.mass === 'number' ? ` · ${p.geometry.mass.toFixed(1)} kg` : ''} · {when(p.updatedAt)}
              </span>
            </span>
            {isBeam ? (
              <button
                type="button"
                className="shrink-0 rounded-md border border-sky-400/30 px-2 py-1 text-[11px] text-sky-200 hover:bg-sky-400/10"
                onClick={() => onOpenModel(p.name, {
                  length: mm(p.params!.length), height: mm(p.params!.height), flangeWidth: mm(p.params!.flangeWidth),
                  flangeThickness: mm(p.params!.flangeThickness), webThickness: mm(p.params!.webThickness),
                }, p.material ?? null)}
              >
                Open
              </button>
            ) : (
              <Link href="/lenses/engineering" className="shrink-0 text-[11px] text-slate-400 underline hover:text-slate-200">Engineering</Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

const JOB_TYPES: Record<string, string> = {
  'fea-beam-study': 'Beam study',
  'fea-beam-sweep': 'Parameter sweep',
};

function SimulationsPanel({ refreshKey }: { refreshKey: number }) {
  const { items, error } = useList<SimJob>(async () => {
    const r = await lensRun<{ jobs: SimJob[] }>('engineering', 'listSimJobs', {});
    return { items: r.data?.result?.jobs ?? [], error: r.data?.ok === false ? r.data.error || 'Could not load simulations.' : '' };
  }, [refreshKey]);
  return (
    <div className="space-y-1">
      <ListState items={items} error={error} empty="No simulations yet. Run FEA to record one." />
      {items?.map((j) => (
        <div key={j.id} className={`${itemCls} text-slate-200`}>
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">{j.name || j.id}</span>
            {typeof j.summary?.allPass === 'boolean' && (
              <span className={`shrink-0 rounded px-1.5 text-[10px] ${j.summary.allPass ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
                {j.summary.allPass ? 'pass' : 'fail'}
              </span>
            )}
          </span>
          <span className="text-[11px] text-slate-400">
            {JOB_TYPES[j.type || ''] || j.type || 'FEA'}
            {typeof j.summary?.maxUtilization === 'number' ? ` · ${(j.summary.maxUtilization * 100).toFixed(1)}% util.` : ''}
            {typeof j.summary?.runs === 'number' ? ` · ${j.summary.passing ?? 0}/${j.summary.runs} pass` : ''}
            {typeof j.elapsedMs === 'number' ? ` · ${j.elapsedMs} ms` : ''} · {when(j.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

function VaultPanel({ refreshKey, onAsk }: { refreshKey: number; onAsk: Props['onAskAboutDtu'] }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { items, error } = useList<VaultDtu>(async () => {
    const r = await api.get('/api/dtus/paginated', { params: { limit: 30, ...(query ? { q: query } : {}) } });
    return { items: Array.isArray(r.data?.items) ? r.data.items : [] };
  }, [refreshKey, query]);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your DTUs"
          aria-label="Search your DTUs"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
      </label>
      <ListState items={items} error={error} empty={query ? 'No DTUs match.' : 'Your vault is empty. Keep a study as a DTU to start it.'} />
      {items?.map((d) => (
        <div key={d.id} className={`${itemCls} text-slate-200 hover:bg-white/5`}>
          <span className="line-clamp-2 block">{d.title || d.id}</span>
          <span className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-slate-400">{(d.tags || []).slice(0, 3).join(' · ') || when(d.createdAt)}</span>
            <button type="button" onClick={() => onAsk({ id: d.id, title: d.title || d.id })} className="shrink-0 text-[11px] text-sky-300 hover:underline">
              Open here
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function LibraryPanel({ materials, materialId, onMaterial }: { materials: Material[]; materialId: string; onMaterial: (id: string) => void }) {
  if (materials.length === 0) return <ListState items={null} error="" empty="" />;
  return (
    <div className="space-y-1">
      {materials.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onMaterial(m.id)}
          aria-pressed={m.id === materialId}
          className={`${itemCls} ${m.id === materialId ? 'bg-sky-400/10 text-sky-100 ring-1 ring-sky-400/30' : 'text-slate-200 hover:bg-white/5'}`}
        >
          <span className="block truncate">{m.label}</span>
          <span className="text-[11px] text-slate-400">E {m.E.toLocaleString()} MPa · yield {m.yield} MPa · {m.density} kg/m³</span>
        </button>
      ))}
    </div>
  );
}

export function WorkspaceNav(props: Props) {
  const { section, onSection } = props;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const create = useCallback(async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setCreateError('');
    const id = await props.onCreateWorkspace(n);
    setBusy(false);
    if (id) { setCreating(false); setName(''); } else setCreateError('Could not create the workspace.');
  }, [name, props]);

  if (section) {
    const meta = SECTIONS.find((s) => s.id === section)!;
    return (
      <nav aria-label={meta.label} className="flex h-full min-h-0 flex-col">
        <button type="button" onClick={() => onSection(null)} className="mb-2 flex items-center gap-1.5 px-2 py-1.5 text-sm text-slate-300 hover:text-white">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {meta.label}
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {section === 'projects' && <ProjectsPanel refreshKey={props.refreshKey} />}
          {section === 'models' && <ModelsPanel refreshKey={props.refreshKey} onOpenModel={props.onOpenModel} />}
          {section === 'simulations' && <SimulationsPanel refreshKey={props.refreshKey} />}
          {section === 'vault' && <VaultPanel refreshKey={props.refreshKey} onAsk={props.onAskAboutDtu} />}
          {section === 'library' && <LibraryPanel materials={props.materials} materialId={props.materialId} onMaterial={props.onMaterial} />}
        </div>
      </nav>
    );
  }

  return (
    <nav aria-label="ConKay workspace" className="flex h-full min-h-0 flex-col">
      <Link href="/lenses/chat" className={`${itemCls} flex items-center gap-3 text-slate-200 hover:bg-white/5`}>
        <MessageSquare className="h-4 w-4 text-slate-400" aria-hidden /> Chat
      </Link>
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" onClick={() => onSection(id)} className={`${itemCls} flex items-center gap-3 text-slate-200 hover:bg-white/5`}>
          <Icon className="h-4 w-4 text-slate-400" aria-hidden /> {label}
        </button>
      ))}

      <div className="mt-5 flex items-center justify-between px-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">Workspaces</h2>
        <button type="button" onClick={() => setCreating((v) => !v)} aria-label="New workspace" title="New workspace" className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white">
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {creating && (
        <form className="mt-2 px-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Workspace name"
            aria-label="Workspace name"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/50 focus:outline-none"
          />
          {createError && <p className="mt-1 text-[11px] text-rose-300">{createError}</p>}
          <div className="mt-1.5 flex gap-2">
            <button type="submit" disabled={busy || !name.trim()} className="rounded-md bg-sky-500/80 px-2.5 py-1 text-xs text-white disabled:opacity-50">
              {busy ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => { setCreating(false); setName(''); }} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </form>
      )}
      <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        <button
          type="button"
          onClick={() => props.onWorkspace(null)}
          aria-current={props.workspaceId === null ? 'page' : undefined}
          className={`${itemCls} ${props.workspaceId === null ? 'bg-sky-400/10 text-sky-100' : 'text-slate-300 hover:bg-white/5'}`}
        >
          My workspace
        </button>
        {props.workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => props.onWorkspace(w.id)}
            aria-current={props.workspaceId === w.id ? 'page' : undefined}
            className={`${itemCls} truncate ${props.workspaceId === w.id ? 'bg-sky-400/10 text-sky-100' : 'text-slate-300 hover:bg-white/5'}`}
          >
            {w.name}
          </button>
        ))}
        {props.workspacesError && <p className="px-3 py-1 text-[11px] text-rose-300">{props.workspacesError}</p>}
      </div>
    </nav>
  );
}
