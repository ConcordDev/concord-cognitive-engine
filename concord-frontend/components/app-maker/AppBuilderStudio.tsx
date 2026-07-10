'use client';

/**
 * AppBuilderStudio — the no-code builder surface for the app-maker lens.
 * Wires every macro in server/domains/appmaker.js to real, purpose-built UI:
 *   projectCreate/List/Get/Duplicate/Delete
 *   editorPalette / editorAddPage / editorSavePage / editorDeletePage  (visual canvas)
 *   dataFieldTypes / dataAddTable / dataSaveTable / dataDeleteTable / dataAddRelation / dataDeleteRelation
 *   workflowOptions / workflowSave / workflowDelete
 *   previewRender                                                       (iframe live preview)
 *   deployPublish / deployStatus                                        (real hosted URL)
 *   librarySave / libraryList / libraryDelete                           (component library)
 *   connectorKinds / connectorSave / connectorList / connectorDelete / connectorTest
 *   versionSnapshot / versionList / versionRestore                      (version history)
 *   dataBindElement / dataUnbindElement / dataBindings                  (canvas element <-> table/connector wiring)
 *   questGraphCreate/List/Get/Delete, questNodeSave/Delete, questEdgeAdd/Delete,
 *   questGraphValidate                                                  (branching quest/narrative author graph)
 *   marketPublish / marketBrowse / marketInstall / marketUnpublish      (cross-user component marketplace)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Plus, Trash2, Copy, Layers, Database, Workflow, Eye, Rocket,
  Package, Plug, History, MousePointer2, Save, RefreshCw, ExternalLink,
  CheckCircle, XCircle, Loader2, GripVertical, FileCode,
  Link2, Unlink, Store, GitBranch, AlertTriangle, Info,
} from 'lucide-react';

const DOMAIN = 'app-maker';

interface PaletteItem { type: string; label: string; category: string; w: number; h: number }
interface ElBinding { kind: 'table' | 'connector'; refId: string; label: string; query?: string; boundAt?: string }
interface CanvasEl { id: string; type: string; x: number; y: number; w: number; h: number; props: Record<string, unknown>; binding?: ElBinding }
interface Page { id: string; name: string; route: string; elements: CanvasEl[] }
interface Field { id: string; name: string; type: string; required: boolean; primary: boolean }
interface Table { id: string; name: string; fields: Field[] }
interface Relation { id: string; fromTable: string; toTable: string; fromName: string; toName: string; kind: string; label: string }
interface WfStep { id: string; action: string; target: string; config: Record<string, unknown> }
interface Workflow { id: string; name: string; trigger: string; enabled: boolean; steps: WfStep[] }
interface Connector { id: string; name: string; kind: string; endpoint: string; method: string; authMode: string; status: string }
interface LibComponent { id: string; name: string; baseType: string; props: Record<string, unknown>; style: Record<string, unknown> }
interface VersionMeta { id: string; label: string; createdAt: string; deployUrl?: string | null; pageCount: number; tableCount: number }
interface Project {
  id: string; name: string; createdAt: string; updatedAt: string;
  pages: Page[]; dataModel: { tables: Table[]; relations: Relation[] };
  workflows: Workflow[]; connectors: Connector[]; componentLibrary: LibComponent[];
  versions: unknown[]; deployment: { status: string; url: string | null; deployedAt: string | null };
}
interface ProjectSummary {
  id: string; name: string; pageCount: number; tableCount: number;
  workflowCount: number; connectorCount: number; versionCount: number;
  deployment: { status: string; url: string | null };
}

type Tab = 'canvas' | 'data' | 'workflows' | 'connectors' | 'library' | 'quests' | 'preview' | 'deploy' | 'versions';

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'canvas', label: 'Editor', icon: MousePointer2 },
  { id: 'data', label: 'Data Model', icon: Database },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'library', label: 'Components', icon: Package },
  { id: 'quests', label: 'Quests', icon: GitBranch },
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'deploy', label: 'Deploy', icon: Rocket },
  { id: 'versions', label: 'History', icon: History },
];

const ELEMENT_COLORS: Record<string, string> = {
  button: '#0e7490', input: '#334155', text: '#475569', heading: '#7c3aed',
  image: '#1e293b', table: '#0891b2', list: '#0d9488', card: '#1e293b',
  container: '#1e293b', form: '#4338ca', chart: '#06b6d4', nav: '#334155',
};

export function AppBuilderStudio() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>('canvas');
  const [busy, setBusy] = useState<string | null>(null);
  const [newProjName, setNewProjName] = useState('');

  // ── helpers ──────────────────────────────────────────────────────
  const run = useCallback(async (name: string, params: Record<string, unknown>) => {
    const r = await lensRun(DOMAIN, name, params);
    return r.data;
  }, []);

  const loadProjects = useCallback(async () => {
    const d = await run('projectList', {});
    if (d?.ok) setProjects((d.result as { projects: ProjectSummary[] }).projects || []);
  }, [run]);

  const loadProject = useCallback(async (id: string) => {
    const d = await run('projectGet', { projectId: id });
    if (d?.ok) { setProject((d.result as { project: Project }).project); setActiveId(id); }
  }, [run]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const createProject = async () => {
    if (!newProjName.trim()) return;
    setBusy('create');
    const d = await run('projectCreate', { name: newProjName.trim() });
    setBusy(null);
    if (d?.ok) {
      setNewProjName('');
      await loadProjects();
      await loadProject((d.result as { project: Project }).project.id);
    }
  };

  const duplicateProject = async (id: string) => {
    setBusy('dup');
    const d = await run('projectDuplicate', { projectId: id });
    setBusy(null);
    if (d?.ok) await loadProjects();
  };

  const deleteProject = async (id: string) => {
    setBusy('del');
    await run('projectDelete', { projectId: id });
    setBusy(null);
    if (activeId === id) { setProject(null); setActiveId(null); }
    await loadProjects();
  };

  return (
    <div className="space-y-4">
      {/* ── Project picker bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={newProjName}
          onChange={(e) => setNewProjName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createProject()}
          placeholder="New project name…"
          className="bg-lattice-deep border border-lattice-edge rounded px-3 py-1.5 text-sm flex-1 min-w-[160px]"
        />
        <button
          onClick={createProject}
          disabled={busy === 'create' || !newProjName.trim()}
          className="bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-40"
        >
          {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          New Project
        </button>
      </div>

      {projects.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors ${
                activeId === p.id ? 'border-neon-cyan/60 bg-neon-cyan/10' : 'border-lattice-edge bg-lattice-deep'
              }`}
            >
              <button onClick={() => loadProject(p.id)} className="font-medium">
                {p.name}
              </button>
              <span className="text-gray-400">
                {p.pageCount}p · {p.tableCount}t · {p.workflowCount}w
              </span>
              {p.deployment?.status === 'live' && <span className="text-green-400">live</span>}
              <button onClick={() => duplicateProject(p.id)} title="Duplicate" className="text-gray-400 hover:text-neon-cyan">
                <Copy className="w-3 h-3" />
              </button>
              <button onClick={() => deleteProject(p.id)} title="Delete" className="text-gray-400 hover:text-red-400">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!project ? (
        <div className="panel p-8 text-center text-sm text-gray-400">
          {projects.length === 0
            ? 'Create a project to start building. The builder gives you a visual canvas, a data-model designer, a workflow builder, live preview and one-click deploy.'
            : 'Select a project above to open the builder.'}
        </div>
      ) : (
        <>
          {/* ── Tab nav ── */}
          <div className="flex items-center gap-1 border-b border-lattice-edge overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-colors ${
                    tab === t.id ? 'border-neon-cyan text-neon-cyan' : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'canvas' && <CanvasEditor project={project} run={run} reload={() => loadProject(project.id)} />}
          {tab === 'data' && <DataModelDesigner project={project} run={run} reload={() => loadProject(project.id)} />}
          {tab === 'workflows' && <WorkflowBuilder project={project} run={run} reload={() => loadProject(project.id)} />}
          {tab === 'connectors' && <ConnectorPanel project={project} run={run} reload={() => loadProject(project.id)} />}
          {tab === 'library' && <ComponentLibraryPanel project={project} run={run} reload={() => loadProject(project.id)} />}
          {tab === 'quests' && <QuestGraphEditor project={project} run={run} reload={() => loadProject(project.id)} />}
          {tab === 'preview' && <LivePreview project={project} run={run} />}
          {tab === 'deploy' && <DeployPanel project={project} run={run} reload={() => loadProject(project.id)} />}
          {tab === 'versions' && <VersionHistory project={project} run={run} reload={() => loadProject(project.id)} />}
        </>
      )}
    </div>
  );
}

type RunFn = (name: string, params: Record<string, unknown>) => Promise<{ ok: boolean; result: unknown; error: string | null }>;
interface SubProps { project: Project; run: RunFn; reload: () => void }

// ──────────────────────────────────────────────────────────────────
// Visual drag-and-drop canvas editor
// ──────────────────────────────────────────────────────────────────
function CanvasEditor({ project, run, reload }: SubProps) {
  const [palette, setPalette] = useState<PaletteItem[]>([]);
  const [pageId, setPageId] = useState<string>(project.pages[0]?.id || '');
  const [elements, setElements] = useState<CanvasEl[]>(project.pages[0]?.elements || []);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOff = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [bindDraft, setBindDraft] = useState<{ kind: 'table' | 'connector'; refId: string; query: string }>({ kind: 'table', refId: '', query: '' });
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    run('editorPalette', {}).then((d) => {
      if (d?.ok) setPalette((d.result as { palette: PaletteItem[] }).palette || []);
    });
  }, [run]);

  useEffect(() => {
    const pg = project.pages.find((p) => p.id === pageId) || project.pages[0];
    if (pg) { setPageId(pg.id); setElements(pg.elements || []); }
  }, [project, pageId]);

  const addElement = (p: PaletteItem) => {
    const el: CanvasEl = {
      id: `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: p.type, x: 24, y: 24, w: p.w, h: p.h, props: { label: p.label },
    };
    setElements((els) => [...els, el]);
    setSelected(el.id);
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!dragId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - dragOff.current.x));
    const y = Math.max(0, Math.round(e.clientY - rect.top - dragOff.current.y));
    setElements((els) => els.map((el) => (el.id === dragId ? { ...el, x, y } : el)));
  };

  const startDrag = (e: React.MouseEvent, el: CanvasEl) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    dragOff.current = { x: e.clientX - rect.left - el.x, y: e.clientY - rect.top - el.y };
    setDragId(el.id);
    setSelected(el.id);
  };

  const updateProp = (key: string, value: string) => {
    if (!selected) return;
    setElements((els) => els.map((el) => (el.id === selected ? { ...el, props: { ...el.props, [key]: value } } : el)));
  };
  const updateSize = (key: 'w' | 'h' | 'x' | 'y', value: number) => {
    if (!selected) return;
    setElements((els) => els.map((el) => (el.id === selected ? { ...el, [key]: value } : el)));
  };
  const deleteElement = (id: string) => {
    setElements((els) => els.filter((el) => el.id !== id));
    if (selected === id) setSelected(null);
  };

  const bindElement = async () => {
    if (!selected || !bindDraft.refId) return;
    setBinding(true);
    const d = await run('dataBindElement', {
      projectId: project.id, pageId, elementId: selected,
      source: { kind: bindDraft.kind, refId: bindDraft.refId, query: bindDraft.query },
    });
    setBinding(false);
    if (d?.ok) reload();
  };
  const unbindElement = async () => {
    if (!selected) return;
    setBinding(true);
    const d = await run('dataUnbindElement', { projectId: project.id, pageId, elementId: selected });
    setBinding(false);
    if (d?.ok) reload();
  };

  const savePage = async () => {
    const d = await run('editorSavePage', { projectId: project.id, pageId, elements });
    if (d?.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800); reload(); }
  };

  const addPage = async () => {
    const name = prompt('Page name?');
    if (!name) return;
    const d = await run('editorAddPage', { projectId: project.id, name });
    if (d?.ok) reload();
  };
  const deletePage = async () => {
    if (project.pages.length <= 1) return;
    const d = await run('editorDeletePage', { projectId: project.id, pageId });
    if (d?.ok) reload();
  };

  const sel = elements.find((el) => el.id === selected) || null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs"
        >
          {project.pages.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.route})</option>)}
        </select>
        <button onClick={addPage} className="text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1">
          <Plus className="w-3 h-3" /> Page
        </button>
        <button
          onClick={deletePage}
          disabled={project.pages.length <= 1}
          className="text-xs text-gray-400 hover:text-red-400 flex items-center gap-1 disabled:opacity-30"
        >
          <Trash2 className="w-3 h-3" /> Delete page
        </button>
        <button
          onClick={savePage}
          className="ml-auto text-xs bg-green-500/10 border border-green-500/30 text-green-400 rounded px-3 py-1 flex items-center gap-1"
        >
          {saved ? <CheckCircle className="w-3 h-3" /> : <Save className="w-3 h-3" />}
          {saved ? 'Saved' : 'Save Layout'}
        </button>
      </div>

      <div className="grid grid-cols-[150px_1fr_180px] gap-3">
        {/* palette */}
        <div className="panel p-2 space-y-1 max-h-[460px] overflow-y-auto">
          <p className="text-[10px] uppercase text-gray-400 px-1 mb-1">Elements</p>
          {palette.map((p) => (
            <button
              key={p.type}
              onClick={() => addElement(p)}
              className="w-full text-left text-xs px-2 py-1.5 rounded bg-lattice-deep hover:bg-lattice-edge flex items-center gap-1.5"
            >
              <GripVertical className="w-3 h-3 text-gray-600" />
              {p.label}
            </button>
          ))}
        </div>

        {/* canvas */}
        <div
          ref={canvasRef}
          onMouseMove={onCanvasMouseMove}
          onMouseUp={() => setDragId(null)}
          onMouseLeave={() => setDragId(null)}
          onClick={(e) => { if (e.target === canvasRef.current) setSelected(null); }}
          className="relative bg-[#020617] border border-lattice-edge rounded-lg overflow-hidden h-[460px]"
          style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '20px 20px' }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          {elements.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
              Click an element from the palette to add it, then drag to position.
            </p>
          )}
          {elements.map((el) => (
            <div
              key={el.id}
              onMouseDown={(e) => startDrag(e, el)}
              className={`absolute rounded cursor-move flex items-center justify-center text-[11px] text-white/90 select-none overflow-hidden ${
                selected === el.id ? 'ring-2 ring-neon-cyan' : 'ring-1 ring-white/10'
              }`}
              style={{
                left: el.x, top: el.y, width: el.w, height: el.h,
                background: ELEMENT_COLORS[el.type] || '#1e293b',
              }}
            >
              {String(el.props.label || el.props.text || el.type)}
            </div>
          ))}
        </div>

        {/* inspector */}
        <div className="panel p-2 space-y-2 max-h-[460px] overflow-y-auto">
          <p className="text-[10px] uppercase text-gray-400">Inspector</p>
          {!sel ? (
            <p className="text-xs text-gray-400">Select an element to style it.</p>
          ) : (
            <>
              <p className="text-xs text-neon-cyan font-mono">{sel.type}</p>
              <label className="block text-[10px] text-gray-400">Label
                <input
                  value={String(sel.props.label || '')}
                  onChange={(e) => updateProp('label', e.target.value)}
                  className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs mt-0.5"
                />
              </label>
              {(sel.type === 'input' || sel.type === 'form') && (
                <label className="block text-[10px] text-gray-400">Placeholder
                  <input
                    value={String(sel.props.placeholder || '')}
                    onChange={(e) => updateProp('placeholder', e.target.value)}
                    className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs mt-0.5"
                  />
                </label>
              )}
              {sel.type === 'image' && (
                <label className="block text-[10px] text-gray-400">Image URL
                  <input
                    value={String(sel.props.src || '')}
                    onChange={(e) => updateProp('src', e.target.value)}
                    className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs mt-0.5"
                  />
                </label>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {(['x', 'y', 'w', 'h'] as const).map((k) => (
                  <label key={k} className="block text-[10px] text-gray-400 uppercase">{k}
                    <input
                      type="number"
                      value={sel[k]}
                      onChange={(e) => updateSize(k, Number(e.target.value) || 0)}
                      className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs mt-0.5"
                    />
                  </label>
                ))}
              </div>
              <div className="border-t border-lattice-edge pt-2 space-y-1.5">
                <p className="text-[10px] uppercase text-gray-400 flex items-center gap-1"><Link2 className="w-3 h-3" /> Data binding</p>
                {sel.binding ? (
                  <div className="flex items-center gap-1.5 bg-lattice-deep rounded px-2 py-1.5">
                    <span className="text-[11px] text-neon-cyan truncate flex-1">
                      {sel.binding.kind}: {sel.binding.label}
                    </span>
                    <button
                      onClick={unbindElement}
                      disabled={binding}
                      title="Unbind"
                      className="text-gray-400 hover:text-red-400 shrink-0"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (project.dataModel.tables.length === 0 && project.connectors.length === 0) ? (
                  <p className="text-[10px] text-gray-400">Add a table (Data Model tab) or connector to bind this element to live data.</p>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-1">
                      <select
                        value={bindDraft.kind}
                        onChange={(e) => setBindDraft({ kind: e.target.value as 'table' | 'connector', refId: '', query: '' })}
                        className="bg-lattice-deep border border-lattice-edge rounded px-1.5 py-1 text-[11px]"
                      >
                        <option value="table">Table</option>
                        <option value="connector">Connector</option>
                      </select>
                      <select
                        value={bindDraft.refId}
                        onChange={(e) => setBindDraft({ ...bindDraft, refId: e.target.value })}
                        className="flex-1 bg-lattice-deep border border-lattice-edge rounded px-1.5 py-1 text-[11px] min-w-0"
                      >
                        <option value="">
                          {bindDraft.kind === 'table' ? 'Choose table…' : 'Choose connector…'}
                        </option>
                        {(bindDraft.kind === 'table' ? project.dataModel.tables : project.connectors).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      value={bindDraft.query}
                      onChange={(e) => setBindDraft({ ...bindDraft, query: e.target.value })}
                      placeholder="Optional query/filter…"
                      className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-[11px]"
                    />
                    <button
                      onClick={bindElement}
                      disabled={!bindDraft.refId || binding}
                      className="w-full text-[11px] text-neon-cyan hover:bg-neon-cyan/10 rounded py-1 flex items-center justify-center gap-1 disabled:opacity-40"
                    >
                      {binding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Bind element
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => deleteElement(sel.id)}
                className="w-full text-xs text-red-400 hover:bg-red-500/10 rounded py-1 flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Delete element
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Data-model designer
// ──────────────────────────────────────────────────────────────────
interface BindingRow { pageId: string; pageName: string; elementId: string; elementType: string; kind: string; refId: string; label: string; query?: string }

function DataModelDesigner({ project, run, reload }: SubProps) {
  const [fieldTypes, setFieldTypes] = useState<string[]>([]);
  const [newTable, setNewTable] = useState('');
  const [editFields, setEditFields] = useState<Record<string, Field[]>>({});
  const [rel, setRel] = useState({ fromTable: '', toTable: '', kind: 'one-to-many' });
  const [bindings, setBindings] = useState<BindingRow[]>([]);

  const tables = project.dataModel.tables;
  const relations = project.dataModel.relations;

  useEffect(() => {
    run('dataFieldTypes', {}).then((d) => {
      if (d?.ok) setFieldTypes((d.result as { fieldTypes: string[] }).fieldTypes || []);
    });
  }, [run]);

  useEffect(() => {
    run('dataBindings', { projectId: project.id }).then((d) => {
      if (d?.ok) setBindings((d.result as { bindings: BindingRow[] }).bindings || []);
    });
  }, [run, project.id, project.updatedAt]);

  const addTable = async () => {
    if (!newTable.trim()) return;
    const d = await run('dataAddTable', { projectId: project.id, name: newTable.trim() });
    if (d?.ok) { setNewTable(''); reload(); }
  };
  const fieldsFor = (t: Table) => editFields[t.id] ?? t.fields;
  const mutateFields = (tableId: string, fields: Field[]) =>
    setEditFields((m) => ({ ...m, [tableId]: fields }));
  const addField = (t: Table) =>
    mutateFields(t.id, [...fieldsFor(t), { id: `f_${Math.random().toString(36).slice(2, 7)}`, name: 'new_field', type: 'text', required: false, primary: false }]);
  const saveTable = async (t: Table) => {
    const d = await run('dataSaveTable', { projectId: project.id, tableId: t.id, fields: fieldsFor(t) });
    if (d?.ok) { setEditFields((m) => { const n = { ...m }; delete n[t.id]; return n; }); reload(); }
  };
  const deleteTable = async (t: Table) => {
    const d = await run('dataDeleteTable', { projectId: project.id, tableId: t.id });
    if (d?.ok) reload();
  };
  const addRelation = async () => {
    if (!rel.fromTable || !rel.toTable) return;
    const d = await run('dataAddRelation', { projectId: project.id, ...rel });
    if (d?.ok) { setRel({ fromTable: '', toTable: '', kind: 'one-to-many' }); reload(); }
  };
  const deleteRelation = async (id: string) => {
    const d = await run('dataDeleteRelation', { projectId: project.id, relationId: id });
    if (d?.ok) reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={newTable}
          onChange={(e) => setNewTable(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTable()}
          placeholder="New table name…"
          className="bg-lattice-deep border border-lattice-edge rounded px-3 py-1.5 text-sm flex-1"
        />
        <button onClick={addTable} className="bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded px-3 py-1.5 text-sm flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> Add Table
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {tables.map((t) => {
          const dirty = !!editFields[t.id];
          return (
            <div key={t.id} className="panel p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-neon-cyan" /> {t.name}
                </span>
                <div className="flex items-center gap-1">
                  {dirty && (
                    <button onClick={() => saveTable(t)} className="text-xs text-green-400 hover:bg-green-500/10 rounded px-1.5 py-0.5">
                      Save
                    </button>
                  )}
                  <button aria-label="Delete" onClick={() => deleteTable(t)} className="text-gray-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="space-y-1">
                {fieldsFor(t).map((f, i) => (
                  <div key={f.id} className="flex items-center gap-1.5">
                    <input
                      value={f.name}
                      onChange={(e) => { const fs = [...fieldsFor(t)]; fs[i] = { ...f, name: e.target.value }; mutateFields(t.id, fs); }}
                      className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs flex-1"
                    />
                    <select
                      value={f.type}
                      onChange={(e) => { const fs = [...fieldsFor(t)]; fs[i] = { ...f, type: e.target.value }; mutateFields(t.id, fs); }}
                      className="bg-lattice-deep border border-lattice-edge rounded px-1 py-1 text-xs"
                    >
                      {fieldTypes.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                    </select>
                    <label className="text-[10px] text-gray-400 flex items-center gap-0.5" title="Required">
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) => { const fs = [...fieldsFor(t)]; fs[i] = { ...f, required: e.target.checked }; mutateFields(t.id, fs); }}
                      /> req
                    </label>
                    <button aria-label="Close"
                      onClick={() => mutateFields(t.id, fieldsFor(t).filter((_, j) => j !== i))}
                      className="text-gray-600 hover:text-red-400"
                    >
                      <XCircle className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => addField(t)} className="text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add field
              </button>
            </div>
          );
        })}
      </div>

      {/* relations */}
      <div className="panel p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Workflow className="w-3.5 h-3.5 text-neon-purple" /> Relations</p>
        {tables.length >= 2 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={rel.fromTable} onChange={(e) => setRel({ ...rel, fromTable: e.target.value })} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
              <option value="">From…</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={rel.kind} onChange={(e) => setRel({ ...rel, kind: e.target.value })} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
              <option value="one-to-one">one-to-one</option>
              <option value="one-to-many">one-to-many</option>
              <option value="many-to-many">many-to-many</option>
            </select>
            <select value={rel.toTable} onChange={(e) => setRel({ ...rel, toTable: e.target.value })} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
              <option value="">To…</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={addRelation} className="text-xs text-neon-cyan hover:bg-neon-cyan/10 rounded px-2 py-1 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Link
            </button>
          </div>
        )}
        {relations.length === 0 ? (
          <p className="text-xs text-gray-400">No relations yet.</p>
        ) : relations.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs bg-lattice-deep rounded px-2 py-1">
            <span className="text-white">{r.fromName}</span>
            <span className="text-neon-purple font-mono">{r.kind}</span>
            <span className="text-white">{r.toName}</span>
            <button aria-label="Delete" onClick={() => deleteRelation(r.id)} className="ml-auto text-gray-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      {/* data bindings across the whole project — bound in the Editor tab's inspector */}
      <div className="panel p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5 text-neon-cyan" /> Data bindings</p>
        {bindings.length === 0 ? (
          <p className="text-xs text-gray-400">No canvas elements are bound to live data yet — select an element in the Editor tab and bind it to a table or connector.</p>
        ) : bindings.map((b) => (
          <div key={`${b.pageId}:${b.elementId}`} className="flex items-center gap-2 text-xs bg-lattice-deep rounded px-2 py-1">
            <span className="text-gray-400">{b.pageName}</span>
            <span className="text-white font-mono">{b.elementType}</span>
            <span className="text-gray-600">→</span>
            <span className="text-[10px] bg-neon-cyan/15 text-neon-cyan rounded px-1.5 py-0.5">{b.kind}</span>
            <span className="text-white">{b.label}</span>
            {b.query && <span className="text-gray-400 font-mono truncate">({b.query})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Workflow / event-action builder
// ──────────────────────────────────────────────────────────────────
function WorkflowBuilder({ project, run, reload }: SubProps) {
  const [opts, setOpts] = useState<{ triggers: string[]; actions: string[] }>({ triggers: [], actions: [] });
  const [draft, setDraft] = useState<{ name: string; trigger: string; steps: WfStep[] }>({ name: '', trigger: 'button_click', steps: [] });

  useEffect(() => {
    run('workflowOptions', {}).then((d) => {
      if (d?.ok) {
        const r = d.result as { triggers: string[]; actions: string[] };
        setOpts(r);
        setDraft((dr) => ({ ...dr, trigger: r.triggers[0] || 'button_click' }));
      }
    });
  }, [run]);

  const addStep = () =>
    setDraft((d) => ({ ...d, steps: [...d.steps, { id: `s_${Math.random().toString(36).slice(2, 7)}`, action: opts.actions[0] || 'show_toast', target: '', config: {} }] }));
  const saveWorkflow = async () => {
    if (!draft.name.trim()) return;
    const d = await run('workflowSave', {
      projectId: project.id,
      workflow: { name: draft.name.trim(), trigger: draft.trigger, steps: draft.steps },
    });
    if (d?.ok) { setDraft({ name: '', trigger: opts.triggers[0] || 'button_click', steps: [] }); reload(); }
  };
  const deleteWorkflow = async (id: string) => {
    const d = await run('workflowDelete', { projectId: project.id, workflowId: id });
    if (d?.ok) reload();
  };

  return (
    <div className="space-y-3">
      <div className="panel p-3 space-y-2">
        <p className="text-sm font-semibold">New workflow rule</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Workflow name…"
            className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs flex-1 min-w-[140px]"
          />
          <span className="text-xs text-gray-400">When</span>
          <select value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
            {opts.triggers.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        {draft.steps.map((st, i) => (
          <div key={st.id} className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-400 w-8">→ {i + 1}</span>
            <select
              value={st.action}
              onChange={(e) => { const ss = [...draft.steps]; ss[i] = { ...st, action: e.target.value }; setDraft({ ...draft, steps: ss }); }}
              className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs"
            >
              {opts.actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
            <input
              value={st.target}
              onChange={(e) => { const ss = [...draft.steps]; ss[i] = { ...st, target: e.target.value }; setDraft({ ...draft, steps: ss }); }}
              placeholder="target (table / page / url)"
              className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs flex-1"
            />
            <button onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })} className="text-gray-600 hover:text-red-400">
              <XCircle className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button onClick={addStep} className="text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add step
          </button>
          <button
            onClick={saveWorkflow}
            disabled={!draft.name.trim()}
            className="ml-auto text-xs bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded px-3 py-1 disabled:opacity-40"
          >
            Save workflow
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {project.workflows.length === 0 ? (
          <p className="text-xs text-gray-400">No workflows yet.</p>
        ) : project.workflows.map((w) => (
          <div key={w.id} className="panel p-3">
            <div className="flex items-center gap-2">
              <Workflow className="w-3.5 h-3.5 text-neon-purple" />
              <span className="text-sm font-medium">{w.name}</span>
              <span className="text-[10px] bg-neon-purple/15 text-neon-purple rounded px-1.5 py-0.5">{w.trigger.replace(/_/g, ' ')}</span>
              <button aria-label="Delete" onClick={() => deleteWorkflow(w.id)} className="ml-auto text-gray-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
              {w.steps.map((s, i) => (
                <span key={s.id} className="bg-lattice-deep rounded px-1.5 py-0.5 text-gray-300">
                  {i + 1}. {s.action.replace(/_/g, ' ')}{s.target ? ` → ${s.target}` : ''}
                </span>
              ))}
              {w.steps.length === 0 && <span className="text-gray-600">no steps</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Connectors
// ──────────────────────────────────────────────────────────────────
function ConnectorPanel({ project, run, reload }: SubProps) {
  const [kinds, setKinds] = useState<{ kind: string; label: string; authModes: string[] }[]>([]);
  const [draft, setDraft] = useState({ name: '', kind: 'rest', endpoint: '', method: 'GET', authMode: 'none' });
  const [tests, setTests] = useState<Record<string, { reachable: boolean | null; httpStatus?: number; latencyMs?: number; error?: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    run('connectorKinds', {}).then((d) => {
      if (d?.ok) setKinds((d.result as { kinds: typeof kinds }).kinds || []);
    });
  }, [run]);

  const currentKind = kinds.find((k) => k.kind === draft.kind);

  const saveConnector = async () => {
    if (!draft.name.trim()) return;
    const d = await run('connectorSave', { projectId: project.id, connector: draft });
    if (d?.ok) { setDraft({ name: '', kind: 'rest', endpoint: '', method: 'GET', authMode: 'none' }); reload(); }
  };
  const deleteConnector = async (id: string) => {
    const d = await run('connectorDelete', { projectId: project.id, connectorId: id });
    if (d?.ok) reload();
  };
  const testConnector = async (id: string) => {
    setTesting(id);
    const d = await run('connectorTest', { projectId: project.id, connectorId: id });
    setTesting(null);
    if (d?.ok) setTests((m) => ({ ...m, [id]: d.result as (typeof tests)[string] }));
  };

  return (
    <div className="space-y-3">
      <div className="panel p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Plug className="w-3.5 h-3.5 text-neon-cyan" /> Add data source</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Connector name…" className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs" />
          <select
            value={draft.kind}
            onChange={(e) => { const k = kinds.find((x) => x.kind === e.target.value); setDraft({ ...draft, kind: e.target.value, authMode: k?.authModes[0] || 'none' }); }}
            className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs"
          >
            {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <input value={draft.endpoint} onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} placeholder="https://api.example.com/…" className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs col-span-2" />
          <select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
            {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={draft.authMode} onChange={(e) => setDraft({ ...draft, authMode: e.target.value })} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
            {(currentKind?.authModes || ['none']).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button onClick={saveConnector} disabled={!draft.name.trim()} className="text-xs bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded px-3 py-1 disabled:opacity-40">
          Save connector
        </button>
      </div>

      <div className="space-y-2">
        {project.connectors.length === 0 ? (
          <p className="text-xs text-gray-400">No connectors yet.</p>
        ) : project.connectors.map((c) => {
          const t = tests[c.id];
          return (
            <div key={c.id} className="panel p-3">
              <div className="flex items-center gap-2">
                <Plug className="w-3.5 h-3.5 text-neon-cyan" />
                <span className="text-sm font-medium">{c.name}</span>
                <span className="text-[10px] bg-lattice-deep rounded px-1.5 py-0.5 text-gray-400">{c.kind} · {c.method}</span>
                <button
                  onClick={() => testConnector(c.id)}
                  disabled={testing === c.id}
                  className="ml-auto text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1"
                >
                  {testing === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Test
                </button>
                <button aria-label="Delete" onClick={() => deleteConnector(c.id)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <p className="text-[11px] text-gray-400 font-mono mt-1 truncate">{c.endpoint || '(no endpoint)'}</p>
              {t && (
                <div className={`mt-1 text-xs flex items-center gap-1.5 ${t.reachable ? 'text-green-400' : t.reachable === false ? 'text-red-400' : 'text-gray-400'}`}>
                  {t.reachable ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {t.reachable
                    ? `Reachable · HTTP ${t.httpStatus} · ${t.latencyMs}ms`
                    : t.reachable === false
                      ? `Unreachable${t.error ? ` · ${t.error}` : t.httpStatus ? ` · HTTP ${t.httpStatus}` : ''}`
                      : 'Not network-probable'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Reusable component library
// ──────────────────────────────────────────────────────────────────
interface MarketListing { id: string; name: string; description: string; category: string; baseType: string; publisherId: string; installs: number; publishedAt: string }

function ComponentLibraryPanel({ project, run, reload }: SubProps) {
  const [draft, setDraft] = useState({ name: '', baseType: 'card', bg: '#1e293b', radius: '8', text: '#e2e8f0' });
  const [lib, setLib] = useState<LibComponent[]>(project.componentLibrary || []);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [marketQuery, setMarketQuery] = useState('');
  const [marketCategory, setMarketCategory] = useState('all');
  const [publishing, setPublishing] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    run('libraryList', { projectId: project.id }).then((d) => {
      if (d?.ok) setLib((d.result as { library: LibComponent[] }).library || []);
    });
  }, [run, project.id]);

  const loadMarket = useCallback(async () => {
    const d = await run('marketBrowse', { category: marketCategory === 'all' ? undefined : marketCategory, q: marketQuery.trim() || undefined });
    if (d?.ok) {
      const r = d.result as { listings: MarketListing[]; categories: string[] };
      setListings(r.listings || []);
      setCategories(r.categories || []);
    }
  }, [run, marketCategory, marketQuery]);

  useEffect(() => { void loadMarket(); }, [loadMarket]);

  const publishComponent = async (componentId: string) => {
    setPublishing(componentId);
    const d = await run('marketPublish', { projectId: project.id, componentId });
    setPublishing(null);
    if (d?.ok) void loadMarket();
  };
  const installListing = async (listingId: string) => {
    setInstalling(listingId);
    const d = await run('marketInstall', { projectId: project.id, listingId });
    setInstalling(null);
    if (d?.ok) {
      setLib((d.result as { library: LibComponent[] }).library || []);
      reload();
      void loadMarket();
    }
  };
  const unpublishListing = async (listingId: string) => {
    const d = await run('marketUnpublish', { listingId });
    if (d?.ok) void loadMarket();
  };

  const saveComponent = async () => {
    if (!draft.name.trim()) return;
    const d = await run('librarySave', {
      projectId: project.id,
      component: {
        name: draft.name.trim(),
        baseType: draft.baseType,
        props: { label: draft.name.trim() },
        style: { background: draft.bg, borderRadius: `${draft.radius}px`, color: draft.text },
      },
    });
    if (d?.ok) {
      setLib((d.result as { library: LibComponent[] }).library || []);
      setDraft({ name: '', baseType: 'card', bg: '#1e293b', radius: '8', text: '#e2e8f0' });
      reload();
    }
  };
  const deleteComponent = async (id: string) => {
    const d = await run('libraryDelete', { projectId: project.id, componentId: id });
    if (d?.ok) { setLib((d.result as { library: LibComponent[] }).library || []); reload(); }
  };

  return (
    <div className="space-y-3">
      <div className="panel p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Package className="w-3.5 h-3.5 text-neon-cyan" /> Save a styled component</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Component name…" className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs" />
          <select value={draft.baseType} onChange={(e) => setDraft({ ...draft, baseType: e.target.value })} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
            {['card', 'button', 'container', 'form', 'nav'].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <label className="text-[10px] text-gray-400 flex items-center gap-1">Background
            <input type="color" value={draft.bg} onChange={(e) => setDraft({ ...draft, bg: e.target.value })} className="h-6 w-8 bg-transparent" />
          </label>
          <label className="text-[10px] text-gray-400 flex items-center gap-1">Text
            <input type="color" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className="h-6 w-8 bg-transparent" />
          </label>
          <label className="text-[10px] text-gray-400 flex items-center gap-1 col-span-2">Corner radius
            <input type="range" min="0" max="24" value={draft.radius} onChange={(e) => setDraft({ ...draft, radius: e.target.value })} className="flex-1" />
            <span className="w-8 text-right">{draft.radius}px</span>
          </label>
        </div>
        <button onClick={saveComponent} disabled={!draft.name.trim()} className="text-xs bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded px-3 py-1 disabled:opacity-40">
          Save to library
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {lib.length === 0 ? (
          <p className="text-xs text-gray-400 col-span-full">No reusable components yet.</p>
        ) : lib.map((c) => (
          <div key={c.id} className="panel p-2 space-y-1.5">
            <div
              className="h-16 flex items-center justify-center text-xs"
              style={{
                background: String(c.style.background || '#1e293b'),
                borderRadius: String(c.style.borderRadius || '8px'),
                color: String(c.style.color || '#e2e8f0'),
              }}
            >
              {c.name}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">{c.baseType}</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => publishComponent(c.id)}
                  disabled={publishing === c.id}
                  title="Publish to community marketplace"
                  className="text-gray-400 hover:text-neon-purple"
                >
                  {publishing === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Store className="w-3 h-3" />}
                </button>
                <button aria-label="Delete" onClick={() => deleteComponent(c.id)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Community marketplace — install other users' published components ── */}
      <div className="panel p-3 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Store className="w-3.5 h-3.5 text-neon-purple" /> Community marketplace</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={marketQuery}
            onChange={(e) => setMarketQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadMarket()}
            placeholder="Search published components…"
            className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs flex-1 min-w-[160px]"
          />
          <select
            value={marketCategory}
            onChange={(e) => setMarketCategory(e.target.value)}
            className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs"
          >
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {listings.length === 0 ? (
          <p className="text-xs text-gray-400">No published components yet — publish one of yours above to seed the marketplace.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {listings.map((l) => (
              <div key={l.id} className="panel p-2 space-y-1">
                <p className="text-xs font-medium text-white truncate">{l.name}</p>
                <p className="text-[10px] text-gray-400 truncate">{l.description || l.baseType}</p>
                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <span className="bg-lattice-deep rounded px-1 py-0.5">{l.category}</span>
                  <span>{l.installs} installs</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => installListing(l.id)}
                    disabled={installing === l.id}
                    className="flex-1 text-[11px] text-neon-cyan hover:bg-neon-cyan/10 rounded py-1 flex items-center justify-center gap-1"
                  >
                    {installing === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Install
                  </button>
                  <button
                    onClick={() => unpublishListing(l.id)}
                    title="Unpublish (only your own listings)"
                    className="text-gray-600 hover:text-red-400"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Quest / branching-narrative graph author. Distinct from the runtime
// quest engine — this is a per-user authoring surface for step/choice/
// reward/ending nodes connected by labelled edges, with structural lint.
// ──────────────────────────────────────────────────────────────────
interface QNode { id: string; kind: string; title: string; body: string; x: number; y: number; reward?: string }
interface QEdge { id: string; from: string; to: string; label?: string }
interface QGraphSummary { id: string; title: string; createdAt: string; updatedAt: string; nodeCount: number; edgeCount: number }
interface QGraph { id: string; title: string; nodes: QNode[]; edges: QEdge[] }
interface QIssue { severity: 'error' | 'warning' | 'info'; type: string; nodeId?: string; title?: string }
interface QValidation { valid: boolean; issues: QIssue[]; summary: { nodes: number; edges: number; reachable: number; endings: number; errorCount: number; warningCount: number } }

const QNODE_COLORS: Record<string, string> = {
  start: '#16a34a', step: '#334155', choice: '#7c3aed', reward: '#ca8a04', ending: '#dc2626',
};

function QuestGraphEditor({ run }: SubProps) {
  const [graphs, setGraphs] = useState<QGraphSummary[]>([]);
  const [graph, setGraph] = useState<QGraph | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [validation, setValidation] = useState<QValidation | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOff = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const loadGraphs = useCallback(async () => {
    const d = await run('questGraphList', {});
    if (d?.ok) setGraphs((d.result as { graphs: QGraphSummary[] }).graphs || []);
  }, [run]);

  useEffect(() => { void loadGraphs(); }, [loadGraphs]);

  const openGraph = useCallback(async (id: string) => {
    const d = await run('questGraphGet', { graphId: id });
    if (d?.ok) {
      setGraph((d.result as { graph: QGraph }).graph);
      setSelected(null);
      setConnectFrom(null);
      setValidation(null);
    }
  }, [run]);

  const createGraph = async () => {
    if (!newTitle.trim()) return;
    const d = await run('questGraphCreate', { title: newTitle.trim() });
    if (d?.ok) {
      setNewTitle('');
      await loadGraphs();
      await openGraph((d.result as { graph: QGraph }).graph.id);
    }
  };
  const deleteGraph = async (id: string) => {
    const d = await run('questGraphDelete', { graphId: id });
    if (d?.ok) {
      if (graph?.id === id) setGraph(null);
      await loadGraphs();
    }
  };

  const addNode = async (kind: string) => {
    if (!graph) return;
    const d = await run('questNodeSave', {
      graphId: graph.id,
      node: { kind, title: kind[0].toUpperCase() + kind.slice(1), x: 40 + Math.round(Math.random() * 300), y: 40 + Math.round(Math.random() * 200) },
    });
    if (d?.ok) { await openGraph(graph.id); setSelected((d.result as { node: QNode }).node.id); }
  };
  const saveNode = async (node: QNode) => {
    if (!graph) return;
    const d = await run('questNodeSave', { graphId: graph.id, node });
    if (d?.ok) await openGraph(graph.id);
  };
  const deleteNode = async (nodeId: string) => {
    if (!graph) return;
    const d = await run('questNodeDelete', { graphId: graph.id, nodeId });
    if (d?.ok) { if (selected === nodeId) setSelected(null); await openGraph(graph.id); }
  };
  const addEdge = async (from: string, to: string) => {
    if (!graph) return;
    const label = window.prompt('Edge condition/label (optional)?') || '';
    const d = await run('questEdgeAdd', { graphId: graph.id, from, to, label });
    if (d?.ok) await openGraph(graph.id);
  };
  const deleteEdge = async (edgeId: string) => {
    if (!graph) return;
    const d = await run('questEdgeDelete', { graphId: graph.id, edgeId });
    if (d?.ok) await openGraph(graph.id);
  };
  const validate = async () => {
    if (!graph) return;
    const d = await run('questGraphValidate', { graphId: graph.id });
    if (d?.ok) setValidation(d.result as QValidation);
  };

  const onNodeMouseDown = (e: React.MouseEvent, n: QNode) => {
    if (connectFrom) {
      if (connectFrom !== n.id) void addEdge(connectFrom, n.id);
      setConnectFrom(null);
      return;
    }
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    dragOff.current = { x: e.clientX - rect.left - n.x, y: e.clientY - rect.top - n.y };
    setDragId(n.id);
    setSelected(n.id);
  };
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!dragId || !canvasRef.current || !graph) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - dragOff.current.x));
    const y = Math.max(0, Math.round(e.clientY - rect.top - dragOff.current.y));
    setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === dragId ? { ...n, x, y } : n)) });
  };
  const onCanvasMouseUp = () => {
    if (dragId && graph) { const n = graph.nodes.find((x) => x.id === dragId); if (n) void saveNode(n); }
    setDragId(null);
  };

  const sel = graph?.nodes.find((n) => n.id === selected) || null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createGraph()}
          placeholder="New quest title…"
          className="bg-lattice-deep border border-lattice-edge rounded px-3 py-1.5 text-sm flex-1 min-w-[160px]"
        />
        <button onClick={createGraph} disabled={!newTitle.trim()} className="bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-40">
          <Plus className="w-3.5 h-3.5" /> New Quest Graph
        </button>
      </div>

      {graphs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {graphs.map((g) => (
            <div key={g.id} className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${graph?.id === g.id ? 'border-neon-cyan/60 bg-neon-cyan/10' : 'border-lattice-edge bg-lattice-deep'}`}>
              <button onClick={() => openGraph(g.id)} className="font-medium">{g.title}</button>
              <span className="text-gray-400">{g.nodeCount}n · {g.edgeCount}e</span>
              <button onClick={() => deleteGraph(g.id)} title="Delete graph" className="text-gray-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}

      {!graph ? (
        <div className="panel p-8 text-center text-sm text-gray-400">
          Create or select a quest graph to author branching steps, choices, rewards and endings.
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_220px] gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              {['step', 'choice', 'reward', 'ending'].map((kind) => (
                <button
                  key={kind}
                  onClick={() => addNode(kind)}
                  className="text-xs px-2 py-1 rounded bg-lattice-deep hover:bg-lattice-edge flex items-center gap-1"
                  style={{ color: QNODE_COLORS[kind] }}
                >
                  <Plus className="w-3 h-3" /> {kind}
                </button>
              ))}
              <button
                onClick={() => setConnectFrom(connectFrom ? null : selected)}
                disabled={!selected && !connectFrom}
                className={`text-xs px-2 py-1 rounded flex items-center gap-1 ml-1 ${connectFrom ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-lattice-deep text-gray-400 hover:text-white'}`}
              >
                <GitBranch className="w-3 h-3" /> {connectFrom ? 'Click target node…' : 'Connect from selected'}
              </button>
              <button onClick={validate} className="ml-auto text-xs px-2 py-1 rounded bg-lattice-deep text-gray-400 hover:text-neon-cyan flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Validate
              </button>
            </div>

            <div
              ref={canvasRef}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={() => setDragId(null)}
              className="relative bg-[#020617] border border-lattice-edge rounded-lg overflow-hidden h-[400px]"
              style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '20px 20px' }}
            >
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {graph.edges.map((e) => {
                  const from = graph.nodes.find((n) => n.id === e.from);
                  const to = graph.nodes.find((n) => n.id === e.to);
                  if (!from || !to) return null;
                  return (
                    <g key={e.id}>
                      <line x1={from.x + 60} y1={from.y + 18} x2={to.x + 60} y2={to.y + 18} stroke="#475569" strokeWidth={1.5} markerEnd="url(#qarrow)" />
                      {e.label && (
                        <text x={(from.x + to.x) / 2 + 60} y={(from.y + to.y) / 2 + 14} fill="#94a3b8" fontSize={10}>{e.label}</text>
                      )}
                    </g>
                  );
                })}
                <defs>
                  <marker id="qarrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#475569" />
                  </marker>
                </defs>
              </svg>
              {graph.nodes.map((n) => (
                <div
                  key={n.id}
                  onMouseDown={(e) => onNodeMouseDown(e, n)}
                  className={`absolute rounded px-2 py-1.5 text-[11px] text-white select-none w-[120px] ${
                    selected === n.id ? 'ring-2 ring-neon-cyan' : 'ring-1 ring-white/10'
                  } ${connectFrom ? 'cursor-crosshair' : 'cursor-move'}`}
                  style={{ left: n.x, top: n.y, background: QNODE_COLORS[n.kind] || '#334155' }}
                >
                  <p className="font-semibold truncate">{n.title}</p>
                  <p className="text-[9px] uppercase opacity-70">{n.kind}</p>
                </div>
              ))}
              {graph.nodes.length === 0 && (
                <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
                  Add a node to start branching this quest.
                </p>
              )}
            </div>

            {validation && (
              <div className="panel p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  {validation.valid ? <CheckCircle className="w-4 h-4 text-green-400" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}
                  <span className={`text-sm font-medium ${validation.valid ? 'text-green-400' : 'text-red-400'}`}>
                    {validation.valid ? 'Structurally valid' : 'Issues found'}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {validation.summary.nodes} nodes · {validation.summary.edges} edges · {validation.summary.reachable} reachable · {validation.summary.endings} endings
                  </span>
                </div>
                {validation.issues.length === 0 ? (
                  <p className="text-xs text-gray-400">No issues.</p>
                ) : validation.issues.map((iss, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {iss.severity === 'error' ? <XCircle className="w-3 h-3 text-red-400" /> : iss.severity === 'warning' ? <AlertTriangle className="w-3 h-3 text-yellow-400" /> : <Info className="w-3 h-3 text-gray-400" />}
                    <span className="text-white">{iss.type.replace(/_/g, ' ')}</span>
                    {iss.title && <span className="text-gray-400">— {iss.title}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* node inspector */}
          <div className="panel p-2 space-y-2 max-h-[460px] overflow-y-auto">
            <p className="text-[10px] uppercase text-gray-400">Node</p>
            {!sel ? (
              <p className="text-xs text-gray-400">Select a node to edit it.</p>
            ) : (
              <>
                <p className="text-xs font-mono" style={{ color: QNODE_COLORS[sel.kind] }}>{sel.kind}</p>
                <label className="block text-[10px] text-gray-400">Title
                  <input
                    value={sel.title}
                    onChange={(e) => setGraph((g) => g && { ...g, nodes: g.nodes.map((n) => (n.id === sel.id ? { ...n, title: e.target.value } : n)) })}
                    onBlur={() => saveNode(sel)}
                    className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs mt-0.5"
                  />
                </label>
                <label className="block text-[10px] text-gray-400">Body
                  <textarea
                    value={sel.body}
                    onChange={(e) => setGraph((g) => g && { ...g, nodes: g.nodes.map((n) => (n.id === sel.id ? { ...n, body: e.target.value } : n)) })}
                    onBlur={() => saveNode(sel)}
                    rows={4}
                    className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs mt-0.5"
                  />
                </label>
                {sel.kind === 'reward' && (
                  <label className="block text-[10px] text-gray-400">Reward
                    <input
                      value={sel.reward || ''}
                      onChange={(e) => setGraph((g) => g && { ...g, nodes: g.nodes.map((n) => (n.id === sel.id ? { ...n, reward: e.target.value } : n)) })}
                      onBlur={() => saveNode(sel)}
                      className="w-full bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs mt-0.5"
                    />
                  </label>
                )}
                <div className="space-y-1">
                  <p className="text-[10px] uppercase text-gray-400">Outgoing edges</p>
                  {graph.edges.filter((e) => e.from === sel.id).length === 0 ? (
                    <p className="text-[11px] text-gray-500">None — use &quot;Connect from selected&quot;.</p>
                  ) : graph.edges.filter((e) => e.from === sel.id).map((e) => {
                    const to = graph.nodes.find((n) => n.id === e.to);
                    return (
                      <div key={e.id} className="flex items-center gap-1 text-[11px] bg-lattice-deep rounded px-1.5 py-1">
                        <span className="truncate flex-1">→ {to?.title || e.to}{e.label ? ` (${e.label})` : ''}</span>
                        <button onClick={() => deleteEdge(e.id)} className="text-gray-600 hover:text-red-400"><XCircle className="w-3 h-3" /></button>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => deleteNode(sel.id)}
                  disabled={sel.kind === 'start'}
                  className="w-full text-xs text-red-400 hover:bg-red-500/10 rounded py-1 flex items-center justify-center gap-1 disabled:opacity-30"
                >
                  <Trash2 className="w-3 h-3" /> Delete node
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Live preview (iframe via srcDoc)
// ──────────────────────────────────────────────────────────────────
function LivePreview({ project, run }: { project: Project; run: RunFn }) {
  const [html, setHtml] = useState('');
  const [pageId, setPageId] = useState<string>(project.pages[0]?.id || '');
  const [loading, setLoading] = useState(false);

  const render = useCallback(async (pid: string) => {
    setLoading(true);
    const d = await run('previewRender', { projectId: project.id, pageId: pid });
    setLoading(false);
    if (d?.ok) setHtml((d.result as { html: string }).html || '');
  }, [project.id, run]);

  useEffect(() => { if (pageId) render(pageId); }, [pageId, render]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select value={pageId} onChange={(e) => setPageId(e.target.value)} className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-xs">
          {project.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={() => render(pageId)} className="text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
        </button>
        <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-1"><FileCode className="w-3 h-3" /> sandboxed iframe</span>
      </div>
      <iframe
        title="App live preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        className="w-full h-[480px] bg-[#020617] border border-lattice-edge rounded-lg"
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Deploy
// ──────────────────────────────────────────────────────────────────
function DeployPanel({ project, run, reload }: SubProps) {
  const [label, setLabel] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [status, setStatus] = useState(project.deployment);

  useEffect(() => {
    run('deployStatus', { projectId: project.id }).then((d) => {
      if (d?.ok) setStatus((d.result as { deployment: Project['deployment'] }).deployment);
    });
  }, [run, project.id]);

  const publish = async () => {
    setDeploying(true);
    const d = await run('deployPublish', { projectId: project.id, label: label.trim() || undefined });
    setDeploying(false);
    if (d?.ok) {
      setStatus((d.result as { deployment: Project['deployment'] }).deployment);
      setLabel('');
      reload();
    }
  };

  return (
    <div className="space-y-3">
      <div className="panel p-4 space-y-3">
        <p className="text-sm font-semibold flex items-center gap-1.5"><Rocket className="w-4 h-4 text-neon-purple" /> Deploy to hosted URL</p>
        <p className="text-xs text-gray-400">
          Publishing snapshots the current project ({project.pages.length} pages, {project.dataModel.tables.length} tables,
          {' '}{project.workflows.length} workflows) and assigns a stable hosted URL on apps.concord-os.org.
        </p>
        <div className="flex items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Release label (optional)…"
            className="bg-lattice-deep border border-lattice-edge rounded px-3 py-1.5 text-sm flex-1"
          />
          <button
            onClick={publish}
            disabled={deploying}
            className="bg-neon-purple/10 border border-neon-purple/30 text-neon-purple rounded px-4 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-40"
          >
            {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            {deploying ? 'Deploying…' : 'Deploy'}
          </button>
        </div>
      </div>

      <div className="panel p-4">
        <p className="text-xs uppercase text-gray-400 mb-2">Deployment status</p>
        {status?.status === 'live' && status.url ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-green-400 font-medium">Live</span>
              {status.deployedAt && <span className="text-xs text-gray-400">since {new Date(status.deployedAt).toLocaleString()}</span>}
            </div>
            <a
              href={status.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-neon-cyan hover:underline font-mono"
            >
              {status.url} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="w-2 h-2 rounded-full bg-gray-600" />
            Not deployed yet
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Version history
// ──────────────────────────────────────────────────────────────────
function VersionHistory({ project, run, reload }: SubProps) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const loadVersions = useCallback(async () => {
    const d = await run('versionList', { projectId: project.id });
    if (d?.ok) setVersions((d.result as { versions: VersionMeta[] }).versions || []);
  }, [run, project.id]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const snapshot = async () => {
    setBusy(true);
    const d = await run('versionSnapshot', { projectId: project.id, label: label.trim() || undefined });
    setBusy(false);
    if (d?.ok) { setLabel(''); loadVersions(); }
  };
  const restore = async (id: string) => {
    setBusy(true);
    const d = await run('versionRestore', { projectId: project.id, versionId: id });
    setBusy(false);
    if (d?.ok) { reload(); loadVersions(); }
  };

  return (
    <div className="space-y-3">
      <div className="panel p-3 flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Snapshot label…"
          className="bg-lattice-deep border border-lattice-edge rounded px-3 py-1.5 text-sm flex-1"
        />
        <button onClick={snapshot} disabled={busy} className="bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded px-3 py-1.5 text-sm flex items-center gap-1 disabled:opacity-40">
          <History className="w-3.5 h-3.5" /> Snapshot now
        </button>
      </div>

      <div className="space-y-2">
        {versions.length === 0 ? (
          <p className="text-xs text-gray-400">No versions yet. Snapshots are created automatically on each deploy.</p>
        ) : versions.map((v) => (
          <div key={v.id} className="panel p-3 flex items-center gap-3">
            <History className="w-4 h-4 text-neon-purple" />
            <div className="flex-1">
              <p className="text-sm font-medium">{v.label}</p>
              <p className="text-[11px] text-gray-400">
                {new Date(v.createdAt).toLocaleString()} · {v.pageCount} pages · {v.tableCount} tables
                {v.deployUrl ? ' · deployed' : ''}
              </p>
            </div>
            <button
              onClick={() => restore(v.id)}
              disabled={busy}
              className="text-xs text-gray-400 hover:text-neon-cyan flex items-center gap-1 disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" /> Restore
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
