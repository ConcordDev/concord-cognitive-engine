'use client';

// CraftingWorkbench — surfaces the crafting feature-parity backlog as a
// single tactile workbench: a 3x3 visual assembly grid, recipe discovery /
// experimentation, a craft queue with batch craft-all, a "craftable now"
// filter, the quality/rarity tier ladder, a material gather planner, and
// recipe favorites + crafting history.
//
// Every value is real user input or computed from real backend state.
// All persistence is through the `crafting` domain macros via lensRun.

import { useCallback, useEffect, useState } from 'react';
import { lensRun, api } from '@/lib/api/client';
import {
  Grid3x3, Beaker, ListChecks, Filter, Gem, Map as MapIcon,
  Star, History, Loader2, Plus, Trash2, X, Hammer, Sparkles,
  CheckCircle2, AlertTriangle, RefreshCw,
} from 'lucide-react';

// ── shared types ────────────────────────────────────────────────────

type BacklogTab =
  | 'grid' | 'discovery' | 'queue' | 'craftable' | 'quality' | 'gather' | 'log';

interface GridCell { slot: number; material: string; quantity: number }
interface SavedGrid {
  id: string; name: string; cells: GridCell[];
  output: { name: string; type: string };
  createdAt: string; updatedAt: string;
}
interface Discovery {
  id: string; fingerprint: string;
  materials: { material: string; quantity: number }[];
  outline: { suggestedType: string; suggestedName: string; complexity: number; estimatedXp: number };
  attempts: number; discoveredAt: string; lastAttemptAt: string;
}
interface QueueJob {
  id: string; recipeId: string; recipeName: string;
  quantity: number; skillLevel: number; status: string; enqueuedAt: string;
}
interface CraftUnit { tier: string; label: string; multiplier: number }
interface HistoryEntry {
  id: string; recipeId: string; recipeName: string; quantity: number;
  units: CraftUnit[]; bestTier: CraftUnit; craftedAt: string;
}
interface QualityTier { tier: string; min: number; label: string; multiplier: number }
interface RecipeInput { id: string; title: string; requirements: { material: string; quantity: number }[] }
interface InventoryItem { item_name: string; quantity: number }
interface CraftableRow {
  id: string; title: string; craftable: boolean;
  missing: { material: string; need: number; have: number; short: number }[];
  requirementCount: number;
}
interface GatherLine {
  material: string; need: number; have: number; stillNeed: number;
  satisfied: boolean; nodeHint: string | null;
}

function activeWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}

const TIER_COLOR: Record<string, string> = {
  crude: 'text-zinc-400 border-zinc-600',
  standard: 'text-sky-300 border-sky-600/50',
  fine: 'text-emerald-300 border-emerald-600/50',
  exquisite: 'text-violet-300 border-violet-600/50',
  masterwork: 'text-amber-300 border-amber-500/60',
};

// ── workbench shell ─────────────────────────────────────────────────

export function CraftingWorkbench() {
  const [tab, setTab] = useState<BacklogTab>('grid');

  const TABS: { id: BacklogTab; label: string; icon: React.ReactNode }[] = [
    { id: 'grid',      label: 'Assembly Grid', icon: <Grid3x3 className="w-3.5 h-3.5" /> },
    { id: 'discovery', label: 'Discovery',     icon: <Beaker className="w-3.5 h-3.5" /> },
    { id: 'queue',     label: 'Craft Queue',   icon: <ListChecks className="w-3.5 h-3.5" /> },
    { id: 'craftable', label: 'Craftable Now', icon: <Filter className="w-3.5 h-3.5" /> },
    { id: 'quality',   label: 'Quality Tiers', icon: <Gem className="w-3.5 h-3.5" /> },
    { id: 'gather',    label: 'Gather Plan',   icon: <MapIcon className="w-3.5 h-3.5" /> },
    { id: 'log',       label: 'Favorites & Log', icon: <History className="w-3.5 h-3.5" /> },
  ];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Hammer className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-semibold">Workbench</h2>
        <span className="text-[10px] text-white/30">tactile crafting tools</span>
      </div>
      <nav className="flex gap-1.5 mb-4 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              tab === t.id
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                : 'bg-white/5 border border-transparent hover:bg-white/10 text-white/60'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </nav>
      {tab === 'grid'      && <AssemblyGridPanel />}
      {tab === 'discovery' && <DiscoveryPanel />}
      {tab === 'queue'     && <QueuePanel />}
      {tab === 'craftable' && <CraftableNowPanel />}
      {tab === 'quality'   && <QualityTiersPanel />}
      {tab === 'gather'    && <GatherPlanPanel />}
      {tab === 'log'       && <FavoritesLogPanel />}
    </section>
  );
}

// ── 1. Visual crafting grid / drag-drop assembly ────────────────────

function AssemblyGridPanel() {
  const [grids, setGrids] = useState<SavedGrid[]>([]);
  const [loading, setLoading] = useState(false);
  const [cells, setCells] = useState<(GridCell | null)[]>(Array(9).fill(null));
  const [name, setName] = useState('');
  const [outputType, setOutputType] = useState('blueprint');
  const [palette, setPalette] = useState('');
  const [paletteQty, setPaletteQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragMat, setDragMat] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('crafting', 'grid_list', {});
    if (r.data?.ok) setGrids((r.data.result as { grids: SavedGrid[] }).grids);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function dropInto(slot: number) {
    if (!dragMat) return;
    setCells((prev) => {
      const next = prev.slice();
      next[slot] = { slot, material: dragMat, quantity: paletteQty };
      return next;
    });
    setDragMat(null);
  }
  function clickInto(slot: number) {
    if (!palette.trim()) { setErr('Type a material in the palette first'); return; }
    setErr(null);
    setCells((prev) => {
      const next = prev.slice();
      next[slot] = { slot, material: palette.trim(), quantity: paletteQty };
      return next;
    });
  }
  function clearCell(slot: number) {
    setCells((prev) => { const n = prev.slice(); n[slot] = null; return n; });
  }

  async function save() {
    const filled = cells.filter((c): c is GridCell => !!c);
    if (!name.trim()) { setErr('Name the pattern'); return; }
    if (filled.length === 0) { setErr('Place at least one material'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('crafting', 'grid_save', {
      name: name.trim(),
      cells: filled,
      output: { name: name.trim(), type: outputType },
    });
    setBusy(false);
    if (r.data?.ok) {
      setName(''); setCells(Array(9).fill(null));
      await load();
    } else {
      setErr(r.data?.error ?? 'Save failed');
    }
  }

  async function del(id: string) {
    const r = await lensRun('crafting', 'grid_delete', { id });
    if (r.data?.ok) await load();
  }

  function loadGrid(g: SavedGrid) {
    const next: (GridCell | null)[] = Array(9).fill(null);
    for (const c of g.cells) next[c.slot] = c;
    setCells(next); setName(g.name); setOutputType(g.output.type);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <p className="text-[11px] text-white/50 mb-2">
          Drag a material onto a slot, or type one and click a slot. The 3×3
          pattern persists as a reusable assembly recipe.
        </p>
        <div className="flex items-end gap-2 mb-3">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Material</label>
            <input
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
              placeholder="iron ingot"
              draggable={!!palette.trim()}
              onDragStart={() => setDragMat(palette.trim())}
              className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none focus:border-amber-500/40"
            />
          </div>
          <div className="w-20">
            <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Qty</label>
            <input
              type="number" min={1}
              value={paletteQty}
              onChange={(e) => setPaletteQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 w-48 mb-3">
          {cells.map((c, i) => (
            <div
              key={i}
              onClick={() => (c ? clearCell(i) : clickInto(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropInto(i)}
              className={`aspect-square rounded-md border flex flex-col items-center justify-center text-center cursor-pointer p-1 ${
                c
                  ? 'bg-amber-500/15 border-amber-500/40'
                  : 'bg-white/5 border-dashed border-white/15 hover:border-white/30'
              }`}
              title={c ? 'Click to clear' : 'Click or drop to fill'}
            >
              {c ? (
                <>
                  <span className="text-[9px] leading-tight text-amber-200 break-words">{c.material}</span>
                  <span className="text-[10px] font-mono text-white/60">×{c.quantity}</span>
                </>
              ) : (
                <span className="text-[10px] text-white/20">{i + 1}</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Pattern name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Iron Sword"
              className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none focus:border-amber-500/40"
            />
          </div>
          <select
            value={outputType}
            onChange={(e) => setOutputType(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
          >
            <option value="blueprint">Blueprint</option>
            <option value="food_recipe">Food</option>
            <option value="spell_recipe">Spell</option>
            <option value="fighting_style_recipe">Style</option>
          </select>
          <button
            onClick={save}
            disabled={busy}
            className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-md text-xs font-semibold hover:bg-amber-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
        {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-white/40">Saved patterns ({grids.length})</h3>
          <button onClick={load} className="text-white/40 hover:text-white" aria-label="Refresh">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-white/50 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : grids.length === 0 ? (
          <p className="text-white/40 text-xs">No saved patterns yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {grids.map((g) => (
              <li key={g.id} className="bg-white/5 border border-white/10 rounded-md p-2 flex items-center justify-between gap-2">
                <button onClick={() => loadGrid(g)} className="text-left min-w-0 flex-1" title="Load into grid">
                  <p className="text-xs font-semibold truncate">{g.name}</p>
                  <p className="text-[10px] text-white/40">{g.cells.length} cell{g.cells.length === 1 ? '' : 's'} · {g.output.type.replace(/_/g, ' ')}</p>
                </button>
                <button onClick={() => del(g.id)} className="text-rose-300/60 hover:text-rose-300" aria-label="Delete pattern">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── 2. Recipe discovery / experimentation ───────────────────────────

function DiscoveryPanel() {
  const [mats, setMats] = useState<{ material: string; quantity: number }[]>([
    { material: '', quantity: 1 }, { material: '', quantity: 1 },
  ]);
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ discovered: boolean; recipe: Discovery } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('crafting', 'discovery_list', {});
    if (r.data?.ok) setDiscoveries((r.data.result as { discoveries: Discovery[] }).discoveries);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function setMat(i: number, patch: Partial<{ material: string; quantity: number }>) {
    setMats((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  async function combine() {
    const clean = mats.filter((m) => m.material.trim());
    if (clean.length < 2) { setErr('Add at least 2 materials to experiment'); return; }
    setBusy(true); setErr(null); setResult(null);
    const r = await lensRun('crafting', 'discovery_combine', { materials: clean });
    setBusy(false);
    if (r.data?.ok) {
      setResult(r.data.result as { discovered: boolean; recipe: Discovery });
      await load();
    } else {
      setErr(r.data?.error ?? 'Experiment failed');
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <p className="text-[11px] text-white/50 mb-2">
          Combine materials to experiment. A new combination is recorded as a
          discovery; repeating it raises its attempt count.
        </p>
        <div className="space-y-1.5 mb-2">
          {mats.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={m.material}
                onChange={(e) => setMat(i, { material: e.target.value })}
                placeholder={`Material ${i + 1}`}
                className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none focus:border-amber-500/40"
              />
              <input
                type="number" min={1}
                value={m.quantity}
                onChange={(e) => setMat(i, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                className="w-16 bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
              />
              {mats.length > 2 && (
                <button
                  onClick={() => setMats((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-rose-300/60 hover:text-rose-300" aria-label="Remove material"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMats((prev) => [...prev, { material: '', quantity: 1 }])}
            className="px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded inline-flex items-center gap-1 hover:bg-white/10"
          >
            <Plus className="w-3 h-3" /> Material
          </button>
          <button
            onClick={combine}
            disabled={busy}
            className="px-3 py-1 text-[11px] font-semibold bg-violet-500/20 border border-violet-500/40 rounded hover:bg-violet-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Beaker className="w-3 h-3" />}
            Experiment
          </button>
        </div>
        {err && <p className="text-[11px] text-red-400 mt-2">{err}</p>}
        {result && (
          <div className={`mt-3 rounded-md border p-2.5 text-xs ${
            result.discovered ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/5'
          }`}>
            <p className={`font-semibold inline-flex items-center gap-1 ${result.discovered ? 'text-emerald-300' : 'text-white/60'}`}>
              {result.discovered ? <Sparkles className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {result.discovered ? 'New discovery!' : `Already known · ${result.recipe.attempts} attempts`}
            </p>
            <p className="text-white/70 mt-1">{result.recipe.outline.suggestedName}</p>
            <p className="text-white/40 mt-0.5">
              Suggested type: {result.recipe.outline.suggestedType.replace(/_/g, ' ')} ·
              complexity {result.recipe.outline.complexity} ·
              est. {result.recipe.outline.estimatedXp} XP
            </p>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-white/40 mb-2">Discovered ({discoveries.length})</h3>
        {loading ? (
          <div className="flex items-center gap-2 text-white/50 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : discoveries.length === 0 ? (
          <p className="text-white/40 text-xs">No discoveries yet.</p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {discoveries.map((d) => (
              <li key={d.id} className="bg-white/5 border border-white/10 rounded-md p-2">
                <p className="text-xs font-semibold truncate">{d.outline.suggestedName}</p>
                <p className="text-[10px] text-white/40">
                  {d.outline.suggestedType.replace(/_/g, ' ')} · {d.attempts} attempt{d.attempts === 1 ? '' : 's'} ·
                  {' '}{d.outline.estimatedXp} XP
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── 3. Craft queue + batch crafting ─────────────────────────────────

function QueuePanel() {
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [recipes, setRecipes] = useState<{ id: string; title: string }[]>([]);
  const [recipeId, setRecipeId] = useState('');
  const [recipeName, setRecipeName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [skillLevel, setSkillLevel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [crafted, setCrafted] = useState<HistoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('crafting', 'queue_list', {});
    if (r.data?.ok) setQueue((r.data.result as { queue: QueueJob[] }).queue);
    try {
      const rr = await api.get('/api/crafting/recipes');
      const list = (rr.data?.recipes ?? []) as { id: string; title: string }[];
      setRecipes(list);
      if (list.length > 0 && !recipeId) {
        setRecipeId(list[0].id); setRecipeName(list[0].title);
      }
    } catch { /* recipes optional — manual entry still works */ }
    setLoading(false);
  }, [recipeId]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!recipeId.trim() || !recipeName.trim()) { setErr('Pick or name a recipe'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('crafting', 'queue_add', {
      recipeId: recipeId.trim(), recipeName: recipeName.trim(), quantity, skillLevel,
    });
    setBusy(false);
    if (r.data?.ok) await load();
    else setErr(r.data?.error ?? 'Enqueue failed');
  }
  async function remove(id: string) {
    const r = await lensRun('crafting', 'queue_remove', { id });
    if (r.data?.ok) await load();
  }
  async function craftAll() {
    setBusy(true); setErr(null); setCrafted(null);
    const r = await lensRun('crafting', 'queue_craft_all', {});
    setBusy(false);
    if (r.data?.ok) {
      setCrafted((r.data.result as { crafted: HistoryEntry[] }).crafted);
      await load();
    } else {
      setErr(r.data?.error ?? 'Batch craft failed');
    }
  }

  const pending = queue.filter((j) => j.status === 'pending');
  const totalUnits = pending.reduce((s, j) => s + j.quantity, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Recipe</label>
          {recipes.length > 0 ? (
            <select
              value={recipeId}
              onChange={(e) => {
                setRecipeId(e.target.value);
                setRecipeName(recipes.find((x) => x.id === e.target.value)?.title ?? '');
              }}
              className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
            >
              {recipes.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          ) : (
            <input
              value={recipeName}
              onChange={(e) => { setRecipeName(e.target.value); setRecipeId(e.target.value); }}
              placeholder="Recipe name"
              className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
            />
          )}
        </div>
        <div className="w-20">
          <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Qty</label>
          <input
            type="number" min={1} max={99}
            value={quantity}
            onChange={(e) => setQuantity(Math.min(99, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
          />
        </div>
        <div className="w-20">
          <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Skill</label>
          <input
            type="number" min={0}
            value={skillLevel}
            onChange={(e) => setSkillLevel(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
          />
        </div>
        <button
          onClick={add}
          disabled={busy}
          className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-md text-xs font-semibold hover:bg-amber-500/30 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Queue
        </button>
      </div>
      {err && <p className="text-[11px] text-red-400">{err}</p>}

      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-white/40">
          Queue · {pending.length} job{pending.length === 1 ? '' : 's'} · {totalUnits} unit{totalUnits === 1 ? '' : 's'}
        </h3>
        <button
          onClick={craftAll}
          disabled={busy || pending.length === 0}
          className="px-3 py-1 text-[11px] font-semibold bg-emerald-500/20 border border-emerald-500/40 rounded hover:bg-emerald-500/30 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hammer className="w-3 h-3" />}
          Craft All
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : pending.length === 0 ? (
        <p className="text-white/40 text-xs">Queue empty — add a craft job above.</p>
      ) : (
        <ul className="space-y-1.5">
          {pending.map((j) => (
            <li key={j.id} className="bg-white/5 border border-white/10 rounded-md p-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{j.recipeName}</p>
                <p className="text-[10px] text-white/40">×{j.quantity} · skill {j.skillLevel}</p>
              </div>
              <button onClick={() => remove(j.id)} className="text-rose-300/60 hover:text-rose-300" aria-label="Remove job">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {crafted && crafted.length > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5">
          <p className="text-xs font-semibold text-emerald-300 inline-flex items-center gap-1 mb-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Batch complete
          </p>
          <ul className="space-y-1">
            {crafted.map((c) => (
              <li key={c.id} className="text-[11px] text-white/70 flex items-center justify-between">
                <span>{c.recipeName} ×{c.quantity}</span>
                <span className={`font-mono border rounded px-1 ${TIER_COLOR[c.bestTier.tier] ?? 'text-white/50 border-white/20'}`}>
                  best: {c.bestTier.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── 4. "Craftable now" filter ───────────────────────────────────────

function CraftableNowPanel() {
  const [rows, setRows] = useState<CraftableRow[]>([]);
  const [counts, setCounts] = useState<{ craftable: number; blocked: number }>({ craftable: 0, blocked: 0 });
  const [loading, setLoading] = useState(false);
  const [onlyCraftable, setOnlyCraftable] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [recipeRes, invRes] = await Promise.all([
        api.get('/api/crafting/recipes'),
        api.get('/api/player-inventory', { params: { worldId: activeWorldId() } }),
      ]);
      const recipes: RecipeInput[] = ((recipeRes.data?.recipes ?? []) as Array<{ id: string; title: string; data?: unknown }>)
        .map((r) => {
          const data = typeof r.data === 'string' ? safeJson(r.data) : r.data;
          const spec = (data as { spec?: { resource_requirements?: { resource_type: string; quantity: number }[] } })?.spec;
          const reqs = (spec?.resource_requirements ?? []).map((x) => ({ material: x.resource_type, quantity: x.quantity }));
          return { id: r.id, title: r.title, requirements: reqs };
        });
      const inventory: InventoryItem[] = ((invRes.data?.items ?? []) as Array<{ item_name: string; quantity?: number }>)
        .map((i) => ({ item_name: i.item_name, quantity: i.quantity ?? 1 }));
      const r = await lensRun('crafting', 'craftable_now', { recipes, inventory });
      if (r.data?.ok) {
        const res = r.data.result as { recipes: CraftableRow[]; craftableCount: number; blockedCount: number };
        setRows(res.recipes);
        setCounts({ craftable: res.craftableCount, blocked: res.blockedCount });
      } else {
        setErr(r.data?.error ?? 'Evaluation failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = onlyCraftable ? rows.filter((r) => r.craftable) : rows;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-white/50">
          Live check of every recipe against this world&apos;s inventory.{' '}
          <span className="text-emerald-300">{counts.craftable} craftable</span> ·{' '}
          <span className="text-rose-300">{counts.blocked} blocked</span>
        </p>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-white/60 inline-flex items-center gap-1">
            <input type="checkbox" checked={onlyCraftable} onChange={(e) => setOnlyCraftable(e.target.checked)} />
            Craftable only
          </label>
          <button onClick={load} className="text-white/40 hover:text-white" aria-label="Refresh">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>
      {err && <p className="text-[11px] text-red-400 mb-2">{err}</p>}
      {loading ? (
        <div className="flex items-center gap-2 text-white/50 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Evaluating…</div>
      ) : shown.length === 0 ? (
        <p className="text-white/40 text-xs">{rows.length === 0 ? 'No recipes to evaluate yet.' : 'No matches.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((r) => (
            <li
              key={r.id}
              className={`rounded-md border p-2 ${
                r.craftable ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold truncate inline-flex items-center gap-1">
                  {r.craftable
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    : <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
                  {r.title}
                </p>
                <span className="text-[10px] text-white/40">{r.requirementCount} req</span>
              </div>
              {r.missing.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {r.missing.map((m) => (
                    <span key={m.material} className="text-[10px] bg-rose-500/10 border border-rose-500/30 rounded px-1.5 py-0.5 text-rose-200">
                      {m.material} {m.have}/{m.need} (short {m.short})
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 5. Quality / rarity tiers ───────────────────────────────────────

function QualityTiersPanel() {
  const [tiers, setTiers] = useState<QualityTier[]>([]);
  const [skillLevel, setSkillLevel] = useState(10);
  const [focus, setFocus] = useState(0.3);
  const [roll, setRoll] = useState<{ roll: number; tier: string; label: string; multiplier: number; crit: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await lensRun('crafting', 'quality_tiers', {});
      if (r.data?.ok) setTiers((r.data.result as { tiers: QualityTier[] }).tiers);
    })();
  }, []);

  async function critCraft() {
    setBusy(true);
    const r = await lensRun('crafting', 'quality_roll', { skillLevel, focus });
    setBusy(false);
    if (r.data?.ok) setRoll(r.data.result as typeof roll);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-white/40 mb-2">Rarity ladder</h3>
        <ul className="space-y-1.5">
          {tiers.map((t) => (
            <li key={t.tier} className={`rounded-md border p-2 flex items-center justify-between ${TIER_COLOR[t.tier] ?? 'border-white/10 text-white/60'} bg-white/5`}>
              <div>
                <p className="text-xs font-semibold">{t.label}</p>
                <p className="text-[10px] text-white/40">roll ≥ {t.min.toFixed(2)}</p>
              </div>
              <span className="text-xs font-mono">×{t.multiplier}</span>
            </li>
          ))}
          {tiers.length === 0 && <p className="text-white/40 text-xs">No tiers loaded.</p>}
        </ul>
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-wide text-white/40 mb-2">Crit-craft simulator</h3>
        <p className="text-[11px] text-white/50 mb-2">
          Higher skill and focus bias the roll toward higher-grade output.
        </p>
        <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Skill level: {skillLevel}</label>
        <input
          type="range" min={0} max={60} value={skillLevel}
          onChange={(e) => setSkillLevel(parseInt(e.target.value, 10))}
          className="w-full mb-3"
        />
        <label className="block text-[10px] uppercase tracking-wide text-white/40 mb-1">Focus: {Math.round(focus * 100)}%</label>
        <input
          type="range" min={0} max={100} value={Math.round(focus * 100)}
          onChange={(e) => setFocus(parseInt(e.target.value, 10) / 100)}
          className="w-full mb-3"
        />
        <button
          onClick={critCraft}
          disabled={busy}
          className="px-3 py-1.5 bg-violet-500/20 border border-violet-500/40 rounded-md text-xs font-semibold hover:bg-violet-500/30 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gem className="w-3.5 h-3.5" />}
          Roll quality
        </button>
        {roll && (
          <div className={`mt-3 rounded-md border p-3 ${TIER_COLOR[roll.tier] ?? 'border-white/10'} bg-white/5`}>
            <p className="text-sm font-bold inline-flex items-center gap-1.5">
              {roll.crit && <Sparkles className="w-4 h-4 text-amber-300" />}
              {roll.label}
              {roll.crit && <span className="text-[10px] text-amber-300 uppercase">crit!</span>}
            </p>
            <p className="text-[11px] text-white/50 mt-1">
              roll {roll.roll.toFixed(3)} · output multiplier ×{roll.multiplier}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 6. Material gathering integration ───────────────────────────────

function GatherPlanPanel() {
  const [lines, setLines] = useState<GatherLine[]>([]);
  const [summary, setSummary] = useState<{ materials: number; outstanding: number; total: number; satisfied: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [recipeRes, invRes, nodeRes] = await Promise.all([
        api.get('/api/crafting/recipes'),
        api.get('/api/player-inventory', { params: { worldId: activeWorldId() } }),
        api.get(`/api/worlds/${encodeURIComponent(activeWorldId())}/nodes`).catch(() => ({ data: { nodes: [] } })),
      ]);
      const recipes: RecipeInput[] = ((recipeRes.data?.recipes ?? []) as Array<{ id: string; title: string; data?: unknown }>)
        .map((r) => {
          const data = typeof r.data === 'string' ? safeJson(r.data) : r.data;
          const spec = (data as { spec?: { resource_requirements?: { resource_type: string; quantity: number }[] } })?.spec;
          const reqs = (spec?.resource_requirements ?? []).map((x) => ({ material: x.resource_type, quantity: x.quantity }));
          return { id: r.id, title: r.title, requirements: reqs };
        })
        .filter((r) => r.requirements.length > 0);
      const inventory: InventoryItem[] = ((invRes.data?.items ?? []) as Array<{ item_name: string; quantity?: number }>)
        .map((i) => ({ item_name: i.item_name, quantity: i.quantity ?? 1 }));
      // Build node hints from real world gather nodes — resource_type → node_type.
      const nodeHints: Record<string, string> = {};
      for (const n of (nodeRes.data?.nodes ?? []) as Array<{ resource_type?: string; node_type?: string }>) {
        const res = String(n.resource_type || '').trim().toLowerCase();
        if (res && n.node_type) nodeHints[res] = String(n.node_type);
      }
      if (recipes.length === 0) {
        setLines([]); setSummary(null); setErr(null);
        setLoading(false);
        return;
      }
      const r = await lensRun('crafting', 'gather_plan', { recipes, inventory, nodeHints });
      if (r.data?.ok) {
        const res = r.data.result as {
          lines: GatherLine[]; materialCount: number; outstandingCount: number;
          totalUnitsToGather: number; fullySatisfied: boolean;
        };
        setLines(res.lines);
        setSummary({
          materials: res.materialCount,
          outstanding: res.outstandingCount,
          total: res.totalUnitsToGather,
          satisfied: res.fullySatisfied,
        });
      } else {
        setErr(r.data?.error ?? 'Plan failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-white/50">
          Consolidated gather list across every recipe with resource needs,
          netted against current inventory.
        </p>
        <button onClick={load} className="text-white/40 hover:text-white" aria-label="Refresh">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
      {err && <p className="text-[11px] text-red-400 mb-2">{err}</p>}
      {summary && (
        <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
          <span className="bg-white/5 border border-white/10 rounded px-2 py-0.5">{summary.materials} materials</span>
          <span className="bg-rose-500/10 border border-rose-500/30 rounded px-2 py-0.5 text-rose-200">{summary.outstanding} outstanding</span>
          <span className="bg-white/5 border border-white/10 rounded px-2 py-0.5">{summary.total} units to gather</span>
          {summary.satisfied && (
            <span className="bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-0.5 text-emerald-200">All satisfied</span>
          )}
        </div>
      )}
      {loading ? (
        <div className="flex items-center gap-2 text-white/50 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Planning…</div>
      ) : lines.length === 0 ? (
        <p className="text-white/40 text-xs">No recipes with resource requirements to plan for.</p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((l) => (
            <li
              key={l.material}
              className={`rounded-md border p-2 flex items-center justify-between gap-2 ${
                l.satisfied ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/10'
              }`}
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{l.material}</p>
                <p className="text-[10px] text-white/40">
                  need {l.need} · have {l.have}
                  {l.nodeHint && <span className="text-cyan-300"> · gather at {l.nodeHint}</span>}
                </p>
              </div>
              <span className={`text-xs font-mono ${l.satisfied ? 'text-emerald-300' : 'text-rose-300'}`}>
                {l.satisfied ? 'ready' : `+${l.stillNeed}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 7. Recipe favorites + crafting history log ──────────────────────

function FavoritesLogPanel() {
  const [favorites, setFavorites] = useState<Array<{ recipeId: string; recipeName: string; recipeType: string; favoritedAt: string }>>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [tierDist, setTierDist] = useState<Record<string, number>>({});
  const [unitsCrafted, setUnitsCrafted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [favR, histR] = await Promise.all([
      lensRun('crafting', 'favorite_list', {}),
      lensRun('crafting', 'history_list', { limit: 50 }),
    ]);
    if (favR.data?.ok) setFavorites((favR.data.result as { favorites: typeof favorites }).favorites);
    if (histR.data?.ok) {
      const res = histR.data.result as { history: HistoryEntry[]; tierDistribution: Record<string, number>; unitsCrafted: number };
      setHistory(res.history);
      setTierDist(res.tierDistribution);
      setUnitsCrafted(res.unitsCrafted);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function unfavorite(recipeId: string) {
    const r = await lensRun('crafting', 'favorite_toggle', { recipeId });
    if (r.data?.ok) await load();
  }
  async function clearLog() {
    setBusy(true);
    const r = await lensRun('crafting', 'history_clear', {});
    setBusy(false);
    if (r.data?.ok) await load();
  }

  const tierKeys = Object.keys(tierDist);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-white/40 mb-2 inline-flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-300" /> Favorites ({favorites.length})
        </h3>
        {loading ? (
          <div className="flex items-center gap-2 text-white/50 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : favorites.length === 0 ? (
          <p className="text-white/40 text-xs">No favorites yet. Pin a recipe to keep it close.</p>
        ) : (
          <ul className="space-y-1.5">
            {favorites.map((f) => (
              <li key={f.recipeId} className="bg-white/5 border border-white/10 rounded-md p-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{f.recipeName}</p>
                  {f.recipeType && <p className="text-[10px] text-white/40">{f.recipeType.replace(/_/g, ' ')}</p>}
                </div>
                <button onClick={() => unfavorite(f.recipeId)} className="text-amber-300 hover:text-amber-200" aria-label="Unfavorite">
                  <Star className="w-3.5 h-3.5 fill-current" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide text-white/40 inline-flex items-center gap-1">
            <History className="w-3.5 h-3.5" /> History ({history.length})
          </h3>
          {history.length > 0 && (
            <button
              onClick={clearLog}
              disabled={busy}
              className="text-[10px] text-rose-300/70 hover:text-rose-300 inline-flex items-center gap-1 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Clear
            </button>
          )}
        </div>
        {tierKeys.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 text-[10px]">
            <span className="text-white/40">{unitsCrafted} units:</span>
            {tierKeys.map((k) => (
              <span key={k} className={`border rounded px-1.5 py-0.5 ${TIER_COLOR[k] ?? 'text-white/50 border-white/20'}`}>
                {k} {tierDist[k]}
              </span>
            ))}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 text-white/50 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : history.length === 0 ? (
          <p className="text-white/40 text-xs">No crafting history yet. Run a batch craft from the queue.</p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {history.map((h) => (
              <li key={h.id} className="bg-white/5 border border-white/10 rounded-md p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold truncate">{h.recipeName} ×{h.quantity}</p>
                  <span className={`text-[10px] font-mono border rounded px-1 ${TIER_COLOR[h.bestTier.tier] ?? 'text-white/50 border-white/20'}`}>
                    {h.bestTier.label}
                  </span>
                </div>
                <p className="text-[10px] text-white/40 mt-0.5">
                  {new Date(h.craftedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}
