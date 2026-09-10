'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraphView, type GraphNode, type GraphEdge } from '@/components/atlas/GraphView';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { BookOpen, Search, Network, ShieldCheck, FileText, Loader2, Sparkles, PenLine, Download, AlertTriangle } from 'lucide-react';
import {
  type Hit, type SearchPayload, type GraphPayload, type Stats, type ResonanceEdge, type ResonancePayload,
  type AnnotationData, type ChunkDetail,
  graphToGraphML, graphToCSV, downloadBlob,
} from '@/components/literary/literary-shared';

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
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


  // Durable annotations library — real persistence through the lens artifact
  // store (no MOCK/SEED). Reader annotations are first-class, listable artifacts.
  const annotations = useLensData<AnnotationData>('literary', 'annotation', { limit: 100, noSeed: true });

  useEffect(() => {
    setStatsLoading(true);
    lensRun<Stats>('literary', 'stats', {}).then((r) => {
      if (r.data?.result) setStats(r.data.result);
    }).catch((e) => console.warn('[literary] stats load failed:', e)).finally(() => setStatsLoading(false));
  }, []);



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
    const g = graph;
    if (!g.nodes.length) return;
    if (fmt === 'graphml') downloadBlob(graphToGraphML(g.nodes, g.edges), 'literary-resonance.graphml', 'application/graphml+xml');
    else if (fmt === 'csv') downloadBlob(graphToCSV(g.edges), 'literary-resonance.csv', 'text/csv');
    else downloadBlob(JSON.stringify({ nodes: g.nodes, edges: g.edges }, null, 2), 'literary-resonance.json', 'application/json');
  }, [graph]);

  const corpusEmpty = stats != null && stats.chunks === 0;
  const exportable = graph.nodes.length > 0;

  return (
    <div className="space-y-6">
        {/* Header stats + export */}
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-violet-300" />
            <h2 className="text-sm font-semibold tracking-wide text-zinc-200">Search desk</h2>
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

        {corpusEmpty && (
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 text-sm text-amber-200/90">
            <p className="font-medium mb-1">No corpus ingested yet.</p>
            <p className="text-amber-200/70">
              Run <code className="px-1 rounded bg-black/30">node scripts/ingest-gutenberg.mjs</code> to mirror a
              public-domain starter set into the lattice, then search returns grounded passages with provenance.
            </p>
          </div>
        )}

        {loading && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Searching the corpus…
          </div>
        )}

        {searchError && !loading && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-900/50 bg-rose-950/20 p-4 text-sm text-rose-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              Search failed: {searchError}
            </span>
            <button type="button" onClick={runSearch} className="px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-xs font-medium flex-shrink-0">
              Retry
            </button>
          </div>
        )}

        {searched && !corpusEmpty && !searchError && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 space-y-3" aria-label="Search results">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-300">
                  {hits.length} result{hits.length === 1 ? '' : 's'}
                </h2>
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
    </div>
  );
}
