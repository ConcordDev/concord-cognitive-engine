'use client';

/**
 * Foundry — FoundryCanvas.
 *
 * The composer surface: three panes — ComponentPalette (left),
 * the canvas (center: the systems you've added, drag-drop target),
 * ConfigPanel (right: the active system's config). Header carries the
 * world name, universe type, validation status, and the Save / Publish
 * actions. "My worlds" strip lets you reload a saved draft.
 *
 * Live 3D preview is Phase 5 — this phase ships the full build +
 * configure + validate + save + publish loop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSystems, listWorlds, createWorld, updateWorld, getWorld,
  publishWorld, unpublishWorld, validateWorld, defaultConfig, fetchTemplates,
  type SystemEntry, type CategoryGroup, type SystemCategory,
  type WorldspecSystem, type Worldspec, type FoundryWorld, type ValidationResult,
  type FoundryRule, type TemplateSummary,
} from '@/lib/foundry/api';
import dynamic from 'next/dynamic';
import { ComponentPalette } from './ComponentPalette';
import { ConfigPanel } from './ConfigPanel';
import { FoundryRulesPanel } from './FoundryRulesPanel';
import {
  Loader2, Save, Rocket, Trash2, X, CheckCircle2, AlertTriangle,
  Circle, FileStack, Undo2, Eye,
} from 'lucide-react';

// Preview pulls in ConcordiaScene (Three.js) — load it only when opened.
const FoundryPreview = dynamic(() => import('./FoundryPreview'), { ssr: false });

const UNIVERSE_TYPES = [
  'fantasy', 'scifi', 'noir', 'cyber', 'post-apocalyptic',
  'historical', 'surreal', 'slice-of-life', 'horror', 'mythic',
];

export function FoundryCanvas() {
  // Catalog
  const [categories, setCategories] = useState<Record<SystemCategory, CategoryGroup> | null>(null);
  const [systemsById, setSystemsById] = useState<Map<string, SystemEntry>>(new Map());
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The worldspec under construction
  const [worldName, setWorldName] = useState('Untitled Game');
  const [worldDescription, setWorldDescription] = useState('');
  const [universeType, setUniverseType] = useState('fantasy');
  const [selected, setSelected] = useState<WorldspecSystem[]>([]);
  const [rules, setRules] = useState<FoundryRule[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);

  // Persistence + lifecycle
  const [currentWorldId, setCurrentWorldId] = useState<string | null>(null);
  const [worldStatus, setWorldStatus] = useState<'draft' | 'published' | null>(null);
  const [myWorlds, setMyWorlds] = useState<FoundryWorld[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  // ── Load catalog + my worlds ───────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cat = await fetchSystems();
        if (!alive) return;
        if (!cat.ok) { setCatalogError('Failed to load the system catalog.'); return; }
        setCategories(cat.categories);
        setSystemsById(new Map(cat.systems.map((s) => [s.id, s])));
      } catch {
        if (alive) setCatalogError('Could not reach the Foundry catalog. Is the backend up?');
      } finally {
        if (alive) setLoading(false);
      }
      try {
        const w = await listWorlds();
        if (alive && w.ok) setMyWorlds(w.worlds);
      } catch { /* my-worlds strip is best-effort */ }
      try {
        const t = await fetchTemplates();
        if (alive && t.ok) setTemplates(t.templates);
      } catch { /* template picker is best-effort */ }
    })();
    return () => { alive = false; };
  }, []);

  // ── Build the worldspec from current state ─────────────────────────────────
  const buildWorldspec = useCallback((): Worldspec => ({
    version: 1,
    template: null,
    theme: { universeType, displayName: worldName, palette: null },
    systems: selected,
    rules,
  }), [universeType, worldName, selected, rules]);

  // ── Live validation (debounced) ────────────────────────────────────────────
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);
    if (selected.length === 0) { setValidation(null); return; }
    validateTimer.current = setTimeout(async () => {
      try {
        const v = await validateWorld({ worldspec: buildWorldspec() });
        setValidation(v);
      } catch { /* validation is advisory — a failed call just leaves it stale */ }
    }, 400);
    return () => { if (validateTimer.current) clearTimeout(validateTimer.current); };
  }, [selected, buildWorldspec]);

  // ── System add / remove / configure ────────────────────────────────────────
  const addSystem = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.some((s) => s.id === id)) return prev;
      const sys = systemsById.get(id);
      if (!sys) return prev;
      return [...prev, { id, config: defaultConfig(sys.configSchema) }];
    });
    setActiveConfigId(id);
  }, [systemsById]);

  const removeSystem = useCallback((id: string) => {
    setSelected((prev) => prev.filter((s) => s.id !== id));
    setActiveConfigId((cur) => (cur === id ? null : cur));
  }, []);

  const updateConfig = useCallback((id: string, field: string, value: unknown) => {
    setSelected((prev) =>
      prev.map((s) => (s.id === id ? { ...s, config: { ...s.config, [field]: value } } : s)),
    );
  }, []);

  // ── Drag-drop onto the canvas ──────────────────────────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData('application/x-foundry-system');
    if (id) addSystem(id);
  };

  // ── Save / publish / load ──────────────────────────────────────────────────
  const flash = (kind: 'ok' | 'err', msg: string) => {
    setNotice({ kind, msg });
    setTimeout(() => setNotice(null), 4000);
  };

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const ws = buildWorldspec();
      if (currentWorldId) {
        const r = await updateWorld(currentWorldId, { name: worldName, description: worldDescription, worldspec: ws });
        if (!r.ok) { flash('err', `Save failed: ${r.reason}`); return; }
        flash('ok', 'Saved.');
      } else {
        const r = await createWorld(worldName, worldDescription, { worldspec: ws });
        if (!r.ok || !r.world) { flash('err', `Save failed: ${r.reason}`); return; }
        setCurrentWorldId(r.world.id);
        setWorldStatus(r.world.status);
        flash('ok', 'Created.');
      }
      const w = await listWorlds();
      if (w.ok) setMyWorlds(w.worlds);
    } catch {
      flash('err', 'Save failed — could not reach the backend.');
    } finally {
      setBusy(false);
    }
  }, [buildWorldspec, currentWorldId, worldName, worldDescription]);

  const doPublish = useCallback(async () => {
    if (!currentWorldId) { flash('err', 'Save before publishing.'); return; }
    setBusy(true);
    try {
      // Persist the latest edits first so publish compiles what's on screen.
      await updateWorld(currentWorldId, { name: worldName, description: worldDescription, worldspec: buildWorldspec() });
      const r = await publishWorld(currentWorldId);
      if (!r.ok) {
        flash('err', r.errors?.length ? `Can't publish: ${r.errors[0]}` : `Publish failed: ${r.reason}`);
        return;
      }
      setWorldStatus('published');
      const stubNote = r.skippedStubs?.length ? ` (${r.skippedStubs.length} system(s) pending Phase 7)` : '';
      flash('ok', `Published as a live world${stubNote}.`);
    } catch {
      flash('err', 'Publish failed — could not reach the backend.');
    } finally {
      setBusy(false);
    }
  }, [currentWorldId, worldName, worldDescription, buildWorldspec]);

  const doPreview = useCallback(async () => {
    if (!currentWorldId) { flash('err', 'Save before previewing.'); return; }
    setBusy(true);
    try {
      // Persist the latest edits so the preview renders what's on screen.
      await updateWorld(currentWorldId, { name: worldName, description: worldDescription, worldspec: buildWorldspec() });
      setShowPreview(true);
    } catch {
      flash('err', 'Could not save before preview — backend unreachable.');
    } finally {
      setBusy(false);
    }
  }, [currentWorldId, worldName, worldDescription, buildWorldspec]);

  const doUnpublish = useCallback(async () => {
    if (!currentWorldId) return;
    setBusy(true);
    try {
      const r = await unpublishWorld(currentWorldId);
      if (!r.ok) { flash('err', `Unpublish failed: ${r.reason}`); return; }
      setWorldStatus('draft');
      flash('ok', `Back to draft (world ${r.disposition}).`);
    } catch {
      flash('err', 'Unpublish failed — could not reach the backend.');
    } finally {
      setBusy(false);
    }
  }, [currentWorldId]);

  const loadWorld = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const r = await getWorld(id);
      if (!r.ok || !r.world) { flash('err', `Load failed: ${r.reason}`); return; }
      const w = r.world;
      setCurrentWorldId(w.id);
      setWorldName(w.name);
      setWorldDescription(w.description);
      setUniverseType(w.worldspec.theme.universeType);
      setSelected(w.worldspec.systems);
      setRules((w.worldspec.rules as FoundryRule[]) ?? []);
      setWorldStatus(w.status);
      setActiveConfigId(w.worldspec.systems[0]?.id ?? null);
    } catch {
      flash('err', 'Load failed — could not reach the backend.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Start a fresh draft from a template — created server-side so the
  // template's curated worldspec is normalized + validated on the way in.
  const createFromTemplate = useCallback(async (templateId: string) => {
    if (!templateId) return;
    setBusy(true);
    try {
      const tpl = templates.find((t) => t.id === templateId);
      const r = await createWorld(tpl?.name ?? 'New Game', '', { templateId });
      if (!r.ok || !r.world) { flash('err', `Template start failed: ${r.reason}`); return; }
      await loadWorld(r.world.id);
      const w = await listWorlds();
      if (w.ok) setMyWorlds(w.worlds);
      flash('ok', `Started from “${tpl?.name ?? templateId}”.`);
    } catch {
      flash('err', 'Template start failed — could not reach the backend.');
    } finally {
      setBusy(false);
    }
  }, [templates, loadWorld]);

  const newWorld = useCallback(() => {
    setCurrentWorldId(null);
    setWorldName('Untitled Game');
    setWorldDescription('');
    setUniverseType('fantasy');
    setSelected([]);
    setRules([]);
    setActiveConfigId(null);
    setWorldStatus(null);
    setValidation(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the Foundry catalog…
      </div>
    );
  }
  if (catalogError || !categories) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
        <p className="mt-2 text-sm text-slate-300">{catalogError ?? 'Catalog unavailable.'}</p>
      </div>
    );
  }

  const activeSystem = activeConfigId ? systemsById.get(activeConfigId) : null;
  const activeConfig = activeConfigId ? selected.find((s) => s.id === activeConfigId)?.config ?? {} : {};
  const canPublish = selected.length > 0 && (validation?.ok ?? false);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/60 px-3 py-2">
        <input
          value={worldName}
          onChange={(e) => setWorldName(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm font-medium text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          placeholder="Game name"
        />
        <select
          value={universeType}
          onChange={(e) => setUniverseType(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {UNIVERSE_TYPES.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>

        {/* Validation badge */}
        {validation && (
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              validation.ok
                ? 'border border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                : 'border border-red-600/40 bg-red-500/10 text-red-300'
            }`}
            title={(validation.ok ? validation.warnings : validation.errors).join('\n')}
          >
            {validation.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {validation.ok
              ? `valid${validation.warnings.length ? ` · ${validation.warnings.length} note(s)` : ''}`
              : `${validation.errors.length} issue(s)`}
          </span>
        )}
        {worldStatus === 'published' && (
          <span className="flex items-center gap-1 rounded-full border border-sky-600/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
            <Circle className="h-2 w-2 fill-sky-400" /> live
          </span>
        )}

        {templates.length > 0 && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) createFromTemplate(e.target.value); }}
            disabled={busy}
            aria-label="Start from a template"
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
          >
            <option value="">Start from template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.systemCount})</option>
            ))}
          </select>
        )}
        <button
          type="button" onClick={newWorld} disabled={busy}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
        >
          New
        </button>
        <button
          type="button" onClick={save} disabled={busy}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-100 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
        <button
          type="button" onClick={doPreview} disabled={busy || !currentWorldId || selected.length === 0}
          title={!currentWorldId ? 'Save first to preview' : selected.length === 0 ? 'Add a system to preview' : 'Render this world in 3D'}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-100 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
        >
          <Eye className="h-3 w-3" /> Preview
        </button>
        {worldStatus === 'published' ? (
          <button
            type="button" onClick={doUnpublish} disabled={busy}
            className="flex items-center gap-1 rounded-md border border-amber-700/50 bg-amber-900/30 px-2.5 py-1 text-xs text-amber-200 hover:bg-amber-900/50 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40"
          >
            <Undo2 className="h-3 w-3" /> Unpublish
          </button>
        ) : (
          <button
            type="button" onClick={doPublish} disabled={busy || !canPublish}
            title={!canPublish ? 'Add at least one system and resolve validation issues' : 'Publish as a live world'}
            className="flex items-center gap-1 rounded-md border border-sky-600/50 bg-sky-600/20 px-2.5 py-1 text-xs font-medium text-sky-200 hover:bg-sky-600/40 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
          >
            <Rocket className="h-3 w-3" /> Publish
          </button>
        )}
      </div>

      {/* Notice */}
      {notice && (
        <div
          role="status"
          className={`px-3 py-1.5 text-xs ${
            notice.kind === 'ok' ? 'bg-emerald-950/50 text-emerald-200' : 'bg-red-950/50 text-red-200'
          }`}
        >
          {notice.msg}
        </div>
      )}

      {/* 3-pane body */}
      <div className="grid flex-1 grid-cols-[16rem_1fr_18rem] overflow-hidden">
        {/* Palette */}
        <aside className="overflow-hidden border-r border-slate-800 bg-slate-950/40">
          <ComponentPalette categories={categories} selectedIds={selectedIds} onAdd={addSystem} />
        </aside>

        {/* Canvas */}
        <main
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`overflow-y-auto p-4 transition-colors ${
            dragOver ? 'bg-sky-950/20' : 'bg-slate-950/20'
          }`}
        >
          {selected.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-500">
              <FileStack className="h-8 w-8 text-slate-700" />
              <p className="text-sm">Drag systems from the left, or click <span className="text-slate-300">+</span> to add them.</p>
              <p className="max-w-xs text-xs text-slate-600">
                Every system you add is configured per-world and travels with the lattice once published.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {validation && !validation.ok && (
                <div className="rounded-md border border-red-700/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                  <strong>Resolve before publishing:</strong>
                  <ul className="mt-1 list-disc pl-4">
                    {validation.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              {selected.map((s) => {
                const sys = systemsById.get(s.id);
                if (!sys) return null;
                const isActive = activeConfigId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border px-3 py-2 transition-colors ${
                      isActive ? 'border-sky-600/60 bg-sky-950/30' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveConfigId(isActive ? null : s.id)}
                        className="min-w-0 flex-1 text-left focus:outline-none"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-slate-100">{sys.displayName}</span>
                          {sys.status === 'stub' && (
                            <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-1 py-px text-[9px] font-medium text-amber-300">
                              soon
                            </span>
                          )}
                          <span className="rounded bg-slate-800 px-1 py-px text-[9px] text-slate-500">{sys.category}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSystem(s.id)}
                        aria-label={`Remove ${sys.displayName}`}
                        className="rounded p-1 text-slate-500 hover:bg-red-600/20 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Rules — natural-language game logic (Phase 6) */}
          {selected.length > 0 && (
            <FoundryRulesPanel
              foundryWorldId={currentWorldId}
              rules={rules}
              onRulesChange={setRules}
            />
          )}

          {/* My worlds strip */}
          {myWorlds.length > 0 && (
            <div className="mt-6 border-t border-slate-800 pt-3">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">My worlds</h3>
              <div className="flex flex-wrap gap-1.5">
                {myWorlds.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => loadWorld(w.id)}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      w.id === currentWorldId
                        ? 'border-sky-600/60 bg-sky-950/40 text-sky-200'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {w.status === 'published' && <Circle className="h-1.5 w-1.5 fill-sky-400 text-sky-400" />}
                    {w.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Config */}
        <aside className="overflow-hidden border-l border-slate-800 bg-slate-950/40">
          {activeSystem ? (
            <ConfigPanel
              system={activeSystem}
              config={activeConfig}
              onChange={(field, value) => updateConfig(activeSystem.id, field, value)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-slate-600">
              <X className="h-5 w-5" />
              <p className="text-xs">Select a system on the canvas to configure it.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Live 3D preview — full-screen overlay (Phase 5) */}
      {showPreview && currentWorldId && (
        <FoundryPreview
          foundryWorldId={currentWorldId}
          worldName={worldName}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

export default FoundryCanvas;
