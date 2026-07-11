'use client';

/**
 * DraftEditor — the visual world-authoring surface for a single draft.
 *
 * Wires the full server domain: scene-canvas prop/spawn/zone/npc
 * placement, faction authoring, biome + rule-modulator editing, biome
 * preview, publish/privacy, playtest readiness, and delete. Every panel
 * here is backed by a `world-creator.*` macro.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { lensRun } from '@/lib/api/client';
import { SceneCanvas, type SceneTool } from './SceneCanvas';
import { BiomePreview } from './BiomePreview';

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

const PROP_KINDS = ['tree', 'rock', 'building', 'campfire', 'well', 'ruin', 'lamp', 'bridge', 'statue', 'fence', 'crystal', 'altar'];
const ZONE_KINDS = ['safe', 'hazard', 'social', 'combat', 'quest', 'neutral'];
const NPC_ARCHETYPES = ['warrior', 'scholar', 'trader', 'mystic', 'guard', 'healer', 'hunter', 'wanderer'];
const RULE_KEYS = ['combatLethality', 'refusalSensitivity', 'questDensity', 'weatherIntensity'] as const;
const RULE_LABEL: Record<string, string> = {
  combatLethality: 'Combat lethality', refusalSensitivity: 'Refusal sensitivity',
  questDensity: 'Quest density', weatherIntensity: 'Weather intensity',
};

interface Draft {
  id: string; name: string; description: string; universeType: string;
  template: string | null; biome: string; rules: Record<string, number>;
  props: Array<{ id: string; kind: string; x: number; z: number; rotation: number; scale: number }>;
  spawnPoints: Array<{ id: string; name: string; x: number; z: number; isDefault: boolean }>;
  zones: Array<{ id: string; name: string; kind: string; x: number; z: number; radius: number }>;
  npcs: Array<{ id: string; name: string; archetype: string; x: number; z: number; factionId: string | null; level: number; backstory: string }>;
  factions: Array<{ id: string; name: string; ethos: string; color: string; stance: string }>;
  terrain: { seed: number; roughness: number; waterLevel: number };
  visibility: string;
  publishedWorldId: string | null;
}
interface Biome { id: string; label: string; palette?: string[]; }

export function DraftEditor({ draftId, onClose }: { draftId: string; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [biomes, setBiomes] = useState<Biome[]>([]);
  const [tool, setTool] = useState<SceneTool>('select');
  const [propKind, setPropKind] = useState('tree');
  const [zoneKind, setZoneKind] = useState('safe');
  const [zoneRadius, setZoneRadius] = useState(50);
  const [zoneName, setZoneName] = useState('');
  const [spawnName, setSpawnName] = useState('');
  const [npcArch, setNpcArch] = useState('warrior');
  const [selected, setSelected] = useState<{ kind: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'scene' | 'biome' | 'rules' | 'publish'>('scene');
  const [checkResult, setCheckResult] = useState<{ ready: boolean; issues: string[]; warnings: string[] } | null>(null);
  // Pending NPC placement: a click with the NPC tool active opens an inline
  // form (name/backstory/level) instead of committing immediately — mirrors
  // the FactionPanel's inline-form pattern rather than a browser prompt().
  const [pendingNpc, setPendingNpc] = useState<{ x: number; z: number } | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ draft: Draft }>('world-creator', 'draft-get', { id: draftId });
    if (r.data?.ok && r.data.result?.draft) setDraft(r.data.result.draft);
    else setErr(r.data?.error || 'draft not found');
  }, [draftId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    lensRun<{ biomes: Biome[] }>('world-creator', 'biomes', {}).then(r => {
      if (r.data?.ok && r.data.result?.biomes) setBiomes(r.data.result.biomes);
    });
  }, []);

  const run = useCallback(async (name: string, params: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    const r = await lensRun('world-creator', name, params);
    setBusy(false);
    if (!r.data?.ok) { setErr(r.data?.error || `${name} failed`); return false; }
    await refresh();
    return true;
  }, [refresh]);

  const onCanvasClick = useCallback(async (x: number, z: number) => {
    if (!draft) return;
    if (tool === 'prop') await run('prop-place', { draftId, kind: propKind, x, z });
    else if (tool === 'spawn') {
      const ok = await run('spawn-add', { draftId, name: spawnName, x, z });
      if (ok) setSpawnName('');
    } else if (tool === 'zone') {
      const ok = await run('zone-add', { draftId, kind: zoneKind, x, z, radius: zoneRadius, name: zoneName });
      if (ok) setZoneName('');
    } else if (tool === 'npc') {
      // opens the inline NpcPlacementForm below instead of window.prompt()
      setPendingNpc({ x, z });
    }
  }, [draft, tool, propKind, zoneKind, zoneRadius, zoneName, spawnName, draftId, run]);

  const placeNpc = useCallback(async (fields: { name: string; backstory: string; level: number }) => {
    if (!pendingNpc) return false;
    const ok = await run('npc-place', {
      draftId, name: fields.name, archetype: npcArch,
      backstory: fields.backstory, level: fields.level,
      x: pendingNpc.x, z: pendingNpc.z,
    });
    if (ok) setPendingNpc(null);
    return ok;
  }, [pendingNpc, npcArch, draftId, run]);

  // updateProp is the single write path for a prop's position/rotation/scale
  // (drag-move AND the inspector's rotate/scale fields both funnel through
  // it) — optimistic update immediately, then reconcile against the real
  // `prop-move` response: a rejected/failed write re-pulls the draft rather
  // than silently leaving the client's optimistic state disagreeing with
  // the server's, and a failure surfaces via `err` instead of vanishing.
  const updateProp = useCallback((id: string, patch: Partial<{ x: number; z: number; rotation: number; scale: number }>) => {
    setDraft(d => d ? { ...d, props: d.props.map(p => p.id === id ? { ...p, ...patch } : p) } : d);
    lensRun('world-creator', 'prop-move', { draftId, propId: id, ...patch }).then(r => {
      if (!r.data?.ok) { setErr(r.data?.error || 'failed to update prop'); refresh(); }
    });
  }, [draftId, refresh]);

  // Dragging fires onMove on every mousemove tick; dedupe against the last
  // committed cell so a single drag gesture doesn't fire a `prop-move`
  // network call per pixel.
  const lastMoveRef = useRef<{ id: string; x: number; z: number } | null>(null);
  const onMove = useCallback((_kind: 'prop', id: string, x: number, z: number) => {
    const last = lastMoveRef.current;
    if (last && last.id === id && last.x === x && last.z === z) return;
    lastMoveRef.current = { id, x, z };
    updateProp(id, { x, z });
  }, [updateProp]);

  const removeSelected = useCallback(async () => {
    if (!selected) return;
    const map: Record<string, [string, string]> = {
      prop: ['prop-remove', 'propId'], spawn: ['spawn-remove', 'spawnId'],
      zone: ['zone-remove', 'zoneId'], npc: ['npc-remove', 'npcId'],
    };
    const [macro, key] = map[selected.kind] || [];
    if (macro) { await run(macro, { draftId, [key]: selected.id }); setSelected(null); }
  }, [selected, draftId, run]);

  const runPlaytestCheck = useCallback(async () => {
    const r = await lensRun<{ ready: boolean; issues: string[]; warnings: string[]; worldPayload: Record<string, unknown> }>(
      'world-creator', 'playtest-check', { id: draftId });
    if (r.data?.ok && r.data.result) setCheckResult(r.data.result);
  }, [draftId]);

  const playtest = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ ready: boolean; issues: string[]; warnings: string[]; worldPayload: Record<string, unknown> }>(
      'world-creator', 'playtest-check', { id: draftId });
    if (!r.data?.ok || !r.data.result) { setBusy(false); setErr(r.data?.error || 'check failed'); return; }
    if (!r.data.result.ready) { setBusy(false); setCheckResult(r.data.result); return; }
    // mint the real world via /api/worlds and jump into it
    try {
      const res = await fetch('/api/worlds', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r.data.result.worldPayload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const worldId = data?.world?.id;
      if (worldId) {
        await lensRun('world-creator', 'draft-publish', { id: draftId, visibility: draft?.visibility || 'private', publishedWorldId: worldId });
        router.push(`/lenses/world?worldId=${encodeURIComponent(worldId)}`);
      } else router.push('/lenses/world');
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : 'failed to mint world');
    }
  }, [draftId, draft, router]);

  if (!draft) {
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-950 p-6 text-sm text-stone-400">
        {err ? <span className="text-red-300">{err}</span> : 'Loading draft…'}
        <button onClick={onClose} className="ml-3 text-amber-400 hover:underline">← back</button>
      </div>
    );
  }

  const selectedFaction = draft.factions.find(f => f.id === (selected?.kind === 'faction' ? selected.id : ''));
  const TOOLS: { id: SceneTool; label: string }[] = [
    { id: 'select', label: 'Select / move' }, { id: 'prop', label: 'Place prop' },
    { id: 'spawn', label: 'Spawn point' }, { id: 'zone', label: 'Zone' }, { id: 'npc', label: 'NPC' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-stone-100">{draft.name}</h2>
          <p className="text-xs text-stone-500">
            {draft.props.length} props · {draft.npcs.length} NPCs · {draft.zones.length} zones ·
            {' '}{draft.spawnPoints.length} spawns · {draft.factions.length} factions ·
            {' '}<span className="uppercase">{draft.visibility}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={playtest} disabled={busy}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
            ▶ Playtest
          </button>
          <button onClick={onClose} className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800">
            ← Drafts
          </button>
        </div>
      </div>

      {err && <div role="alert" className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{err}</div>}

      <div className="flex gap-1 border-b border-stone-800">
        {(['scene', 'biome', 'rules', 'publish'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm capitalize ${tab === t ? 'border-b-2 border-amber-500 text-amber-300' : 'text-stone-400 hover:text-stone-200'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'scene' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.map(t => (
                <button key={t.id} onClick={() => { setTool(t.id); setSelected(null); setPendingNpc(null); }}
                  className={`rounded px-2.5 py-1 text-xs ${tool === t.id ? 'bg-amber-600 text-stone-900' : 'border border-stone-700 text-stone-300 hover:bg-stone-800'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            {tool === 'prop' && (
              <select value={propKind} onChange={e => setPropKind(e.target.value)}
                className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200">
                {PROP_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
            {tool === 'zone' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input value={zoneName} onChange={e => setZoneName(e.target.value)}
                  placeholder="Zone name (optional)" aria-label="Zone name"
                  className="w-40 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100 placeholder:text-stone-600" />
                <select value={zoneKind} onChange={e => setZoneKind(e.target.value)}
                  className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200">
                  {ZONE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-stone-400">
                  Radius
                  <input type="number" min={5} max={250} step={5} value={zoneRadius}
                    aria-label="Zone radius in meters"
                    onChange={e => setZoneRadius(clampNum(Number(e.target.value), 5, 250))}
                    className="w-16 rounded border border-stone-700 bg-stone-900 px-1.5 py-1 text-stone-100" />
                  m
                </label>
              </div>
            )}
            {tool === 'spawn' && (
              <input value={spawnName} onChange={e => setSpawnName(e.target.value)}
                placeholder="Spawn name (optional)" aria-label="Spawn point name"
                className="w-40 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100 placeholder:text-stone-600" />
            )}
            {tool === 'npc' && (
              <select value={npcArch} onChange={e => setNpcArch(e.target.value)}
                className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200">
                {NPC_ARCHETYPES.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
            <SceneCanvas
              props={draft.props} spawns={draft.spawnPoints} zones={draft.zones} npcs={draft.npcs}
              tool={tool} selectedId={selected?.id || null}
              biomePalette={biomes.find(b => b.id === draft.biome)?.palette}
              onCanvasClick={onCanvasClick}
              onSelect={(kind, id) => setSelected({ kind, id })}
              onMove={onMove}
            />
            <p className="text-[11px] text-stone-500">
              {tool === 'select' ? 'Click an entity to select; drag a prop to move it.' : `Click the canvas to place a ${tool}.`}
            </p>
            {pendingNpc && (
              <NpcPlacementForm busy={busy} archetype={npcArch}
                onCancel={() => setPendingNpc(null)}
                onSubmit={placeNpc} />
            )}
          </div>

          {/* inspector */}
          <aside className="space-y-3">
            {selected ? (
              <div className="rounded-lg border border-amber-800/40 bg-amber-950/10 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">{selected.kind} selected</span>
                  <button onClick={removeSelected} disabled={busy}
                    className="rounded bg-red-700 px-2 py-0.5 text-[11px] text-white hover:bg-red-600 disabled:opacity-50">
                    Delete
                  </button>
                </div>
                <InspectorBody draft={draft} selected={selected} onUpdateProp={updateProp} />
              </div>
            ) : (
              <div className="rounded-lg border border-stone-800 bg-stone-950 p-3 text-xs text-stone-500">
                Nothing selected. Pick a tool to place entities, or use Select to inspect.
              </div>
            )}

            {/* faction authoring */}
            <FactionPanel draft={draft} busy={busy} run={run} draftId={draftId}
              selectedFaction={selectedFaction || null}
              onSelectFaction={id => setSelected({ kind: 'faction', id })} />
          </aside>
        </div>
      )}

      {tab === 'biome' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-300">Biome</label>
            <div className="grid grid-cols-2 gap-1.5">
              {biomes.map(b => (
                <button key={b.id} disabled={busy}
                  onClick={() => run('draft-update', { id: draftId, biome: b.id })}
                  className={`rounded border px-2.5 py-2 text-left text-xs ${draft.biome === b.id ? 'border-amber-500 bg-amber-950/20 text-amber-200' : 'border-stone-700 text-stone-300 hover:border-stone-500'}`}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <BiomePreview biome={draft.biome} weatherIntensity={draft.rules.weatherIntensity ?? 1} />
        </div>
      )}

      {tab === 'rules' && (
        <div className="max-w-xl space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-300">World name</label>
            <input value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              onBlur={e => run('draft-update', { id: draftId, name: e.target.value })}
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-300">Description</label>
            <textarea value={draft.description} rows={2}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              onBlur={e => run('draft-update', { id: draftId, description: e.target.value })}
              className="w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100" />
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-stone-300">Rule modulators</legend>
            {RULE_KEYS.map(k => (
              <div key={k} className="grid grid-cols-[150px_1fr_50px] items-center gap-3">
                <label className="text-sm text-stone-400">{RULE_LABEL[k]}</label>
                <input type="range" min={0.5} max={1.5} step={0.1}
                  value={draft.rules[k] ?? 1}
                  onChange={e => setDraft({ ...draft, rules: { ...draft.rules, [k]: Number(e.target.value) } })}
                  onMouseUp={() => run('draft-update', { id: draftId, rules: draft.rules })}
                  onTouchEnd={() => run('draft-update', { id: draftId, rules: draft.rules })}
                  className="w-full" />
                <span className="text-right text-xs tabular-nums text-stone-300">{(draft.rules[k] ?? 1).toFixed(1)}×</span>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-stone-300">Terrain</legend>
            {(['roughness', 'waterLevel'] as const).map(k => (
              <div key={k} className="grid grid-cols-[150px_1fr_50px] items-center gap-3">
                <label className="text-sm capitalize text-stone-400">{k}</label>
                <input type="range" min={0} max={1} step={0.05}
                  value={draft.terrain[k]}
                  onChange={e => setDraft({ ...draft, terrain: { ...draft.terrain, [k]: Number(e.target.value) } })}
                  onMouseUp={() => run('draft-update', { id: draftId, terrain: draft.terrain })}
                  onTouchEnd={() => run('draft-update', { id: draftId, terrain: draft.terrain })}
                  className="w-full" />
                <span className="text-right text-xs tabular-nums text-stone-300">{draft.terrain[k].toFixed(2)}</span>
              </div>
            ))}
          </fieldset>
        </div>
      )}

      {tab === 'publish' && (
        <div className="max-w-xl space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-300">Visibility</label>
            <div className="flex gap-2">
              {['private', 'unlisted', 'public'].map(v => (
                <button key={v} disabled={busy}
                  onClick={() => run('draft-publish', { id: draftId, visibility: v })}
                  className={`flex-1 rounded border px-3 py-2 text-sm capitalize ${draft.visibility === v ? 'border-amber-500 bg-amber-950/20 text-amber-200' : 'border-stone-700 text-stone-300 hover:border-stone-500'}`}>
                  {v}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-stone-500">
              Public worlds appear in the discovery listing. Publishing needs at least one spawn point.
            </p>
          </div>

          <div className="rounded-lg border border-stone-800 bg-stone-950 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-200">Playtest readiness</h3>
              <button onClick={runPlaytestCheck} className="rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800">
                Run check
              </button>
            </div>
            {checkResult ? (
              <div className="space-y-1.5 text-xs">
                <div className={checkResult.ready ? 'text-emerald-300' : 'text-red-300'}>
                  {checkResult.ready ? '✓ Ready to playtest' : '✗ Not ready'}
                </div>
                {checkResult.issues.map((i, idx) => <div key={idx} className="text-red-300">• {i}</div>)}
                {checkResult.warnings.map((w, idx) => <div key={idx} className="text-amber-300">⚠ {w}</div>)}
              </div>
            ) : <p className="text-xs text-stone-500">Run a check to see issues before publishing.</p>}
          </div>

          <button
            onClick={async () => {
              if (!window.confirm('Delete this draft? This cannot be undone.')) return;
              const r = await lensRun('world-creator', 'draft-delete', { id: draftId });
              if (r.data?.ok) onClose();
              else setErr(r.data?.error || 'delete failed');
            }}
            className="rounded border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-300 hover:bg-red-950/60">
            Delete draft
          </button>
        </div>
      )}
    </div>
  );
}

function InspectorBody({ draft, selected, onUpdateProp }: {
  draft: Draft; selected: { kind: string; id: string };
  onUpdateProp: (id: string, patch: Partial<{ x: number; z: number; rotation: number; scale: number }>) => void;
}) {
  if (selected.kind === 'prop') {
    const p = draft.props.find(x => x.id === selected.id);
    if (!p) return null;
    return <dl className="space-y-1.5 text-xs text-stone-300">
      <Row k="Kind" v={p.kind} /><Row k="Position" v={`(${p.x}, ${p.z})`} />
      <div className="flex items-center justify-between gap-2">
        <dt className="text-stone-500">Rotation</dt>
        <dd className="flex items-center gap-1">
          <input type="number" min={0} max={360} step={5} value={p.rotation}
            aria-label="Prop rotation in degrees"
            onChange={e => onUpdateProp(p.id, { rotation: Math.min(360, Math.max(0, Number(e.target.value) || 0)) })}
            className="w-14 rounded border border-stone-700 bg-stone-900 px-1.5 py-0.5 text-right text-stone-100" />
          <span className="text-stone-500">°</span>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-2">
        <dt className="text-stone-500">Scale</dt>
        <dd className="flex items-center gap-1">
          <input type="number" min={0.25} max={4} step={0.25} value={p.scale}
            aria-label="Prop scale multiplier"
            onChange={e => onUpdateProp(p.id, { scale: Math.min(4, Math.max(0.25, Number(e.target.value) || 1)) })}
            className="w-14 rounded border border-stone-700 bg-stone-900 px-1.5 py-0.5 text-right text-stone-100" />
          <span className="text-stone-500">×</span>
        </dd>
      </div>
    </dl>;
  }
  if (selected.kind === 'spawn') {
    const s = draft.spawnPoints.find(x => x.id === selected.id);
    if (!s) return null;
    return <dl className="space-y-1 text-xs text-stone-300">
      <Row k="Name" v={s.name} /><Row k="Position" v={`(${s.x}, ${s.z})`} />
      <Row k="Default" v={s.isDefault ? 'yes ★' : 'no'} />
    </dl>;
  }
  if (selected.kind === 'zone') {
    const z = draft.zones.find(x => x.id === selected.id);
    if (!z) return null;
    return <dl className="space-y-1 text-xs text-stone-300">
      <Row k="Name" v={z.name} /><Row k="Kind" v={z.kind} />
      <Row k="Position" v={`(${z.x}, ${z.z})`} /><Row k="Radius" v={`${z.radius}m`} />
    </dl>;
  }
  if (selected.kind === 'npc') {
    const n = draft.npcs.find(x => x.id === selected.id);
    if (!n) return null;
    const f = draft.factions.find(x => x.id === n.factionId);
    return <dl className="space-y-1 text-xs text-stone-300">
      <Row k="Name" v={n.name} /><Row k="Archetype" v={n.archetype} />
      <Row k="Level" v={String(n.level)} /><Row k="Position" v={`(${n.x}, ${n.z})`} />
      <Row k="Faction" v={f?.name || 'none'} />
      {n.backstory ? (
        <div className="pt-1">
          <dt className="text-stone-500">Backstory</dt>
          <dd className="mt-0.5 text-stone-300">{n.backstory}</dd>
        </div>
      ) : null}
    </dl>;
  }
  if (selected.kind === 'faction') {
    const f = draft.factions.find(x => x.id === selected.id);
    if (!f) return null;
    return <dl className="space-y-1 text-xs text-stone-300">
      <Row k="Name" v={f.name} /><Row k="Stance" v={f.stance} />
      <Row k="Ethos" v={f.ethos || '—'} />
    </dl>;
  }
  return null;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-stone-500">{k}</dt><dd className="text-right text-stone-200">{v}</dd></div>;
}

// NpcPlacementForm — inline form shown after a canvas click with the NPC
// tool active. Replaces the prior `window.prompt('NPC name?')` flow: the
// server's `npc-place` macro accepts `backstory` (up to 600 chars) and
// `level` (clamped 1-100) alongside `name`, but nothing in the UI captured
// them until now.
function NpcPlacementForm({
  busy, archetype, onCancel, onSubmit,
}: {
  busy: boolean; archetype: string;
  onCancel: () => void;
  onSubmit: (fields: { name: string; backstory: string; level: number }) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [backstory, setBackstory] = useState('');
  const [level, setLevel] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const submit = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    await onSubmit({ name: name.trim(), backstory: backstory.trim(), level });
    setSubmitting(false);
  }, [name, backstory, level, onSubmit]);

  return (
    <div role="dialog" aria-label="Place NPC" onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
      className="rounded-lg border border-amber-800/40 bg-amber-950/10 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
          New {archetype} NPC
        </span>
        <button onClick={onCancel} className="text-[11px] text-stone-400 hover:text-stone-200">✕ cancel</button>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-stone-400">Name</label>
        <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) submit(); }}
          placeholder="NPC name" aria-label="NPC name"
          className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100" />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-stone-400">Backstory (optional)</label>
        <textarea value={backstory} onChange={e => setBackstory(e.target.value)} rows={3} maxLength={600}
          placeholder="Who are they, what do they want here?" aria-label="NPC backstory"
          className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-stone-400">Level</label>
        <input type="number" min={1} max={100} value={level}
          onChange={e => setLevel(clampNum(Number(e.target.value), 1, 100) || 1)}
          aria-label="NPC level"
          className="w-16 rounded border border-stone-700 bg-stone-900 px-1.5 py-1 text-xs text-stone-100" />
      </div>
      <button onClick={submit} disabled={busy || submitting || !name.trim()}
        className="w-full rounded bg-amber-600 px-2 py-1 text-xs font-medium text-stone-900 hover:bg-amber-500 disabled:opacity-50">
        + Place NPC
      </button>
    </div>
  );
}

function FactionPanel({
  draft, busy, run, draftId, selectedFaction, onSelectFaction,
}: {
  draft: Draft; busy: boolean; draftId: string;
  run: (name: string, params: Record<string, unknown>) => Promise<boolean>;
  selectedFaction: Draft['factions'][number] | null;
  onSelectFaction: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [ethos, setEthos] = useState('');
  const [stance, setStance] = useState('neutral');
  const [color, setColor] = useState('#c0a060');

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Factions</h3>
      <div className="space-y-1">
        {draft.factions.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 rounded border border-stone-800 bg-stone-900 px-2 py-1">
            <button onClick={() => onSelectFaction(f.id)} className="flex items-center gap-1.5 text-left text-xs text-stone-200">
              <span className="h-3 w-3 rounded-full" style={{ background: f.color }} />
              {f.name} <span className="text-stone-500">· {f.stance}</span>
            </button>
            <button onClick={() => run('faction-remove', { draftId, factionId: f.id })} disabled={busy}
              className="text-[11px] text-red-400 hover:text-red-300">✕</button>
          </div>
        ))}
        {draft.factions.length === 0 && <p className="text-[11px] text-stone-600">No factions yet.</p>}
      </div>
      {selectedFaction && (
        <p className="mt-1.5 text-[11px] text-amber-300/80">Selected: {selectedFaction.name} — {selectedFaction.ethos || 'no ethos set'}</p>
      )}
      <div className="mt-2 space-y-1.5 border-t border-stone-800 pt-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Faction name"
          className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100" />
        <input value={ethos} onChange={e => setEthos(e.target.value)} placeholder="Ethos (optional)"
          className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-100" />
        <div className="flex gap-1.5">
          <select value={stance} onChange={e => setStance(e.target.value)}
            className="flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs text-stone-200">
            {['neutral', 'friendly', 'hostile', 'guarded'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="color" value={color} onChange={e => setColor(e.target.value)}
            className="h-7 w-9 rounded border border-stone-700 bg-stone-900" />
        </div>
        <button disabled={busy || name.trim().length < 1}
          onClick={async () => {
            const ok = await run('faction-add', { draftId, name, ethos, stance, color });
            if (ok) { setName(''); setEthos(''); }
          }}
          className="w-full rounded bg-amber-600 px-2 py-1 text-xs font-medium text-stone-900 hover:bg-amber-500 disabled:opacity-50">
          + Add faction
        </button>
      </div>
    </div>
  );
}
