'use client';

/**
 * BuilderStudio — Roblox-Studio-parity builder surface for the Foundry
 * lens. Seven tabs, one per net-new Phase 8 feature:
 *
 *   Scripting    — visual blueprint editor (blueprint_kinds / get / save)
 *   Playtest     — in-builder hot-reload loop (playtest_start/reload/end)
 *   Assets       — asset library import/list/remove
 *   Multiplayer  — lobby + matchmaking config (multiplayer_get/set)
 *   Marketplace  — published-games discovery + ratings (marketplace/rate/ratings)
 *   Analytics    — plays / retention / completion dashboard (analytics/track_play)
 *   Collab       — multi-builder roster + presence (collab_*)
 *
 * Every macro listed above is wired to a real control here. The studio
 * targets one foundry world chosen from foundry.list; no inputs are
 * pre-filled with demo data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Workflow, PlayCircle, Boxes, Users2, Store, BarChart3, UserPlus,
  Loader2, RefreshCw, Plus, Trash2, Star, Check, AlertTriangle, Radio,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

// ── Shared types ─────────────────────────────────────────────────────────────

interface FoundryWorld { id: string; name: string; status: string }
interface BlueprintNode { id: string; kind: string; type: string; label: string; x: number; y: number; params: Record<string, unknown> }
interface BlueprintEdge { id: string; from: string; to: string }
interface Blueprint { nodes: BlueprintNode[]; edges: BlueprintEdge[]; updatedAt?: number }
interface BlueprintValidation { ok: boolean; errors: string[]; warnings: string[]; nodeCount: number; edgeCount: number }
interface PlaytestSession { sessionId: string; previewWorldId: string; revision: number; activatedSystems: string[] }
interface FoundryAsset { id: string; kind: string; name: string; url: string; tags: string[]; importedAt: number }
interface MultiplayerCfg {
  enabled: boolean; minPlayers: number; maxPlayers: number; matchmaking: string;
  lobbyCountdownSec: number; teamCount: number; fillBots: boolean;
}
interface MarketGame {
  id: string; name: string; description: string; publishedWorldId: string;
  avgRating: number; ratingCount: number; plays: number;
}
interface AnalyticsSummary {
  totalPlays: number; uniquePlayers: number; totalCompletions: number;
  completionRate: number; retentionDay1: number; avgSessionSec: number;
  playsByDay: Array<{ day: string; plays: number }>;
}
interface Collaborator { userId: string; role: string; addedAt: number }
interface PresenceEntry { userId: string; node: string; at: number }

type TabId = 'scripting' | 'playtest' | 'assets' | 'multiplayer' | 'marketplace' | 'analytics' | 'collab';
type Note = { kind: 'ok' | 'err'; text: string } | null;

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'scripting', label: 'Scripting', icon: Workflow },
  { id: 'playtest', label: 'Playtest', icon: PlayCircle },
  { id: 'assets', label: 'Assets', icon: Boxes },
  { id: 'multiplayer', label: 'Multiplayer', icon: Users2 },
  { id: 'marketplace', label: 'Marketplace', icon: Store },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'collab', label: 'Collab', icon: UserPlus },
];

// foundry.* handlers return their payload at r.data.result (route wraps once).
async function fcall<T = Record<string, unknown>>(
  name: string, input: Record<string, unknown>,
): Promise<{ ok: boolean; payload: T | null; error: string | null }> {
  const r = await lensRun<T & { ok?: boolean; reason?: string; error?: string }>('foundry', name, input);
  const p = r.data?.result;
  if (r.data?.ok === false || !p) return { ok: false, payload: null, error: r.data?.error || 'request failed' };
  if (p.ok === false) return { ok: false, payload: null, error: p.error || p.reason || 'request failed' };
  return { ok: true, payload: p, error: null };
}

// ── Component ────────────────────────────────────────────────────────────────

export function BuilderStudio() {
  const [worlds, setWorlds] = useState<FoundryWorld[]>([]);
  const [worldId, setWorldId] = useState('');
  const [tab, setTab] = useState<TabId>('scripting');
  const [note, setNote] = useState<Note>(null);
  const [loadingWorlds, setLoadingWorlds] = useState(true);

  const ok = useCallback((text: string) => setNote({ kind: 'ok', text }), []);
  const err = useCallback((text: string) => setNote({ kind: 'err', text }), []);

  const loadWorlds = useCallback(async () => {
    setLoadingWorlds(true);
    const r = await fcall<{ worlds: FoundryWorld[] }>('list', {});
    if (r.ok && r.payload) {
      setWorlds(r.payload.worlds);
      setWorldId((cur) => cur || (r.payload!.worlds[0]?.id ?? ''));
    }
    setLoadingWorlds(false);
  }, []);

  useEffect(() => { loadWorlds(); }, [loadWorlds]);

  return (
    <div className="rounded-xl border border-sky-500/20 bg-zinc-950/60 p-4 space-y-3">
      <header className="flex flex-wrap items-center gap-3 border-b border-sky-500/10 pb-3">
        <Workflow className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Builder Studio</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          roblox studio parity
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={worldId}
            onChange={(e) => setWorldId(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[11px] text-white"
          >
            <option value="">
              {loadingWorlds ? 'Loading worlds…' : `— pick a game (${worlds.length}) —`}
            </option>
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>{w.name} · {w.status}</option>
            ))}
          </select>
          <button
            type="button" onClick={loadWorlds}
            className="rounded border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:text-white"
            aria-label="Refresh games"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id} type="button" onClick={() => { setTab(t.id); setNote(null); }}
              className={[
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/40'
                  : 'border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:text-zinc-200',
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      {note && (
        <div className={[
          'flex items-start gap-2 rounded border px-3 py-2 text-[11px]',
          note.kind === 'ok'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300',
        ].join(' ')}>
          {note.kind === 'ok' ? <Check className="mt-0.5 h-3 w-3" /> : <AlertTriangle className="mt-0.5 h-3 w-3" />}
          <span>{note.text}</span>
        </div>
      )}

      {tab === 'marketplace'
        ? <MarketplaceTab ok={ok} err={err} />
        : !worldId
          ? <p className="py-8 text-center text-[12px] text-zinc-400">Pick a game above to use this tab.</p>
          : (
            <>
              {tab === 'scripting' && <ScriptingTab worldId={worldId} ok={ok} err={err} />}
              {tab === 'playtest' && <PlaytestTab worldId={worldId} ok={ok} err={err} />}
              {tab === 'assets' && <AssetsTab worldId={worldId} ok={ok} err={err} />}
              {tab === 'multiplayer' && <MultiplayerTab worldId={worldId} ok={ok} err={err} />}
              {tab === 'analytics' && <AnalyticsTab worldId={worldId} ok={ok} err={err} />}
              {tab === 'collab' && <CollabTab worldId={worldId} ok={ok} err={err} />}
            </>
          )}
    </div>
  );
}

interface TabProps { worldId: string; ok: (t: string) => void; err: (t: string) => void }

// ── 1. Visual scripting / blueprint editor ───────────────────────────────────

function ScriptingTab({ worldId, ok, err }: TabProps) {
  const [kinds, setKinds] = useState<{ nodeKinds: string[]; eventTypes: string[]; actionTypes: string[] }>({
    nodeKinds: [], eventTypes: [], actionTypes: [],
  });
  const [nodes, setNodes] = useState<BlueprintNode[]>([]);
  const [edges, setEdges] = useState<BlueprintEdge[]>([]);
  const [validation, setValidation] = useState<BlueprintValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftKind, setDraftKind] = useState('event');
  const [draftType, setDraftType] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [edgeFrom, setEdgeFrom] = useState('');
  const [edgeTo, setEdgeTo] = useState('');

  useEffect(() => {
    (async () => {
      const k = await fcall<{ nodeKinds: string[]; eventTypes: string[]; actionTypes: string[] }>('blueprint_kinds', {});
      if (k.ok && k.payload) {
        setKinds(k.payload);
        setDraftKind(k.payload.nodeKinds[0] ?? 'event');
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fcall<{ blueprint: Blueprint; validation: BlueprintValidation }>('blueprint_get', { id: worldId });
      if (r.ok && r.payload) {
        setNodes(r.payload.blueprint.nodes || []);
        setEdges(r.payload.blueprint.edges || []);
        setValidation(r.payload.validation);
      }
    })();
  }, [worldId]);

  const typeOptions = draftKind === 'event' ? kinds.eventTypes : draftKind === 'action' ? kinds.actionTypes : [];

  function addNode() {
    if (!draftLabel.trim()) { err('Node label required.'); return; }
    const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setNodes((cur) => [...cur, {
      id, kind: draftKind, type: draftType, label: draftLabel.trim(),
      x: (cur.length % 5) * 130, y: Math.floor(cur.length / 5) * 90, params: {},
    }]);
    setDraftLabel(''); setDraftType('');
  }
  function removeNode(id: string) {
    setNodes((cur) => cur.filter((n) => n.id !== id));
    setEdges((cur) => cur.filter((e) => e.from !== id && e.to !== id));
  }
  function addEdge() {
    if (!edgeFrom || !edgeTo || edgeFrom === edgeTo) { err('Pick two distinct nodes.'); return; }
    setEdges((cur) => [...cur, { id: `e${Date.now().toString(36)}`, from: edgeFrom, to: edgeTo }]);
  }

  async function save() {
    if (nodes.length === 0) { err('Add at least one node before saving.'); return; }
    setBusy(true);
    const r = await fcall<{ blueprint: Blueprint; validation: BlueprintValidation }>('blueprint_save', {
      id: worldId, nodes, edges,
    });
    if (r.ok && r.payload) { setValidation(r.payload.validation); ok('Blueprint saved.'); }
    else err(r.error ?? 'save failed');
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <select value={draftKind} onChange={(e) => { setDraftKind(e.target.value); setDraftType(''); }}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white">
          {kinds.nodeKinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={draftType} onChange={(e) => setDraftType(e.target.value)}
          disabled={typeOptions.length === 0}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white disabled:opacity-40">
          <option value="">{typeOptions.length ? '— type —' : 'no subtype'}</option>
          {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="Node label"
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white" />
        <button type="button" onClick={addNode}
          className="flex items-center justify-center gap-1.5 rounded bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25">
          <Plus className="h-3.5 w-3.5" /> Add node
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
          Graph — {nodes.length} nodes · {edges.length} edges
        </div>
        {nodes.length === 0
          ? <p className="py-3 text-center text-[11px] text-zinc-400">No nodes yet.</p>
          : (
            <ul className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              {nodes.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-zinc-100">{n.label}</div>
                    <div className="text-[10px] text-zinc-400">{n.kind}{n.type ? ` · ${n.type}` : ''}</div>
                  </div>
                  <button type="button" onClick={() => removeNode(n.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Remove node">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <select value={edgeFrom} onChange={(e) => setEdgeFrom(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white">
          <option value="">— from node —</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <select value={edgeTo} onChange={(e) => setEdgeTo(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white">
          <option value="">— to node —</option>
          {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <button type="button" onClick={addEdge}
          className="flex items-center justify-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800">
          <Plus className="h-3.5 w-3.5" /> Connect
        </button>
      </div>

      {edges.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {edges.map((e) => {
            const fn = nodes.find((n) => n.id === e.from)?.label ?? e.from;
            const tn = nodes.find((n) => n.id === e.to)?.label ?? e.to;
            return (
              <li key={e.id} className="flex items-center gap-1.5 rounded bg-zinc-800/60 px-2 py-0.5 text-[10px] text-zinc-300">
                {fn} → {tn}
                <button type="button" onClick={() => setEdges((c) => c.filter((x) => x.id !== e.id))}
                  className="text-zinc-400 hover:text-rose-400" aria-label="Remove edge">×</button>
              </li>
            );
          })}
        </ul>
      )}

      {validation && (
        <div className={[
          'rounded border p-2 text-[11px]',
          validation.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-300',
        ].join(' ')}>
          {validation.ok ? 'Blueprint valid.' : `${validation.errors.length} error(s).`}
          {validation.errors.map((m, i) => <div key={i} className="text-rose-300">· {m}</div>)}
          {validation.warnings.map((m, i) => <div key={i} className="text-amber-300">· {m}</div>)}
        </div>
      )}

      <button type="button" onClick={save} disabled={busy}
        className="flex items-center gap-1.5 rounded bg-sky-500/20 px-3 py-1.5 text-[12px] font-semibold text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Workflow className="h-3.5 w-3.5" />} Save blueprint
      </button>
    </div>
  );
}

// ── 2. In-builder playtest mode + hot-reload ─────────────────────────────────

function PlaytestTab({ worldId, ok, err }: TabProps) {
  const [session, setSession] = useState<PlaytestSession | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    const r = await fcall<{ session: PlaytestSession }>('playtest_start', { id: worldId });
    if (r.ok && r.payload) { setSession(r.payload.session); ok('Playtest session live.'); }
    else err(r.error ?? 'could not start playtest');
    setBusy(false);
  }
  async function reload() {
    if (!session) return;
    setBusy(true);
    const r = await fcall<{ session: PlaytestSession }>('playtest_reload', { sessionId: session.sessionId });
    if (r.ok && r.payload) { setSession(r.payload.session); ok(`Hot-reloaded — revision ${r.payload.session.revision}.`); }
    else err(r.error ?? 'reload failed');
    setBusy(false);
  }
  async function end() {
    if (!session) return;
    setBusy(true);
    const r = await fcall('playtest_end', { sessionId: session.sessionId });
    if (r.ok) { setSession(null); ok('Playtest ended.'); }
    else err(r.error ?? 'end failed');
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      {!session ? (
        <button type="button" onClick={start} disabled={busy}
          className="flex items-center gap-1.5 rounded bg-emerald-500/20 px-3 py-2 text-[12px] font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          Start playtest
        </button>
      ) : (
        <>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] text-emerald-200">
            <div className="font-semibold">Session {session.sessionId.slice(0, 12)}…</div>
            <div className="mt-1 text-zinc-300">Revision {session.revision} · preview world {session.previewWorldId.slice(0, 16)}…</div>
            <div className="mt-1 text-zinc-400">
              Active systems: {session.activatedSystems.length ? session.activatedSystems.join(', ') : 'none'}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={reload} disabled={busy}
              className="flex items-center gap-1.5 rounded bg-sky-500/20 px-3 py-1.5 text-[12px] font-semibold text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Hot-reload
            </button>
            <button type="button" onClick={end} disabled={busy}
              className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
              End session
            </button>
          </div>
          <p className="text-[10px] text-zinc-400">
            Edit the worldspec in the canvas above, then Hot-reload to recompile onto the live preview world without a restart.
          </p>
        </>
      )}
    </div>
  );
}

// ── 3. Asset library ─────────────────────────────────────────────────────────

function AssetsTab({ worldId, ok, err }: TabProps) {
  const [kinds, setKinds] = useState<string[]>([]);
  const [assets, setAssets] = useState<FoundryAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState('');

  const load = useCallback(async () => {
    const r = await fcall<{ assets: FoundryAsset[] }>('asset_list', { id: worldId });
    if (r.ok && r.payload) setAssets(r.payload.assets);
  }, [worldId]);

  useEffect(() => {
    (async () => {
      const k = await fcall<{ kinds: string[] }>('asset_kinds', {});
      if (k.ok && k.payload) { setKinds(k.payload.kinds); setKind(k.payload.kinds[0] ?? ''); }
    })();
  }, []);
  useEffect(() => { load(); }, [load]);

  async function importAsset() {
    if (!name.trim() || !url.trim()) { err('Name and URL required.'); return; }
    setBusy(true);
    const r = await fcall<{ asset: FoundryAsset }>('asset_import', {
      id: worldId, kind, name: name.trim(), url: url.trim(),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    if (r.ok) { ok('Asset imported.'); setName(''); setUrl(''); setTags(''); load(); }
    else err(r.error ?? 'import failed');
    setBusy(false);
  }
  async function remove(assetId: string) {
    const r = await fcall('asset_remove', { id: worldId, assetId });
    if (r.ok) { ok('Asset removed.'); load(); }
    else err(r.error ?? 'remove failed');
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <select value={kind} onChange={(e) => setKind(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white">
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asset name"
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https:// or /path"
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white md:col-span-2" />
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma-sep"
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white" />
      </div>
      <button type="button" onClick={importAsset} disabled={busy}
        className="flex items-center gap-1.5 rounded bg-sky-500/20 px-3 py-1.5 text-[12px] font-semibold text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Import asset
      </button>

      {assets.length === 0
        ? <p className="py-4 text-center text-[11px] text-zinc-400">No assets imported.</p>
        : (
          <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {assets.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-zinc-100">{a.name}</div>
                  <div className="truncate text-[10px] text-zinc-400">{a.kind} · {a.url}</div>
                </div>
                <button type="button" onClick={() => remove(a.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Remove asset">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// ── 4. Multiplayer lobby + matchmaking ───────────────────────────────────────

function MultiplayerTab({ worldId, ok, err }: TabProps) {
  const [modes, setModes] = useState<string[]>([]);
  const [cfg, setCfg] = useState<MultiplayerCfg | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const m = await fcall<{ modes: string[] }>('matchmaking_modes', {});
      if (m.ok && m.payload) setModes(m.payload.modes);
    })();
  }, []);
  useEffect(() => {
    (async () => {
      const r = await fcall<{ multiplayer: MultiplayerCfg }>('multiplayer_get', { id: worldId });
      if (r.ok && r.payload) setCfg(r.payload.multiplayer);
    })();
  }, [worldId]);

  function patch(p: Partial<MultiplayerCfg>) { setCfg((c) => (c ? { ...c, ...p } : c)); }

  async function save() {
    if (!cfg) return;
    setBusy(true);
    const r = await fcall<{ multiplayer: MultiplayerCfg }>('multiplayer_set', { id: worldId, ...cfg });
    if (r.ok && r.payload) { setCfg(r.payload.multiplayer); ok('Multiplayer config saved.'); }
    else err(r.error ?? 'save failed');
    setBusy(false);
  }

  if (!cfg) return <p className="py-6 text-center text-[11px] text-zinc-400">Loading config…</p>;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[11px] text-zinc-200">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Multiplayer enabled
      </label>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <NumField label="Min players" value={cfg.minPlayers} min={1} max={64} onChange={(v) => patch({ minPlayers: v })} />
        <NumField label="Max players" value={cfg.maxPlayers} min={1} max={256} onChange={(v) => patch({ maxPlayers: v })} />
        <NumField label="Lobby countdown (s)" value={cfg.lobbyCountdownSec} min={0} max={600} onChange={(v) => patch({ lobbyCountdownSec: v })} />
        <NumField label="Team count" value={cfg.teamCount} min={0} max={16} onChange={(v) => patch({ teamCount: v })} />
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
          Matchmaking
          <select value={cfg.matchmaking} onChange={(e) => patch({ matchmaking: e.target.value })}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] normal-case text-white">
            {modes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end text-[11px] text-zinc-200">
          <input type="checkbox" checked={cfg.fillBots} onChange={(e) => patch({ fillBots: e.target.checked })} />
          Fill empty slots with bots
        </label>
      </div>
      <button type="button" onClick={save} disabled={busy}
        className="flex items-center gap-1.5 rounded bg-sky-500/20 px-3 py-1.5 text-[12px] font-semibold text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users2 className="h-3.5 w-3.5" />} Save config
      </button>
    </div>
  );
}

function NumField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
      {label}
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-white" />
    </label>
  );
}

// ── 5. Games marketplace (discovery + ratings) ───────────────────────────────

function MarketplaceTab({ ok, err }: { ok: (t: string) => void; err: (t: string) => void }) {
  const [games, setGames] = useState<MarketGame[]>([]);
  const [sort, setSort] = useState<'recent' | 'rating' | 'plays'>('recent');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [openGame, setOpenGame] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fcall<{ games: MarketGame[] }>('marketplace', { sort, q: q.trim() || undefined });
    if (r.ok && r.payload) setGames(r.payload.games);
    else err(r.error ?? 'marketplace load failed');
    setLoading(false);
  }, [sort, q, err]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search published games"
          className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white" />
        <select value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'rating' | 'plays')}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white">
          <option value="recent">Recent</option>
          <option value="rating">Top rated</option>
          <option value="plays">Most played</option>
        </select>
        <button type="button" onClick={load}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800">
          Search
        </button>
      </div>

      {loading
        ? <p className="py-6 text-center text-[11px] text-zinc-400"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Loading…</p>
        : games.length === 0
          ? <p className="py-6 text-center text-[11px] text-zinc-400">No published games match.</p>
          : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {games.map((g) => (
                <li key={g.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-zinc-100">{g.name}</div>
                      <div className="line-clamp-2 text-[10px] text-zinc-400">{g.description || 'No description.'}</div>
                    </div>
                    <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-amber-300">
                      <Star className="h-3 w-3 fill-amber-300" /> {g.avgRating || '—'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-400">
                    <span>{g.plays} plays · {g.ratingCount} ratings</span>
                    <button type="button" onClick={() => setOpenGame(openGame === g.id ? null : g.id)}
                      className="text-sky-400 hover:text-sky-300">
                      {openGame === g.id ? 'Hide' : 'Rate & reviews'}
                    </button>
                  </div>
                  {openGame === g.id && <GameRatingPanel gameId={g.id} ok={ok} err={err} onRated={load} />}
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

function GameRatingPanel({ gameId, ok, err, onRated }: {
  gameId: string; ok: (t: string) => void; err: (t: string) => void; onRated: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [histogram, setHistogram] = useState<Array<{ stars: number; count: number }>>([]);
  const [reviews, setReviews] = useState<Array<{ userId: string; stars: number; review: string }>>([]);

  const loadReviews = useCallback(async () => {
    const r = await fcall<{
      histogram: Array<{ stars: number; count: number }>;
      reviews: Array<{ userId: string; stars: number; review: string }>;
    }>('ratings', { id: gameId });
    if (r.ok && r.payload) { setHistogram(r.payload.histogram); setReviews(r.payload.reviews); }
  }, [gameId]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  async function submit() {
    if (stars < 1) { err('Pick a star rating.'); return; }
    setBusy(true);
    const r = await fcall('rate', { id: gameId, stars, review: review.trim() || undefined });
    if (r.ok) { ok('Rating submitted.'); setReview(''); loadReviews(); onRated(); }
    else err(r.error ?? 'rating failed');
    setBusy(false);
  }

  return (
    <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} type="button" onClick={() => setStars(s)} aria-label={`${s} stars`}>
            <Star className={['h-4 w-4', s <= stars ? 'fill-amber-300 text-amber-300' : 'text-zinc-600'].join(' ')} />
          </button>
        ))}
      </div>
      <textarea value={review} onChange={(e) => setReview(e.target.value)} placeholder="Optional review"
        rows={2} className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-white" />
      <button type="button" onClick={submit} disabled={busy}
        className="rounded bg-sky-500/20 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
        {busy ? 'Submitting…' : 'Submit rating'}
      </button>
      {histogram.some((h) => h.count > 0) && (
        <div className="space-y-0.5">
          {[...histogram].reverse().map((h) => (
            <div key={h.stars} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
              <span className="w-6">{h.stars}★</span>
              <div className="h-1.5 flex-1 rounded bg-zinc-800">
                <div className="h-full rounded bg-amber-400/70"
                  style={{ width: `${Math.min(100, h.count * 20)}%` }} />
              </div>
              <span className="w-5 text-right">{h.count}</span>
            </div>
          ))}
        </div>
      )}
      {reviews.length > 0 && (
        <ul className="space-y-1">
          {reviews.slice(0, 5).map((rv, i) => (
            <li key={i} className="rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400">
              <span className="text-amber-300">{rv.stars}★</span> {rv.review}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 6. Game analytics dashboard ──────────────────────────────────────────────

function AnalyticsTab({ worldId, ok, err }: TabProps) {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fcall<{ summary: AnalyticsSummary }>('analytics', { id: worldId });
    if (r.ok && r.payload) setSummary(r.payload.summary);
    else err(r.error ?? 'analytics load failed');
    setLoading(false);
  }, [worldId, err]);

  useEffect(() => { load(); }, [load]);

  async function track(event: 'play' | 'completion' | 'session') {
    const r = await fcall('track_play', {
      id: worldId, event, durationSec: event === 'session' ? 300 : undefined,
    });
    if (r.ok) { ok(`Recorded a ${event}.`); load(); }
    else err(r.error ?? 'tracking failed');
  }

  if (loading) return <p className="py-6 text-center text-[11px] text-zinc-400"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Loading…</p>;
  if (!summary) return <p className="py-6 text-center text-[11px] text-zinc-400">No analytics yet.</p>;

  const stats = [
    { label: 'Total plays', value: summary.totalPlays },
    { label: 'Unique players', value: summary.uniquePlayers },
    { label: 'Completions', value: summary.totalCompletions },
    { label: 'Completion rate', value: `${Math.round(summary.completionRate * 100)}%` },
    { label: 'Day-1 retention', value: `${Math.round(summary.retentionDay1 * 100)}%` },
    { label: 'Avg session', value: `${summary.avgSessionSec}s` },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">{s.label}</div>
            <div className="mt-0.5 text-lg font-semibold text-sky-200">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Plays — last 7 days</div>
        <ChartKit kind="bar" data={summary.playsByDay} xKey="day"
          series={[{ key: 'plays', label: 'Plays', color: '#0ea5e9' }]} height={180} showLegend={false} />
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="self-center text-[10px] uppercase tracking-wider text-zinc-400">Simulate event:</span>
        <button type="button" onClick={() => track('play')}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
          + Play
        </button>
        <button type="button" onClick={() => track('completion')}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
          + Completion
        </button>
        <button type="button" onClick={() => track('session')}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800">
          + Session
        </button>
      </div>
      <p className="text-[10px] text-zinc-400">
        The world runtime fires track_play automatically when players enter, finish, or leave a published game.
      </p>
    </div>
  );
}

// ── 7. Collaborative multi-builder editing ───────────────────────────────────

function CollabTab({ worldId, ok, err }: TabProps) {
  const [roles, setRoles] = useState<string[]>([]);
  const [owner, setOwner] = useState('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [online, setOnline] = useState<PresenceEntry[]>([]);
  const [grantId, setGrantId] = useState('');
  const [grantRole, setGrantRole] = useState('editor');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fcall<{ owner: string; collaborators: Collaborator[]; online: PresenceEntry[] }>(
      'collab_list', { id: worldId },
    );
    if (r.ok && r.payload) {
      setOwner(r.payload.owner);
      setCollaborators(r.payload.collaborators);
      setOnline(r.payload.online);
    }
  }, [worldId]);

  useEffect(() => {
    (async () => {
      const rr = await fcall<{ roles: string[] }>('collab_roles', {});
      if (rr.ok && rr.payload) { setRoles(rr.payload.roles); setGrantRole(rr.payload.roles[0] ?? 'editor'); }
    })();
  }, []);

  useEffect(() => {
    load();
    // Ping presence + refresh the roster so co-editors show online.
    fcall('collab_ping', { id: worldId, node: 'builder-studio' });
    const t = setInterval(() => {
      fcall('collab_ping', { id: worldId, node: 'builder-studio' });
      load();
    }, 30_000);
    return () => clearInterval(t);
  }, [worldId, load]);

  async function add() {
    if (!grantId.trim()) { err('Enter a user id.'); return; }
    setBusy(true);
    const r = await fcall('collab_add', { id: worldId, userId: grantId.trim(), role: grantRole });
    if (r.ok) { ok('Collaborator added.'); setGrantId(''); load(); }
    else err(r.error ?? 'add failed');
    setBusy(false);
  }
  async function remove(userId: string) {
    const r = await fcall('collab_remove', { id: worldId, userId });
    if (r.ok) { ok('Collaborator removed.'); load(); }
    else err(r.error ?? 'remove failed');
  }

  const onlineIds = useMemo(() => new Set(online.map((o) => o.userId)), [online]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <input value={grantId} onChange={(e) => setGrantId(e.target.value)} placeholder="Collaborator user id"
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white md:col-span-2" />
        <select value={grantRole} onChange={(e) => setGrantRole(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white">
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" onClick={add} disabled={busy}
          className="flex items-center justify-center gap-1.5 rounded bg-sky-500/20 px-2.5 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Add
        </button>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Roster</div>
        <ul className="space-y-1">
          <li className="flex items-center gap-2 rounded bg-zinc-900 px-2 py-1.5 text-[11px]">
            <span className="font-medium text-zinc-100">{owner.slice(0, 16) || '—'}…</span>
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase text-amber-300">owner</span>
            {onlineIds.has(owner) && <Radio className="h-3 w-3 text-emerald-400" />}
          </li>
          {collaborators.map((c) => (
            <li key={c.userId} className="flex items-center gap-2 rounded bg-zinc-900 px-2 py-1.5 text-[11px]">
              <span className="font-medium text-zinc-100">{c.userId.slice(0, 16)}…</span>
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] uppercase text-sky-300">{c.role}</span>
              {onlineIds.has(c.userId) && <Radio className="h-3 w-3 text-emerald-400" />}
              <button type="button" onClick={() => remove(c.userId)}
                className="ml-auto text-zinc-600 hover:text-rose-400" aria-label="Remove collaborator">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {collaborators.length === 0 && <li className="px-2 py-1 text-[10px] text-zinc-400">No collaborators yet.</li>}
        </ul>
      </div>
      <p className="text-[10px] text-zinc-400">
        {online.length} builder(s) editing now. Presence refreshes every 30s.
      </p>
    </div>
  );
}
