'use client';

/**
 * ConceptExplorer — bespoke ConceptNet 5 graph explorer for the
 * commonsense lens. Backed by commonsense.conceptnet-edges +
 * conceptnet-relatedness.
 *
 * Per category-leader research (ConceptNet, WordNet, Wikidata, Neo4j
 * Bloom): radial focus + relation-type chip filters + path-breadcrumb
 * navigation + Save-as-DTU per assertion.
 */

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Loader2, Search, ArrowRight, ChevronLeft } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Edge {
  relation: string;
  relationId?: string;
  start: string;
  startConcept?: string;
  end: string;
  endConcept?: string;
  weight: number;
  surfaceText?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('commonsense', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const RELATION_COLOR: Record<string, string> = {
  IsA: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
  HasA: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  PartOf: 'border-violet-500/40 bg-violet-500/10 text-violet-200',
  UsedFor: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  CapableOf: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  AtLocation: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  Synonym: 'border-zinc-700 bg-zinc-900 text-zinc-300',
  Antonym: 'border-pink-500/40 bg-pink-500/10 text-pink-200',
  RelatedTo: 'border-zinc-700 bg-zinc-900 text-zinc-400',
  default: 'border-zinc-800 bg-zinc-900/60 text-zinc-400',
};

export function ConceptExplorer() {
  const [concept, setConcept] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [activeRel, setActiveRel] = useState<string | null>(null);

  const fetchEdges = useMutation({
    mutationFn: async (c: string) => callMacro<{ edges: Edge[] }>('conceptnet-edges', { concept: c, limit: 80 }),
    onSuccess: (env) => { if (env.ok && env.result) setEdges(env.result.edges); else setEdges([]); },
  });

  const goto = (c: string) => {
    setActiveRel(null);
    setBreadcrumbs((prev) => [...prev, c]);
    setConcept(c);
    fetchEdges.mutate(c);
  };
  const back = () => {
    if (breadcrumbs.length === 0) return;
    const newCrumbs = breadcrumbs.slice(0, -1);
    setBreadcrumbs(newCrumbs);
    const last = newCrumbs[newCrumbs.length - 1] || '';
    setConcept(last);
    if (last) fetchEdges.mutate(last);
    else setEdges([]);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!concept.trim()) return;
    setBreadcrumbs([concept.trim()]);
    fetchEdges.mutate(concept.trim());
  };

  const relationCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) m.set(e.relation, (m.get(e.relation) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [edges]);

  const visibleEdges = activeRel ? edges.filter((e) => e.relation === activeRel) : edges;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Concept Graph</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">conceptnet 5 · open</span>
        </div>
      </header>

      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Concept — dog, kindness, computer, sunset…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none" />
        </div>
        <button type="submit" disabled={!concept.trim() || fetchEdges.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {fetchEdges.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Explore
        </button>
      </form>

      {breadcrumbs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-cyan-500/15 bg-cyan-500/5 p-2">
          <button aria-label="Previous" type="button" onClick={back} disabled={breadcrumbs.length === 0} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"><ChevronLeft className="h-3 w-3" /></button>
          {breadcrumbs.map((c, i) => (
            <span key={`${c}-${i}`} className="flex items-center gap-1 text-[11px] text-zinc-400">
              {i > 0 && <ArrowRight className="h-2.5 w-2.5 text-zinc-600" />}
              <span className={i === breadcrumbs.length - 1 ? 'rounded-full bg-cyan-500/20 px-2 py-0.5 font-mono text-cyan-200' : 'font-mono'}>{c}</span>
            </span>
          ))}
        </div>
      )}

      {edges.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400">Filter by relation:</span>
            <button type="button" onClick={() => setActiveRel(null)} className={`rounded-full border px-2 py-0.5 text-[10px] ${activeRel === null ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'}`}>All ({edges.length})</button>
            {relationCounts.slice(0, 16).map(([rel, count]) => (
              <button key={rel} type="button" onClick={() => setActiveRel(activeRel === rel ? null : rel)} className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${activeRel === rel ? RELATION_COLOR[rel] || RELATION_COLOR.default : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-cyan-500/30'}`}>{rel} ({count})</button>
            ))}
          </div>
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {visibleEdges.map((e, i) => (
                <motion.div key={`${e.relation}-${e.start}-${e.end}-${i}`} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${RELATION_COLOR[e.relation] || RELATION_COLOR.default}`}>{e.relation}</span>
                  <button type="button" onClick={() => goto(e.start)} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-cyan-300 hover:bg-cyan-500/15">{e.start}</button>
                  <ArrowRight className="h-3 w-3 shrink-0 text-zinc-600" />
                  <button type="button" onClick={() => goto(e.end)} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-cyan-300 hover:bg-cyan-500/15">{e.end}</button>
                  <span className="ml-2 font-mono text-[10px] text-zinc-400">w={e.weight.toFixed(2)}</span>
                  <div className="ml-auto">
                    <SaveAsDtuButton
                      compact
                      apiSource="conceptnet"
                      title={e.surfaceText || `${e.start} — ${e.relation} → ${e.end}`}
                      content={[
                        `Assertion: ${e.surfaceText || `${e.start} ${e.relation} ${e.end}`}`,
                        `Relation: ${e.relation}`,
                        `Start: ${e.start} (${e.startConcept || '—'})`,
                        `End: ${e.end} (${e.endConcept || '—'})`,
                        `Weight: ${e.weight}`,
                      ].join('\n')}
                      extraTags={['commonsense', 'conceptnet', e.relation.toLowerCase()]}
                      rawData={e}
                    />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}
