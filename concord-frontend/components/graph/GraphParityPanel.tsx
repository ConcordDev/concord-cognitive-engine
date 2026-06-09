'use client';

/**
 * GraphParityPanel — surfaces the Obsidian-graph-view / Kumu parity feature
 * set on top of the stored mind-map data model:
 *   - Local graph view (neighborhood at adjustable depth)
 *   - Saved graph filters / query language
 *   - Node color group rules
 *   - Timeline scrubber (animate graph growth)
 *   - Bidirectional DTU sync
 *   - Auto-layout algorithms (hierarchical / radial / circular)
 *   - Export as image/SVG with current view state
 *
 * Every value is real: maps, nodes, filters, rules and layouts come from the
 * graph domain macros — no seeded or mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Workflow, Loader2, Crosshair, Filter, Palette, Clock,
  LayoutGrid, RefreshCw, Download, Trash2, Plus, Link2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GNode { id: string; label: string; notes?: string; central?: boolean; dtuId?: string; syncedAt?: string }
interface GEdge { id: string; from: string; to: string; label?: string }
interface MapMeta { id: string; title: string; nodeCount: number; edgeCount: number }
interface SavedFilter { id: string; name: string; query: FilterQuery }
interface FilterQuery { labelContains?: string; tag?: string; central?: boolean | null; minDegree?: number | null }
interface GroupRule { id: string; name: string; color: string; labelContains?: string; tag?: string }
interface LocalGraphNode extends GNode { hops: number }
interface PositionMap { [id: string]: { x: number; y: number } }

type Algorithm = 'radial' | 'hierarchical' | 'circular';
type Tab = 'local' | 'filters' | 'groups' | 'timeline' | 'layout' | 'sync' | 'export';

const TABS: { id: Tab; label: string; icon: typeof Crosshair }[] = [
  { id: 'local', label: 'Local Graph', icon: Crosshair },
  { id: 'filters', label: 'Saved Filters', icon: Filter },
  { id: 'groups', label: 'Color Groups', icon: Palette },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'layout', label: 'Auto-Layout', icon: LayoutGrid },
  { id: 'sync', label: 'DTU Sync', icon: RefreshCw },
  { id: 'export', label: 'Export View', icon: Download },
];

export function GraphParityPanel() {
  const [maps, setMaps] = useState<MapMeta[]>([]);
  const [mapId, setMapId] = useState<string>('');
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('local');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>('');

  // ── Map loading ───────────────────────────────────────────────────
  const refreshMaps = useCallback(async () => {
    const r = await lensRun('graph', 'map-list', {});
    setMaps((r.data?.result?.maps as MapMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refreshMaps(); }, [refreshMaps]);

  const loadMap = useCallback(async (id: string) => {
    if (!id) { setNodes([]); setEdges([]); return; }
    const r = await lensRun('graph', 'map-detail', { id });
    if (r.data?.ok) {
      setNodes((r.data.result?.map?.nodes as GNode[]) || []);
      setEdges((r.data.result?.map?.edges as GEdge[]) || []);
    }
  }, []);
  useEffect(() => { void loadMap(mapId); }, [mapId, loadMap]);

  const degreeOf = useMemo(() => {
    const d: Record<string, number> = {};
    for (const n of nodes) d[n.id] = 0;
    for (const e of edges) { d[e.from] = (d[e.from] || 0) + 1; d[e.to] = (d[e.to] || 0) + 1; }
    return d;
  }, [nodes, edges]);

  // ── Local graph state ─────────────────────────────────────────────
  const [localRoot, setLocalRoot] = useState<string>('');
  const [localDepth, setLocalDepth] = useState(1);
  const [localResult, setLocalResult] = useState<{ nodes: LocalGraphNode[]; edgeCount: number } | null>(null);

  const runLocalGraph = useCallback(async (root: string, depth: number) => {
    if (!mapId || !root) { setLocalResult(null); return; }
    setBusy(true);
    const r = await lensRun('graph', 'local-graph', { mapId, nodeId: root, depth });
    setBusy(false);
    if (r.data?.ok) {
      setLocalResult({
        nodes: (r.data.result?.nodes as LocalGraphNode[]) || [],
        edgeCount: (r.data.result?.edgeCount as number) || 0,
      });
    } else setNotice(r.data?.error || 'Local graph failed');
  }, [mapId]);

  // ── Saved filters state ───────────────────────────────────────────
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [filterName, setFilterName] = useState('');
  const [fLabel, setFLabel] = useState('');
  const [fTag, setFTag] = useState('');
  const [fCentral, setFCentral] = useState(false);
  const [fMinDegree, setFMinDegree] = useState('');
  const [filterMatch, setFilterMatch] = useState<{ id: string; ids: string[] } | null>(null);

  const refreshFilters = useCallback(async () => {
    const r = await lensRun('graph', 'filter-list', {});
    setFilters((r.data?.result?.filters as SavedFilter[]) || []);
  }, []);
  useEffect(() => { void refreshFilters(); }, [refreshFilters]);

  async function saveFilter() {
    if (!filterName.trim()) return;
    setBusy(true);
    const query: FilterQuery = {
      labelContains: fLabel.trim() || undefined,
      tag: fTag.trim() || undefined,
      central: fCentral ? true : undefined,
      minDegree: fMinDegree.trim() ? parseInt(fMinDegree, 10) : undefined,
    };
    const r = await lensRun('graph', 'filter-save', { name: filterName.trim(), query });
    setBusy(false);
    if (r.data?.ok) {
      setFilterName(''); setFLabel(''); setFTag(''); setFCentral(false); setFMinDegree('');
      await refreshFilters();
    } else setNotice(r.data?.error || 'Save failed');
  }
  async function deleteFilter(id: string) {
    await lensRun('graph', 'filter-delete', { id });
    if (filterMatch?.id === id) setFilterMatch(null);
    await refreshFilters();
  }
  async function applyFilter(id: string) {
    if (!mapId) { setNotice('Select a map first'); return; }
    setBusy(true);
    const r = await lensRun('graph', 'filter-apply', { mapId, filterId: id });
    setBusy(false);
    if (r.data?.ok) setFilterMatch({ id, ids: (r.data.result?.matchedIds as string[]) || [] });
    else setNotice(r.data?.error || 'Apply failed');
  }

  // ── Color group rules state ───────────────────────────────────────
  const [rules, setRules] = useState<GroupRule[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [rName, setRName] = useState('');
  const [rColor, setRColor] = useState('#a855f7');
  const [rLabel, setRLabel] = useState('');
  const [rTag, setRTag] = useState('');

  const refreshRules = useCallback(async (id: string) => {
    if (!id) { setRules([]); setAssignments({}); return; }
    const r = await lensRun('graph', 'group-rules-get', { id });
    if (r.data?.ok) {
      setRules((r.data.result?.rules as GroupRule[]) || []);
      setAssignments((r.data.result?.assignments as Record<string, string>) || {});
    }
  }, []);
  useEffect(() => { if (tab === 'groups') void refreshRules(mapId); }, [tab, mapId, refreshRules]);

  async function persistRules(next: GroupRule[]) {
    if (!mapId) { setNotice('Select a map first'); return; }
    setBusy(true);
    const r = await lensRun('graph', 'group-rules-set', {
      mapId,
      rules: next.map((x) => ({ name: x.name, color: x.color, labelContains: x.labelContains, tag: x.tag })),
    });
    setBusy(false);
    if (r.data?.ok) await refreshRules(mapId);
    else setNotice(r.data?.error || 'Rule update failed');
  }
  function addRule() {
    if (!rName.trim() || (!rLabel.trim() && !rTag.trim())) {
      setNotice('A rule needs a name and a label-match or tag-match');
      return;
    }
    const next = [...rules, {
      id: `tmp_${Date.now()}`, name: rName.trim(), color: rColor,
      labelContains: rLabel.trim() || undefined, tag: rTag.trim() || undefined,
    }];
    setRName(''); setRLabel(''); setRTag('');
    void persistRules(next);
  }
  function removeRule(id: string) { void persistRules(rules.filter((x) => x.id !== id)); }

  // ── Timeline scrubber state ───────────────────────────────────────
  const [tlFrames, setTlFrames] = useState<string[]>([]);
  const [tlIndex, setTlIndex] = useState(0);
  const [tlSnapshot, setTlSnapshot] = useState<{ nodeCount: number; edgeCount: number; cutoff: string } | null>(null);

  const runTimeline = useCallback(async (id: string, index?: number) => {
    if (!id) { setTlFrames([]); setTlSnapshot(null); return; }
    setBusy(true);
    const r = await lensRun('graph', 'timeline', index == null ? { id } : { id, index });
    setBusy(false);
    if (r.data?.ok) {
      setTlFrames((r.data.result?.frames as string[]) || []);
      setTlIndex((r.data.result?.index as number) || 0);
      setTlSnapshot({
        nodeCount: (r.data.result?.nodeCount as number) || 0,
        edgeCount: (r.data.result?.edgeCount as number) || 0,
        cutoff: (r.data.result?.cutoff as string) || '',
      });
    }
  }, []);
  useEffect(() => { if (tab === 'timeline') void runTimeline(mapId); }, [tab, mapId, runTimeline]);

  // ── Auto-layout state ─────────────────────────────────────────────
  const [algorithm, setAlgorithm] = useState<Algorithm>('radial');
  const [positions, setPositions] = useState<PositionMap>({});

  async function runLayout() {
    if (!mapId) { setNotice('Select a map first'); return; }
    setBusy(true);
    const r = await lensRun('graph', 'layout', { mapId, algorithm, width: 460, height: 320 });
    setBusy(false);
    if (r.data?.ok) setPositions((r.data.result?.positions as PositionMap) || {});
    else setNotice(r.data?.error || 'Layout failed');
  }

  // ── DTU sync state ────────────────────────────────────────────────
  const [syncNode, setSyncNode] = useState<string>('');
  const [dtuId, setDtuId] = useState('');

  async function linkDtu() {
    if (!mapId || !syncNode || !dtuId.trim()) return;
    setBusy(true);
    const r = await lensRun('graph', 'link-node-dtu', { mapId, nodeId: syncNode, dtuId: dtuId.trim() });
    setBusy(false);
    if (r.data?.ok) { setDtuId(''); await loadMap(mapId); setNotice('DTU linked to node'); }
    else setNotice(r.data?.error || 'Link failed');
  }
  async function syncToDtu() {
    if (!mapId || !syncNode) return;
    setBusy(true);
    const r = await lensRun('graph', 'sync-to-dtu', { mapId, nodeId: syncNode });
    setBusy(false);
    if (r.data?.ok) { await loadMap(mapId); setNotice(`Synced to DTU at ${r.data.result?.syncedAt}`); }
    else setNotice(r.data?.error || 'Sync failed');
  }

  // ── Export-view state ─────────────────────────────────────────────
  const [exportFmt, setExportFmt] = useState<'svg' | 'json'>('svg');
  const [exZoom, setExZoom] = useState('1');
  const [exPanX, setExPanX] = useState('0');
  const [exPanY, setExPanY] = useState('0');
  const [exSvg, setExSvg] = useState('');

  async function runExport() {
    if (!mapId) { setNotice('Select a map first'); return; }
    setBusy(true);
    const r = await lensRun('graph', 'export-view', {
      mapId, format: exportFmt,
      zoom: parseFloat(exZoom) || 1,
      panX: parseFloat(exPanX) || 0,
      panY: parseFloat(exPanY) || 0,
    });
    setBusy(false);
    if (!r.data?.ok) { setNotice(r.data?.error || 'Export failed'); return; }
    if (exportFmt === 'svg') {
      const svg = (r.data.result?.svg as string) || '';
      setExSvg(svg);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      triggerDownload(blob, `graph-${mapId}.svg`);
    } else {
      setExSvg('');
      const blob = new Blob([JSON.stringify(r.data.result?.export, null, 2)], { type: 'application/json' });
      triggerDownload(blob, `graph-${mapId}.json`);
    }
    setNotice(`Exported as ${exportFmt.toUpperCase()}`);
  }
  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  const labelOf = useCallback((id: string) => nodes.find((n) => n.id === id)?.label || id, [nodes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Workflow className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Graph Toolkit</h3>
        <span className="text-[11px] text-zinc-400">Obsidian / Kumu parity</span>
      </div>

      {/* Map picker */}
      <div className="flex items-center gap-2 mb-3">
        <label className="text-[11px] text-zinc-400">Map</label>
        <select
          value={mapId}
          onChange={(e) => { setMapId(e.target.value); setLocalResult(null); setFilterMatch(null); setPositions({}); setExSvg(''); }}
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200"
        >
          <option value="">Select a mind map…</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>{m.title} ({m.nodeCount} nodes)</option>
          ))}
        </select>
        <button onClick={() => void refreshMaps()} className="p-1 text-zinc-400 hover:text-cyan-300" title="Reload maps">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {maps.length === 0 && (
        <p className="text-[11px] text-zinc-400 mb-3">No maps yet — create one in the Mind Map Builder below.</p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap mb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setNotice(''); }}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border transition-colors',
                tab === t.id
                  ? 'bg-cyan-600/15 border-cyan-700/50 text-cyan-200'
                  : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700',
              )}
            >
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </div>

      {notice && (
        <div className="mb-2 text-[11px] text-cyan-300 bg-cyan-950/40 border border-cyan-900/40 rounded px-2 py-1">
          {notice}
        </div>
      )}

      <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 min-h-[160px]">
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 mb-2" />}

        {/* ── Local graph ── */}
        {tab === 'local' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={localRoot}
                onChange={(e) => { setLocalRoot(e.target.value); void runLocalGraph(e.target.value, localDepth); }}
                className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200"
              >
                <option value="">Focus node…</option>
                {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              <label className="text-[11px] text-zinc-400">Depth {localDepth}</label>
              <input
                type="range" min={1} max={6} value={localDepth}
                onChange={(e) => { const d = +e.target.value; setLocalDepth(d); if (localRoot) void runLocalGraph(localRoot, d); }}
                className="w-28"
              />
            </div>
            {localResult ? (
              <div>
                <p className="text-[11px] text-zinc-400 mb-1">
                  {localResult.nodes.length} nodes · {localResult.edgeCount} edges within {localDepth} hop(s)
                </p>
                <div className="space-y-0.5 max-h-44 overflow-y-auto">
                  {localResult.nodes
                    .slice()
                    .sort((a, b) => a.hops - b.hops)
                    .map((n) => (
                      <div key={n.id} className="flex items-center gap-2 text-xs">
                        <span className={cn(
                          'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-mono',
                          n.hops === 0 ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400',
                        )}>
                          {n.hops}
                        </span>
                        <span className={cn(n.central ? 'text-violet-200 font-semibold' : 'text-zinc-200')}>{n.label}</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-zinc-400">Pick a focus node to see its neighborhood at the chosen depth.</p>
            )}
          </div>
        )}

        {/* ── Saved filters ── */}
        {tab === 'filters' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              <input value={filterName} onChange={(e) => setFilterName(e.target.value)} placeholder="Filter name"
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="Label contains"
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input value={fTag} onChange={(e) => setFTag(e.target.value)} placeholder="Tag"
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input value={fMinDegree} onChange={(e) => setFMinDegree(e.target.value)} type="number" min={0} placeholder="Min degree"
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                <input type="checkbox" checked={fCentral} onChange={(e) => setFCentral(e.target.checked)} />
                Central nodes only
              </label>
              <button onClick={saveFilter} disabled={!filterName.trim()}
                className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px]">
                <Plus className="w-3 h-3" /> Save filter
              </button>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {filters.length === 0 && <p className="text-[11px] text-zinc-400">No saved filters yet.</p>}
              {filters.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-xs bg-zinc-950/60 border border-zinc-800 rounded px-2 py-1">
                  <span className="text-zinc-200 font-medium">{f.name}</span>
                  <span className="text-zinc-400 text-[10px] truncate">
                    {[f.query.labelContains && `label~"${f.query.labelContains}"`,
                      f.query.tag && `tag~"${f.query.tag}"`,
                      f.query.central && 'central',
                      f.query.minDegree != null && `deg≥${f.query.minDegree}`].filter(Boolean).join(' · ') || 'all nodes'}
                  </span>
                  <button onClick={() => applyFilter(f.id)} disabled={!mapId}
                    className="ml-auto text-cyan-400 hover:text-cyan-200 disabled:opacity-40">Apply</button>
                  <button aria-label="Delete" onClick={() => deleteFilter(f.id)} className="text-rose-400 hover:text-rose-300">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            {filterMatch && (
              <div className="text-[11px] text-zinc-300 border-t border-zinc-800 pt-1.5">
                {filterMatch.ids.length} match(es):{' '}
                {filterMatch.ids.length === 0
                  ? <span className="text-zinc-400">none</span>
                  : filterMatch.ids.map((id) => <span key={id} className="text-cyan-300">{labelOf(id)} </span>)}
              </div>
            )}
          </div>
        )}

        {/* ── Color groups ── */}
        {tab === 'groups' && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Group name"
                className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input type="color" value={rColor} onChange={(e) => setRColor(e.target.value)}
                className="w-8 h-7 bg-zinc-950 border border-zinc-800 rounded cursor-pointer" />
              <input value={rLabel} onChange={(e) => setRLabel(e.target.value)} placeholder="Label match"
                className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input value={rTag} onChange={(e) => setRTag(e.target.value)} placeholder="Tag match"
                className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <button onClick={addRule} disabled={!mapId}
                className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px]">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-1">
              {rules.length === 0 && <p className="text-[11px] text-zinc-400">No color rules. Add one to group nodes by color.</p>}
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs bg-zinc-950/60 border border-zinc-800 rounded px-2 py-1">
                  <span className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: r.color }} />
                  <span className="text-zinc-200">{r.name}</span>
                  <span className="text-zinc-400 text-[10px]">
                    {[r.labelContains && `label~"${r.labelContains}"`, r.tag && `tag~"${r.tag}"`].filter(Boolean).join(' · ')}
                  </span>
                  <button aria-label="Delete" onClick={() => removeRule(r.id)} className="ml-auto text-rose-400 hover:text-rose-300">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            {Object.keys(assignments).length > 0 && (
              <div className="border-t border-zinc-800 pt-1.5">
                <p className="text-[11px] text-zinc-400 mb-1">{Object.keys(assignments).length} node(s) grouped</p>
                <div className="flex flex-wrap gap-1">
                  {nodes.filter((n) => assignments[n.id]).map((n) => (
                    <span key={n.id} className="text-[10px] px-1.5 py-0.5 rounded text-zinc-900 font-medium"
                      style={{ backgroundColor: assignments[n.id] }}>
                      {n.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Timeline ── */}
        {tab === 'timeline' && (
          <div className="space-y-2">
            {tlFrames.length > 0 ? (
              <>
                <input
                  type="range" min={0} max={Math.max(0, tlFrames.length - 1)} value={tlIndex}
                  onChange={(e) => void runTimeline(mapId, +e.target.value)}
                  className="w-full"
                />
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Frame {tlIndex + 1} / {tlFrames.length}</span>
                  <span>{tlSnapshot && new Date(tlSnapshot.cutoff).toLocaleString()}</span>
                </div>
                {tlSnapshot && (
                  <div className="flex gap-4 text-xs">
                    <span className="text-cyan-300">{tlSnapshot.nodeCount} nodes</span>
                    <span className="text-violet-300">{tlSnapshot.edgeCount} edges</span>
                    <span className="text-zinc-400">grown to this point</span>
                  </div>
                )}
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-cyan-600 to-violet-600"
                    style={{ width: `${tlFrames.length > 1 ? (tlIndex / (tlFrames.length - 1)) * 100 : 100}%` }} />
                </div>
              </>
            ) : (
              <p className="text-[11px] text-zinc-400">Select a map to scrub its growth over time.</p>
            )}
          </div>
        )}

        {/* ── Auto-layout ── */}
        {tab === 'layout' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
                <option value="radial">Radial</option>
                <option value="hierarchical">Hierarchical</option>
                <option value="circular">Circular</option>
              </select>
              <button onClick={runLayout} disabled={!mapId}
                className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px]">
                <LayoutGrid className="w-3 h-3" /> Compute layout
              </button>
            </div>
            {Object.keys(positions).length > 0 ? (
              <svg viewBox="0 0 460 320" className="w-full h-48 bg-zinc-950 rounded border border-zinc-800">
                {edges.map((e) => {
                  const a = positions[e.from]; const b = positions[e.to];
                  if (!a || !b) return null;
                  return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3f3f46" strokeWidth={1} />;
                })}
                {nodes.map((n) => {
                  const p = positions[n.id];
                  if (!p) return null;
                  return (
                    <g key={n.id}>
                      <circle cx={p.x} cy={p.y} r={n.central ? 7 : 5} fill={n.central ? '#a855f7' : '#06b6d4'} />
                      <text x={p.x} y={p.y - 9} fontSize={8} fill="#a1a1aa" textAnchor="middle">
                        {n.label.slice(0, 14)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            ) : (
              <p className="text-[11px] text-zinc-400">Compute a layout to position nodes by the chosen algorithm.</p>
            )}
          </div>
        )}

        {/* ── DTU sync ── */}
        {tab === 'sync' && (
          <div className="space-y-2">
            <select value={syncNode} onChange={(e) => setSyncNode(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
              <option value="">Select a node…</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.label}{n.dtuId ? ` (→ ${n.dtuId})` : ''}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <input value={dtuId} onChange={(e) => setDtuId(e.target.value)} placeholder="DTU id to link"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <button onClick={linkDtu} disabled={!syncNode || !dtuId.trim()}
                className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-[11px]">
                <Link2 className="w-3 h-3" /> Link
              </button>
            </div>
            <button onClick={syncToDtu} disabled={!syncNode || !nodes.find((n) => n.id === syncNode)?.dtuId}
              className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px]">
              <RefreshCw className="w-3 h-3" /> Push node edits to DTU
            </button>
            <p className="text-[11px] text-zinc-400">
              Linking a node to a DTU lets graph-side label/notes edits flow back into the knowledge substrate.
            </p>
            {syncNode && nodes.find((n) => n.id === syncNode)?.syncedAt && (
              <p className="text-[11px] text-cyan-300">
                Last synced: {new Date(nodes.find((n) => n.id === syncNode)!.syncedAt!).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* ── Export view ── */}
        {tab === 'export' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <select value={exportFmt} onChange={(e) => setExportFmt(e.target.value as 'svg' | 'json')}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
                <option value="svg">SVG image</option>
                <option value="json">JSON</option>
              </select>
              <label className="text-[11px] text-zinc-400">Zoom</label>
              <input value={exZoom} onChange={(e) => setExZoom(e.target.value)} type="number" step="0.1" min="0.1"
                className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
              <label className="text-[11px] text-zinc-400">Pan X</label>
              <input value={exPanX} onChange={(e) => setExPanX(e.target.value)} type="number"
                className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
              <label className="text-[11px] text-zinc-400">Pan Y</label>
              <input value={exPanY} onChange={(e) => setExPanY(e.target.value)} type="number"
                className="w-14 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
              <button onClick={runExport} disabled={!mapId}
                className="flex items-center gap-1 px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-[11px]">
                <Download className="w-3 h-3" /> Export
              </button>
            </div>
            {exSvg ? (
              <div className="rounded border border-zinc-800 overflow-hidden bg-zinc-950"
                dangerouslySetInnerHTML={{ __html: exSvg }} />
            ) : (
              <p className="text-[11px] text-zinc-400">
                Export the current map (with view state baked in) as an SVG image or portable JSON.
              </p>
            )}
          </div>
        )}
      </div>

      {mapId && (
        <p className="mt-2 text-[10px] text-zinc-400">
          {nodes.length} nodes · {edges.length} edges · max degree {Math.max(0, ...Object.values(degreeOf))}
        </p>
      )}
    </div>
  );
}
