'use client';

/**
 * Literary Lens — Literary Resonance Lattice (LRL) front door.
 *
 * Hybrid search (BM25 + dense, RRF-fused server-side in domains/literary.js) over
 * the ingested public-domain corpus. Honest by construction: the "Grounded" vs
 * "Keyword" badge reflects the server's real `semantic` flag (true only when the
 * Ollama embedder actually ran), every result links to its source provenance,
 * and an empty corpus shows a real "ingest the corpus" call-to-action rather than
 * fabricated rows.
 *
 * Persistence: a reader's annotation is a first-class, durable artifact — it is
 * stored in the lens artifact store (useLensData('literary','annotation')) AND
 * mints a derivative DTU citing the source passage (the self-growing lattice).
 * The resonance force-graph exports as GraphML / CSV / JSON (real export, built
 * from live graph nodes/edges — no fabricated structure).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { GraphView, type GraphNode, type GraphEdge } from '@/components/atlas/GraphView';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { BookOpen, Search, Network, ShieldCheck, FileText, Loader2, Sparkles, PenLine, Download, Library, AlertTriangle, Gem } from 'lucide-react';

interface Provenance {
  sourceId: string; dtuId: string; title: string; author?: string;
  license?: string; gutenbergId?: string; url?: string;
}
interface Hit {
  chunkId: string; dtuId: string; title: string; author?: string; era?: string;
  chapter?: number | null; kind?: string; heading?: string | null;
  snippet: string; score: number; provenance: Provenance;
}
interface SearchPayload { ok: boolean; results: Hit[]; count: number; semantic: boolean }
interface GraphPayload { ok: boolean; nodes: GraphNode[]; edges: GraphEdge[]; semantic: boolean }
interface Stats { ok: boolean; sources: number; chunks: number; embedded: number }
interface ResonanceEdge { dtuId: string; domain?: string; title?: string; score: number; kind?: string }
interface ResonancePayload { ok: boolean; dtuId: string; edges: ResonanceEdge[] }
interface AnnotationData { chunkId: string; note: string; title?: string; author?: string; citedDtuId?: string }
interface ChunkNeighbor { chunkId: string; ord: number; heading?: string | null; preview: string }
interface ChunkDetail {
  ok: boolean; reason?: string;
  chunk?: { chunkId: string; sourceId: string; dtuId: string; ord: number; heading?: string | null; content: string };
  neighbors?: ChunkNeighbor[];
}
interface Crystal {
  chunkId: string; dtuId: string; heading?: string | null; title: string; author?: string;
  edgeCount: number; avgScore: number; salience: number;
}
interface CrystallizePayload { ok: boolean; crystals: Crystal[] }

// ── Resonance-graph export (GraphML / CSV / JSON) — built from the live graph,
// never fabricated. GraphML is the standard force-graph interchange (Gephi/yEd).
// @env-config-ok — the graphml.graphdrawing.org/xmlns string below is an XML
// namespace URI (GraphML spec boilerplate), never fetched over the network.
function graphToGraphML(nodes: GraphNode[], edges: GraphEdge[]): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
  const n = nodes.map((x) => `    <node id="${esc(x.id)}"><data key="label">${esc(x.label)}</data><data key="group">${esc(x.group)}</data></node>`).join('\n');
  const e = edges.map((x, i) => `    <edge id="e${i}" source="${esc(x.source)}" target="${esc(x.target)}"><data key="kind">${esc((x as { kind?: string }).kind || 'edge')}</data></edge>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="group" for="node" attr.name="group" attr.type="string"/>
  <key id="kind" for="edge" attr.name="kind" attr.type="string"/>
  <graph edgedefault="undirected">
${n}
${e}
  </graph>
</graphml>`;
}

function graphToCSV(edges: GraphEdge[]): string {
  const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = edges.map((x) => [esc(x.source), esc(x.target), esc((x as { kind?: string }).kind || 'edge')].join(','));
  return ['source,target,kind', ...rows].join('\n');
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export default function LiteraryLensPage() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [lattice, setLattice] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [semantic, setSemantic] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [resonance, setResonance] = useState<ResonanceEdge[]>([]);
  const [note, setNote] = useState('');
  const [noteStatus, setNoteStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [detail, setDetail] = useState<ChunkDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Phase 4 (#8) — crystallization candidates: the passages bridging the most
  // other domains (highest resonance edge count × avg score = salience). A
  // real, cheap read with no external dependency — surfaced as a browse/
  // discovery panel in the no-query state, matching the Resonance lattice below.
  const [crystals, setCrystals] = useState<Crystal[]>([]);
  const [crystalsLoading, setCrystalsLoading] = useState(true);
  const [crystalsError, setCrystalsError] = useState<string | null>(null);
  const [crystalOpenId, setCrystalOpenId] = useState<string | null>(null);
  const [crystalDetail, setCrystalDetail] = useState<ChunkDetail | null>(null);
  const [crystalDetailLoading, setCrystalDetailLoading] = useState(false);
  const [crystalDetailError, setCrystalDetailError] = useState<string | null>(null);

  // Durable annotations library — real persistence through the lens artifact
  // store (no MOCK/SEED). Reader annotations are first-class, listable artifacts.
  const annotations = useLensData<AnnotationData>('literary', 'annotation', { limit: 100, noSeed: true });

  useEffect(() => {
    setStatsLoading(true);
    lensRun<Stats>('literary', 'stats', {}).then((r) => {
      if (r.data?.result) setStats(r.data.result);
    }).catch(() => {}).finally(() => setStatsLoading(false));
    // The cross-domain resonance lattice — bridges (resonance) + citations.
    lensRun<{ ok: boolean; nodes: GraphNode[]; edges: GraphEdge[] }>('literary', 'resonance_graph', { limit: 120 })
      .then((r) => { const g = r.data?.result; if (g?.nodes?.length) setLattice({ nodes: g.nodes, edges: g.edges || [] }); })
      .catch(() => {});
  }, []);

  // literary.crystallize was registered and tested but had zero UI caller —
  // load the ranked candidates once on mount (cheap, no external dependency).
  const loadCrystals = useCallback(async () => {
    setCrystalsLoading(true);
    setCrystalsError(null);
    try {
      const r = await lensRun<CrystallizePayload>('literary', 'crystallize', { limit: 8 });
      if (r.data?.ok === false) { setCrystalsError(r.data?.error || 'unavailable'); return; }
      const payload = r.data?.result;
      if (payload?.ok === false) { setCrystalsError('unavailable'); return; }
      setCrystals(payload?.crystals || []);
    } catch {
      setCrystalsError('request_failed');
    } finally {
      setCrystalsLoading(false);
    }
  }, []);

  useEffect(() => { void loadCrystals(); }, [loadCrystals]);

  // Reading a crystallization candidate reuses literary.detail, but in a
  // self-contained per-card accordion rather than the search-hit reader state
  // above — a crystal is not a search hit and carries no snippet/provenance.
  const loadCrystalDetail = useCallback(async (chunkId: string) => {
    setCrystalDetail(null);
    setCrystalDetailError(null);
    setCrystalDetailLoading(true);
    try {
      const r = await lensRun<ChunkDetail>('literary', 'detail', { chunkId });
      if (r.data?.ok === false || r.data?.result == null) { setCrystalDetailError(r.data?.error || 'unavailable'); return; }
      const out = r.data.result as ChunkDetail;
      if (out.ok === false) { setCrystalDetailError(out.reason || 'unavailable'); return; }
      setCrystalDetail(out);
    } catch {
      setCrystalDetailError('request_failed');
    } finally {
      setCrystalDetailLoading(false);
    }
  }, []);

  const toggleCrystalDetail = useCallback((chunkId: string) => {
    if (crystalOpenId === chunkId) { setCrystalOpenId(null); return; }
    setCrystalOpenId(chunkId);
    void loadCrystalDetail(chunkId);
  }, [crystalOpenId, loadCrystalDetail]);

  // Phase 2 — pull cross-domain resonance bridges for the selected passage.
  useEffect(() => {
    if (!selected) { setResonance([]); return; }
    let live = true;
    lensRun<ResonancePayload>('literary', 'resonance', { chunkId: selected, limit: 6 })
      .then((r) => { if (live) setResonance(r.data?.result?.edges || []); })
      .catch(() => { if (live) setResonance([]); });
    return () => { live = false; };
  }, [selected]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    setSearchError(null);
    try {
      const [s, g] = await Promise.all([
        lensRun<SearchPayload>('literary', 'search', { query: q, limit: 12 }),
        lensRun<GraphPayload>('literary', 'semantic_graph', { query: q, limit: 24 }),
      ]);
      if (s.data?.ok === false) throw new Error(s.data?.error || 'search_failed');
      const payload = s.data?.result;
      setHits(payload?.results || []);
      setSemantic(!!payload?.semantic);
      const gp = g.data?.result;
      setGraph({ nodes: gp?.nodes || [], edges: gp?.edges || [] });
      setSelected(null);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search failed');
      setHits([]);
      setGraph({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Reset the note editor + full-passage reader when the search-hit selection
  // changes. detailChunkId tracks the passage being READ, which can drift to a
  // neighboring chunk (not a search hit) without disturbing `selected` — the
  // Annotate/Provenance/resonance panels stay anchored to the actual search hit.
  const [detailChunkId, setDetailChunkId] = useState<string | null>(null);
  useEffect(() => { setNote(''); setNoteStatus('idle'); setDetail(null); setDetailError(null); setDetailOpen(false); setDetailChunkId(selected); }, [selected]);

  // literary.detail was registered and tested but had zero UI caller — search
  // results only ever showed a 3-line snippet with no way to actually read the
  // passage, in a lens whose whole point is reading literary text.
  const loadDetail = useCallback(async (chunkId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const r = await lensRun<ChunkDetail>('literary', 'detail', { chunkId });
      if (r.data?.ok === false || r.data?.result == null) { setDetailError(r.data?.error || 'unavailable'); return; }
      const out = r.data.result as ChunkDetail;
      if (out.ok === false) { setDetailError(out.reason || 'unavailable'); return; }
      setDetail(out);
    } catch {
      setDetailError('request_failed');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetail = useCallback(() => {
    if (!selected) return;
    setDetailOpen(true);
    if (!detail && !detailLoading) void loadDetail(selected);
  }, [selected, detail, detailLoading, loadDetail]);

  const gotoNeighbor = useCallback((chunkId: string) => {
    setDetailChunkId(chunkId);
    setDetail(null);
    void loadDetail(chunkId);
  }, [loadDetail]);

  const selectedHit = useMemo(() => hits.find((h) => h.chunkId === selected) || null, [hits, selected]);

  const saveNote = useCallback(async () => {
    if (!selected || !note.trim() || !selectedHit) return;
    setNoteStatus('saving');
    try {
      // 1) mint the derivative DTU citing the source passage (lattice growth).
      const r = await lensRun<{ ok: boolean; dtuId?: string }>('literary', 'annotate', { chunkId: selected, note: note.trim(), quote: selectedHit.snippet });
      if (!r.data?.result?.ok) { setNoteStatus('error'); return; }
      // 2) persist the annotation as a durable, listable artifact.
      await annotations.create({
        title: `Note: ${selectedHit.title}`.slice(0, 160),
        data: {
          chunkId: selected,
          note: note.trim(),
          title: selectedHit.title,
          author: selectedHit.author,
          citedDtuId: r.data.result.dtuId,
        },
        meta: { tags: ['literary', 'annotation'], status: 'active', visibility: 'private' },
      }).catch(() => { /* DTU already minted; store write is best-effort */ });
      setNoteStatus('saved');
      setNote('');
    } catch {
      setNoteStatus('error');
    }
  }, [selected, note, selectedHit, annotations]);

  const exportGraph = useCallback((fmt: 'graphml' | 'csv' | 'json') => {
    const g = lattice.nodes.length ? lattice : graph;
    if (!g.nodes.length) return;
    if (fmt === 'graphml') downloadBlob(graphToGraphML(g.nodes, g.edges), 'literary-resonance.graphml', 'application/graphml+xml');
    else if (fmt === 'csv') downloadBlob(graphToCSV(g.edges), 'literary-resonance.csv', 'text/csv');
    else downloadBlob(JSON.stringify({ nodes: g.nodes, edges: g.edges }, null, 2), 'literary-resonance.json', 'application/json');
  }, [lattice, graph]);

  const corpusEmpty = stats != null && stats.chunks === 0;
  const exportable = lattice.nodes.length > 0 || graph.nodes.length > 0;
  const savedAnnotations = annotations.items;

  return (
    <LensShell lensId="literary">
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-purple-950/10 text-slate-100 p-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-300" />
            <h1 className="text-lg font-semibold tracking-wide">Literary Lattice</h1>
          </div>
          {stats && (
            <div className="text-xs text-zinc-400 flex items-center gap-3">
              <span>{stats.sources.toLocaleString()} works</span>
              <span>{stats.chunks.toLocaleString()} passages</span>
              <span>{stats.embedded.toLocaleString()} embedded</span>
              {exportable && (
                <span className="flex items-center gap-1 pl-2 border-l border-zinc-800">
                  <Download className="w-3 h-3 text-zinc-500" />
                  <button type="button" onClick={() => exportGraph('graphml')} className="hover:text-violet-300 underline">GraphML</button>
                  <button type="button" onClick={() => exportGraph('csv')} className="hover:text-violet-300 underline">CSV</button>
                  <button type="button" onClick={() => exportGraph('json')} className="hover:text-violet-300 underline">JSON</button>
                </span>
              )}
            </div>
          )}
        </header>

        {/* Stats loading — genuine loading state */}
        {statsLoading && !stats && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading the lattice…
          </div>
        )}

        {/* Search bar */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus-within:border-violet-500/50">
            <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="Search themes, passages, authors — e.g. “mortality and conscience”"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-zinc-600"
              aria-label="Literary search query"
            />
          </div>
          <button
            type="button"
            onClick={runSearch}
            disabled={loading || !query.trim()}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Search className="w-4 h-4" aria-hidden="true" />}
            Search
          </button>
        </div>

        {/* Empty-corpus call-to-action — honest, no fabricated data */}
        {corpusEmpty && (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 text-sm text-amber-200/90">
            <p className="font-medium mb-1">No corpus ingested yet.</p>
            <p className="text-amber-200/70">
              Run <code className="px-1 rounded bg-black/30">node scripts/ingest-gutenberg.mjs</code> to mirror a
              public-domain starter set into the lattice, then search returns grounded passages with provenance.
            </p>
          </div>
        )}

        {/* Search loading — genuine loading state */}
        {loading && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Searching the corpus…
          </div>
        )}

        {/* Search error — genuine error state + Retry */}
        {searchError && !loading && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-900/50 bg-rose-950/20 p-4 text-sm text-rose-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              Search failed: {searchError}
            </span>
            <button
              type="button"
              onClick={runSearch}
              className="px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-xs font-medium flex-shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {searched && !corpusEmpty && !searchError && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Results */}
            <section className="lg:col-span-2 space-y-3" aria-label="Search results">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-300">
                  {hits.length} result{hits.length === 1 ? '' : 's'}
                </h2>
                {/* Honest retrieval-mode badge */}
                <span
                  className={
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ' +
                    (semantic
                      ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400')
                  }
                  title={semantic ? 'Dense embedding retrieval ran (Ollama up)' : 'Keyword/BM25 only — embedder offline'}
                >
                  <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                  {semantic ? 'Grounded (hybrid)' : 'Keyword only'}
                </span>
              </div>

              {/* Genuine empty state for a search that matched nothing */}
              {hits.length === 0 && !loading && (
                <p className="text-sm text-zinc-500">No passages matched. Try broader terms.</p>
              )}

              {hits.map((h) => (
                <button
                  key={h.chunkId}
                  type="button"
                  onClick={() => setSelected(h.chunkId)}
                  aria-pressed={selected === h.chunkId}
                  className={
                    'block w-full text-left rounded-lg border p-3 transition-colors ' +
                    (selected === h.chunkId
                      ? 'border-violet-500/60 bg-violet-950/20'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700')
                  }
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-100 truncate">{h.title}</span>
                    {h.kind && <span className="text-[10px] uppercase tracking-wider text-zinc-500 flex-shrink-0">{h.kind}</span>}
                  </div>
                  {(h.author || h.heading) && (
                    <div className="text-xs text-zinc-400 mb-1 truncate">
                      {h.author}{h.heading ? ` · ${h.heading}` : ''}
                    </div>
                  )}
                  <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3">{h.snippet}</p>
                </button>
              ))}
            </section>

            {/* Resonance graph + provenance */}
            <aside className="space-y-4">
              {graph.nodes.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <h3 className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 text-xs font-semibold text-zinc-300">
                    <Network className="w-3.5 h-3.5" aria-hidden="true" /> Resonance graph
                  </h3>
                  <GraphView
                    nodes={graph.nodes}
                    edges={graph.edges}
                    focusedId={selected ?? undefined}
                    onNodeClick={(n) => setSelected(n.id)}
                    className="w-full h-64"
                  />
                </div>
              )}

              {selectedHit && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                    <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Provenance
                  </h3>
                  <dl className="text-xs space-y-1">
                    <div className="flex justify-between gap-2"><dt className="text-zinc-500">Work</dt><dd className="text-zinc-200 text-right">{selectedHit.provenance.title}</dd></div>
                    {selectedHit.provenance.author && <div className="flex justify-between gap-2"><dt className="text-zinc-500">Author</dt><dd className="text-zinc-200 text-right">{selectedHit.provenance.author}</dd></div>}
                    {selectedHit.provenance.license && <div className="flex justify-between gap-2"><dt className="text-zinc-500">License</dt><dd className="text-emerald-300 text-right">{selectedHit.provenance.license}</dd></div>}
                    <div className="flex justify-between gap-2"><dt className="text-zinc-500">Source DTU</dt><dd className="text-zinc-400 text-right font-mono text-[10px] truncate max-w-[10rem]">{selectedHit.dtuId}</dd></div>
                  </dl>
                  <div className="flex items-center gap-3 pt-1">
                    <button type="button" onClick={() => void openDetail()} className="text-[11px] text-violet-300 hover:text-violet-200 underline">
                      Read full passage ↓
                    </button>
                    {selectedHit.provenance.url && (
                      <a href={selectedHit.provenance.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-300 hover:text-violet-200 underline">
                        Full text ↗
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Full-passage reader — literary.detail was registered/tested but had
                  zero UI caller; search only ever surfaced a 3-line snippet. */}
              {selectedHit && detailOpen && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2" data-testid="passage-detail">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                    <BookOpen className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" /> Full passage
                  </h3>
                  {detailLoading && (
                    <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400">
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Loading passage…
                    </div>
                  )}
                  {!detailLoading && detailError && (
                    <div role="alert" className="flex items-center justify-between gap-2 text-xs text-rose-300">
                      <span>Couldn&apos;t load the passage ({detailError}).</span>
                      <button type="button" onClick={() => detailChunkId && void loadDetail(detailChunkId)} className="text-rose-200 underline flex-shrink-0">Retry</button>
                    </div>
                  )}
                  {!detailLoading && !detailError && detail?.chunk && (
                    <>
                      <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">{detail.chunk.content}</p>
                      {(detail.neighbors?.length ?? 0) > 0 && (
                        <div className="pt-2 border-t border-zinc-800">
                          <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Nearby in this work</h4>
                          <ul className="space-y-1">
                            {detail.neighbors!.map((n) => (
                              <li key={n.chunkId}>
                                <button
                                  type="button"
                                  onClick={() => gotoNeighbor(n.chunkId)}
                                  aria-current={n.chunkId === detailChunkId ? 'true' : undefined}
                                  className="text-[11px] text-zinc-400 hover:text-violet-300 text-left truncate block w-full"
                                >
                                  {n.heading ? `${n.heading} — ` : ''}{n.preview}…
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Phase 2 — cross-domain resonance bridges */}
              {selectedHit && resonance.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" /> Cross-domain resonance
                  </h3>
                  <ul className="space-y-1.5">
                    {resonance.map((e) => (
                      <li key={e.dtuId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-zinc-200">{e.title || e.dtuId}</span>
                        <span className="flex items-center gap-1.5 flex-shrink-0">
                          {e.domain && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] uppercase tracking-wider text-zinc-400">{e.domain}</span>}
                          <span className="text-[10px] text-amber-300/80 font-mono">{e.score.toFixed(2)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Phase 4 — annotation crystallization: a note becomes a new DTU
                  citing this passage + a durable, listable annotation artifact. */}
              {selectedHit && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                    <PenLine className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" /> Annotate
                  </h3>
                  <textarea
                    value={note}
                    onChange={(e) => { setNote(e.target.value); setNoteStatus('idle'); }}
                    rows={3}
                    aria-label="Annotation note"
                    placeholder="Your reading — becomes a DTU citing this passage…"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs resize-none focus:border-sky-500/50 outline-none placeholder:text-zinc-600"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500" role="status" aria-live="polite">
                      {noteStatus === 'saved' && <span className="text-emerald-400">Saved — DTU minted</span>}
                      {noteStatus === 'error' && <span className="text-rose-400">Could not save</span>}
                    </span>
                    <button
                      type="button"
                      onClick={saveNote}
                      disabled={!note.trim() || noteStatus === 'saving'}
                      className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-medium"
                    >
                      {noteStatus === 'saving' ? 'Saving…' : 'Save note'}
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {!searched && !corpusEmpty && (
          <p className="text-sm text-zinc-500 max-w-2xl">
            Search humanity&apos;s public-domain literary corpus as a living semantic substrate. Every passage is a
            first-class DTU — results are grounded, traceable to their source work and license, and bridge into the
            rest of the lattice.
          </p>
        )}

        {/* Annotations library — durable persistence surfaced back to the reader. */}
        {savedAnnotations.length > 0 && (
          <section aria-label="Saved annotations" className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
              <Library className="w-4 h-4 text-sky-300" aria-hidden="true" /> Your annotations
              <span className="text-[11px] text-zinc-500 font-normal">— {savedAnnotations.length} saved, each citing a source passage</span>
            </h3>
            <ul className="space-y-1.5">
              {savedAnnotations.slice(0, 12).map((a) => (
                <li key={a.id} className="text-xs text-zinc-300 border-b border-zinc-800/60 pb-1.5 last:border-0">
                  <span className="text-zinc-200 font-medium">{a.data?.title || a.title}</span>
                  {a.data?.author && <span className="text-zinc-500"> · {a.data.author}</span>}
                  <p className="text-zinc-400 line-clamp-2 mt-0.5">{a.data?.note}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Phase 4 (#8) — crystallization candidates: passages bridging the most
            other domains, ranked by resonance salience (breadth × avg strength).
            This is the browse/discovery surface for literary.crystallize, which
            was registered/tested but had zero UI caller. */}
        {!searched && !corpusEmpty && (
          <section aria-label="Crystallization candidates" className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <h3 className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-sm font-semibold text-zinc-300">
              <Gem className="w-4 h-4 text-cyan-300" aria-hidden="true" /> Crystallization candidates
              <span className="text-[11px] text-zinc-500 font-normal">— passages bridging the most other domains, ranked by resonance salience</span>
            </h3>
            <div className="p-3 space-y-2">
              {crystalsLoading && (
                <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Ranking passages by resonance salience…
                </div>
              )}
              {!crystalsLoading && crystalsError && (
                <div role="alert" className="flex items-center justify-between gap-3 text-xs text-rose-300">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" /> Couldn&apos;t rank passages ({crystalsError}).
                  </span>
                  <button type="button" onClick={() => void loadCrystals()} className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-[11px] font-medium flex-shrink-0">
                    Retry
                  </button>
                </div>
              )}
              {!crystalsLoading && !crystalsError && crystals.length === 0 && (
                <p className="text-xs text-zinc-500">No cross-domain resonance edges yet — search a few passages to seed bridges, then candidates surface here.</p>
              )}
              {!crystalsLoading && !crystalsError && crystals.map((c, i) => (
                <div key={c.chunkId} className="rounded-lg border border-zinc-800 bg-zinc-950/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleCrystalDetail(c.chunkId)}
                    aria-expanded={crystalOpenId === c.chunkId}
                    className="w-full text-left p-3 flex items-start gap-3 hover:bg-zinc-900/60 transition-colors"
                  >
                    <span className="text-[10px] font-mono text-cyan-400/80 w-5 flex-shrink-0 pt-0.5">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-zinc-100 truncate">{c.title}</span>
                        <span className="text-[10px] font-mono text-cyan-300 flex-shrink-0" title="Resonance salience — breadth × strength of cross-domain bridges">
                          {(c.salience * 100).toFixed(0)}%
                        </span>
                      </div>
                      {(c.author || c.heading) && (
                        <div className="text-xs text-zinc-400 truncate">
                          {c.author}{c.heading ? ` · ${c.heading}` : ''}
                        </div>
                      )}
                      <div className="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full bg-cyan-500/70" style={{ width: `${Math.round(Math.min(1, Math.max(0, c.salience)) * 100)}%` }} />
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-1">
                        {c.edgeCount} bridge{c.edgeCount === 1 ? '' : 's'} · avg score {c.avgScore.toFixed(2)}
                      </div>
                    </div>
                  </button>
                  {crystalOpenId === c.chunkId && (
                    <div className="border-t border-zinc-800 p-3 space-y-2" data-testid="crystal-detail">
                      {crystalDetailLoading && (
                        <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400">
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Loading passage…
                        </div>
                      )}
                      {!crystalDetailLoading && crystalDetailError && (
                        <div role="alert" className="flex items-center justify-between gap-2 text-xs text-rose-300">
                          <span>Couldn&apos;t load the passage ({crystalDetailError}).</span>
                          <button type="button" onClick={() => void loadCrystalDetail(c.chunkId)} className="text-rose-200 underline flex-shrink-0">Retry</button>
                        </div>
                      )}
                      {!crystalDetailLoading && !crystalDetailError && crystalDetail?.chunk && (
                        <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">{crystalDetail.chunk.content}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Resonance lattice — the cross-domain hub graph (resonance bridges + citation
            ancestry). Generative art from real DTU resonance (#46) + royalty viz (#35). */}
        {!searched && lattice.nodes.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <h3 className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-sm font-semibold text-zinc-300">
              <Network className="w-4 h-4 text-amber-300" aria-hidden="true" /> Resonance lattice
              <span className="text-[11px] text-zinc-500 font-normal">— {lattice.nodes.length} nodes · {lattice.edges.length} bridges + citations</span>
            </h3>
            <GraphView nodes={lattice.nodes} edges={lattice.edges} className="w-full h-80" />
          </div>
        )}
      </main>
    </LensShell>
  );
}
