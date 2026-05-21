'use client';

/**
 * ProjectBuilder — the no-code app builder workspace. Manages the
 * project list and hosts the visual editor, data-model designer,
 * workflow builder, version history and live preview for one project.
 * Backed by the `app-maker` macro domain.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Layers, Plus, Trash2, Copy, Loader2, LayoutGrid, Database, Zap, History, Eye, Store,
} from 'lucide-react';
import { VisualEditor } from './VisualEditor';
import { DataModelDesigner } from './DataModelDesigner';
import { WorkflowBuilder } from './WorkflowBuilder';
import { VersionHistory } from './VersionHistory';
import { PreviewPane } from './PreviewPane';
import { ComponentMarket } from './ComponentMarket';

interface ProjectSummary {
  id: string; name: string; pageCount: number; tableCount: number;
  workflowCount: number; versionCount: number;
  deployment?: { status: string; url?: string | null };
}
interface PageMeta { id: string; name: string; route: string }
interface DataTable { id: string; name: string; fields: { name: string; type: string }[] }
interface Connector { id: string; name: string; kind: string }

type BuilderTab = 'editor' | 'data' | 'workflows' | 'market' | 'versions';

const SUBTABS: { key: BuilderTab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'editor', label: 'Editor', icon: LayoutGrid },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'workflows', label: 'Workflows', icon: Zap },
  { key: 'market', label: 'Marketplace', icon: Store },
  { key: 'versions', label: 'Versions', icon: History },
];

export function ProjectBuilder() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [tables, setTables] = useState<DataTable[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [tab, setTab] = useState<BuilderTab>('editor');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [preview, setPreview] = useState<{ pageId?: string } | null>(null);

  const refreshProjects = useCallback(async () => {
    const r = await lensRun('app-maker', 'projectList', {});
    if (r.data?.ok) {
      const list: ProjectSummary[] = r.data.result?.projects ?? [];
      setProjects(list);
      if (!activeId && list.length) setActiveId(list[0].id);
    }
  }, [activeId]);

  const loadProject = useCallback(async (id: string) => {
    const r = await lensRun('app-maker', 'projectGet', { projectId: id });
    if (r.data?.ok) {
      const p = r.data.result?.project;
      setPages((p?.pages ?? []).map((pg: PageMeta) => ({ id: pg.id, name: pg.name, route: pg.route })));
      setTables(p?.dataModel?.tables ?? []);
      setConnectors(p?.connectors ?? []);
    }
  }, []);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { if (activeId) void loadProject(activeId); }, [activeId, loadProject]);

  async function createProject() {
    setBusy(true);
    const r = await lensRun('app-maker', 'projectCreate', { name: newName || 'Untitled App' });
    setBusy(false);
    if (r.data?.ok) {
      setNewName('');
      await refreshProjects();
      setActiveId(r.data.result?.project?.id ?? null);
    }
  }

  async function duplicateProject(id: string) {
    const r = await lensRun('app-maker', 'projectDuplicate', { projectId: id });
    if (r.data?.ok) { await refreshProjects(); setActiveId(r.data.result?.project?.id ?? id); }
  }

  async function deleteProject(id: string) {
    const r = await lensRun('app-maker', 'projectDelete', { projectId: id });
    if (r.data?.ok) {
      const remaining = projects.filter((p) => p.id !== id);
      setProjects(remaining);
      if (activeId === id) setActiveId(remaining[0]?.id ?? null);
    }
  }

  const active = projects.find((p) => p.id === activeId) ?? null;

  return (
    <div className="space-y-3">
      {/* Project bar */}
      <div className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2.5">
        <div className="mb-2 flex items-center gap-2">
          <Layers className="h-4 w-4 text-pink-400" />
          <h3 className="text-sm font-semibold text-pink-200">Projects</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createProject()}
            placeholder="New app name"
            className="ml-auto rounded border border-pink-900/40 bg-black/40 px-2 py-1 text-[11px] text-pink-100"
          />
          <button
            onClick={createProject}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-pink-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-pink-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} New
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
                activeId === p.id ? 'border-pink-400 bg-pink-900/30' : 'border-pink-900/40 bg-black/30'
              }`}
            >
              <button onClick={() => setActiveId(p.id)} className="text-pink-100">
                {p.name}
                <span className="ml-1 text-pink-700">
                  {p.pageCount}p·{p.tableCount}t·{p.workflowCount}w
                </span>
                {p.deployment?.status === 'live' && <span className="ml-1 text-emerald-400">●</span>}
              </button>
              <button onClick={() => duplicateProject(p.id)} className="text-pink-500 hover:text-pink-300" title="Duplicate">
                <Copy className="h-3 w-3" />
              </button>
              <button onClick={() => deleteProject(p.id)} className="text-rose-500 hover:text-rose-300" title="Delete">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          {!projects.length && <span className="text-[11px] text-pink-700">No projects yet — create your first app above.</span>}
        </div>
      </div>

      {!active && (
        <p className="rounded border border-pink-900/30 bg-pink-950/10 px-4 py-8 text-center text-xs text-pink-600">
          Create or select a project to start building.
        </p>
      )}

      {active && (
        <>
          <nav className="flex gap-1 border-b border-pink-900/30">
            {SUBTABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1 border-b-2 px-3 py-1.5 text-[12px] font-medium ${
                  tab === key ? 'border-pink-400 text-pink-200' : 'border-transparent text-pink-700 hover:text-pink-400'
                }`}
              >
                <Icon className="h-3 w-3" /> {label}
              </button>
            ))}
            <button
              onClick={() => setPreview({ pageId: pages[0]?.id })}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 text-[12px] text-pink-300 hover:text-pink-100"
            >
              <Eye className="h-3 w-3" /> Preview
            </button>
          </nav>

          {preview && (
            <PreviewPane
              projectId={active.id}
              initialPageId={preview.pageId}
              onClose={() => setPreview(null)}
            />
          )}

          {tab === 'editor' && (
            <VisualEditor
              key={active.id}
              projectId={active.id}
              pages={pages}
              tables={tables}
              connectors={connectors}
              onPreview={(pageId) => setPreview({ pageId })}
              onPagesChanged={() => loadProject(active.id)}
            />
          )}
          {tab === 'data' && (
            <DataModelDesigner key={active.id} projectId={active.id} onChanged={() => loadProject(active.id)} />
          )}
          {tab === 'workflows' && (
            <WorkflowBuilder key={active.id} projectId={active.id} onChanged={() => refreshProjects()} />
          )}
          {tab === 'market' && (
            <ComponentMarket projectId={active.id} onLibraryChanged={() => loadProject(active.id)} />
          )}
          {tab === 'versions' && (
            <VersionHistory key={active.id} projectId={active.id} onRestored={() => loadProject(active.id)} />
          )}
        </>
      )}
    </div>
  );
}
