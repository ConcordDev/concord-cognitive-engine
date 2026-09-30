'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Award, Brain, ClipboardCheck, Coins, Dna, ExternalLink, FileCheck, GraduationCap, Hash, Loader2, MessageSquare, Route, Search, Send, Trophy, User, UserPlus, Users, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { GenomeGraph, type GenomeNode, type GenomeEdge } from '@/components/education/GenomeGraph';
import { PathStepCard, type PathStep } from '@/components/education/PathStepCard';

// ═══════════════════════════════════════════════════════════════════

export function PanelShell({ title, subtitle, icon: Icon, accent = 'neon-cyan', children }: {
  title: string; subtitle?: string; icon: React.ComponentType<{ className?: string; size?: number | string }>; accent?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <Icon className={`w-5 h-5 text-${accent}`} />
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

interface GenomeSummary {
  totalKnown?: number;
  totalMastered?: number;
  gapCount?: number;
  strongestDomain?: string;
  velocity?: number;
}

interface GenomeApiResponse {
  ok?: boolean;
  summary?: GenomeSummary;
  nodes?: Array<{ id: string; title?: string; domain?: string; mastery?: number; gap?: boolean; tier?: string }>;
  dtus?: Array<{ id: string; title?: string; domain?: string; mastery?: number }>;
}

interface GenomeGraphApiResponse {
  ok?: boolean;
  nodes?: Array<{ id: string; title?: string; domain?: string; mastery?: number; gap?: boolean }>;
  edges?: Array<{ source: string; target: string }>;
}

export function GenomePanel() {
  const [selectedNode, setSelectedNode] = useState<GenomeNode | null>(null);

  const genomeQuery = useQuery<GenomeApiResponse | null>({
    queryKey: ['learning', 'genome'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/genome');
        return r.data as GenomeApiResponse;
      } catch {
        return null;
      }
    },
  });

  const graphQuery = useQuery<GenomeGraphApiResponse | null>({
    queryKey: ['learning', 'genome', 'graph'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/genome/graph');
        return r.data as GenomeGraphApiResponse;
      } catch {
        return null;
      }
    },
  });

  const summary: GenomeSummary = genomeQuery.data?.summary ?? {};

  const { nodes, edges } = useMemo<{ nodes: GenomeNode[]; edges: GenomeEdge[] }>(() => {
    const graph = graphQuery.data;
    if (graph?.nodes && graph.nodes.length > 0) {
      return {
        nodes: graph.nodes.map(n => ({
          id: n.id,
          title: n.title ?? n.id,
          domain: n.domain,
          mastery: n.mastery ?? 0,
          gap: !!n.gap,
        })),
        edges: graph.edges ?? [],
      };
    }
    // fall back to genome nodes list if graph not available
    const raw = genomeQuery.data?.nodes ?? genomeQuery.data?.dtus ?? [];
    return {
      nodes: raw.map(n => ({
        id: n.id,
        title: n.title ?? n.id,
        domain: n.domain,
        mastery: (n as { mastery?: number }).mastery ?? 0,
        gap: !!(n as { gap?: boolean }).gap,
      })),
      edges: [],
    };
  }, [genomeQuery.data, graphQuery.data]);

  const isLoading = genomeQuery.isLoading || graphQuery.isLoading;

  return (
    <PanelShell title="Knowledge Genome" subtitle="Your intellectual DNA, rendered as a living graph" icon={Dna} accent="neon-cyan">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Known" value={summary.totalKnown ?? nodes.length} />
        <StatCard label="Mastered" value={summary.totalMastered ?? 0} />
        <StatCard label="Gaps" value={summary.gapCount ?? nodes.filter(n => n.gap).length} />
        <StatCard label="Strongest" value={summary.strongestDomain ?? '—'} />
        <StatCard label="Velocity" value={summary.velocity != null ? `${summary.velocity}/wk` : '—'} />
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading genome…</p>}

      <GenomeGraph
        nodes={nodes}
        edges={edges}
        height={440}
        selectedId={selectedNode?.id ?? null}
        onSelect={(n) => setSelectedNode(n)}
      />

      {selectedNode && (
        <div className="mt-3 p-3 bg-lattice-bg border border-neon-cyan/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs text-gray-400 uppercase">Selected DTU</p>
              <p className="text-sm text-white font-medium truncate">{selectedNode.title}</p>
              <p className="text-xs text-gray-400">
                {selectedNode.domain ?? 'unknown domain'}
                {' · '}
                mastery {Math.round((selectedNode.mastery ?? 0) * 100)}%
                {selectedNode.gap && ' · GAP'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              className="text-xs text-gray-400 hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Mastery updates every time you read, cite, create, test, or teach a DTU. Gaps (red) are inferred by the feasibility manifold as pre-requisites for unreachable frontier nodes.
      </p>
    </PanelShell>
  );
}

interface FrontierApiResponse {
  ok?: boolean;
  frontier?: Array<{
    id?: string;
    dtuId?: string;
    title?: string;
    kind?: string;
    domain?: string;
    readiness?: number;
    estimatedMinutes?: number;
    summary?: string;
  }>;
}

interface PathApiResponse {
  ok?: boolean;
  path?: Array<{
    id?: string;
    dtuId?: string;
    title?: string;
    kind?: string;
    domain?: string;
    readiness?: number;
    estimatedMinutes?: number;
    summary?: string;
    order?: number;
  }>;
}

export function LearningPathPanel() {
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState('');
  const [startingId, setStartingId] = useState<string | null>(null);

  const frontierQuery = useQuery<FrontierApiResponse | null>({
    queryKey: ['learning', 'frontier'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/frontier');
        return r.data as FrontierApiResponse;
      } catch {
        return null;
      }
    },
  });

  const pathMutation = useMutation<PathApiResponse, Error, string>({
    mutationFn: async (targetGoal: string) => {
      const r = await api.post('/api/learning/path', { goal: targetGoal });
      return r.data as PathApiResponse;
    },
  });

  const startMutation = useMutation({
    mutationFn: async (step: PathStep) => {
      const dtuId = step.dtuId ?? step.id;
      if (!dtuId) throw new Error('No DTU id on step');
      const r = await api.post('/api/learning/interaction', { dtuId, kind: 'start' });
      return r.data;
    },
    onMutate: (step) => {
      setStartingId(step.dtuId ?? step.id ?? null);
    },
    onSettled: () => {
      setStartingId(null);
      queryClient.invalidateQueries({ queryKey: ['learning', 'genome'] });
    },
  });

  const frontierSteps = useMemo<PathStep[]>(() => {
    const f = frontierQuery.data?.frontier ?? [];
    return f.slice(0, 12).map((s, i) => ({
      id: s.id ?? s.dtuId,
      dtuId: s.dtuId ?? s.id,
      order: i + 1,
      title: s.title ?? (s.id ?? 'Untitled'),
      kind: s.kind ?? 'study',
      domain: s.domain,
      readiness: s.readiness,
      estimatedMinutes: s.estimatedMinutes,
      summary: s.summary,
    }));
  }, [frontierQuery.data]);

  const pathSteps = useMemo<PathStep[]>(() => {
    const p = pathMutation.data?.path ?? [];
    return p.map((s, i) => ({
      id: s.id ?? s.dtuId,
      dtuId: s.dtuId ?? s.id,
      order: s.order ?? i + 1,
      title: s.title ?? (s.id ?? 'Untitled'),
      kind: s.kind ?? 'study',
      domain: s.domain,
      readiness: s.readiness,
      estimatedMinutes: s.estimatedMinutes,
      summary: s.summary,
    }));
  }, [pathMutation.data]);

  return (
    <PanelShell
      title="Learning Path"
      subtitle="Navigate the feasibility manifold — reachable frontier first, full path on demand"
      icon={Route}
      accent="neon-purple"
    >
      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <input
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="Learning goal (e.g. 'understand general relativity')"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="button"
          onClick={() => goal && pathMutation.mutate(goal)}
          disabled={!goal || pathMutation.isPending}
          className="px-4 py-2 bg-neon-purple/20 text-neon-purple border border-neon-purple/30 rounded-lg hover:bg-neon-purple/30 text-sm disabled:opacity-50"
        >
          {pathMutation.isPending ? 'Computing…' : 'Plan Path'}
        </button>
      </div>

      {pathSteps.length > 0 && (
        <div className="mb-6">
          <h4 className="text-xs uppercase tracking-wider text-neon-purple mb-2">Current Path</h4>
          <div className="space-y-2">
            {pathSteps.map(step => (
              <PathStepCard
                key={`${step.order}-${step.id ?? step.title}`}
                step={step}
                starting={startingId === (step.dtuId ?? step.id)}
                onStart={() => startMutation.mutate(step)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs uppercase tracking-wider text-neon-cyan mb-2">Reachable Frontier</h4>
        {frontierQuery.isLoading && <p className="text-sm text-gray-400">Computing frontier…</p>}
        {!frontierQuery.isLoading && frontierSteps.length === 0 && (
          <p className="text-sm text-gray-400">No reachable frontier yet. Start with a core DTU from the Path Planner above.</p>
        )}
        <div className="space-y-2">
          {frontierSteps.map(step => (
            <PathStepCard
              key={`frontier-${step.order}-${step.id ?? step.title}`}
              step={step}
              starting={startingId === (step.dtuId ?? step.id)}
              onStart={() => startMutation.mutate(step)}
            />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

interface CitationDTU {
  id: string;
  title: string;
  domain?: string;
  tier?: string;
}

interface SubmissionResponse {
  ok?: boolean;
  published?: boolean;
  submission?: {
    id?: string;
    claim?: string;
    grade?: number;
    createdAt?: string;
  };
  evaluation?: {
    grade?: number;
    citationIntegrity?: number;
    coherence?: number;
    novelty?: number;
    depth?: number;
    c2Pass?: boolean;
    feedback?: string;
  };
  newDtu?: { id: string };
}

export function ProofByCitationPanel() {
  const queryClient = useQueryClient();
  const [claim, setClaim] = useState('');
  const [selectedCitations, setSelectedCitations] = useState<CitationDTU[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<CitationDTU[]>([]);
  const [searching, setSearching] = useState(false);

  const pastQuery = useQuery<{ submissions?: SubmissionResponse['submission'][] } | null>({
    queryKey: ['learning', 'submissions', 'mine'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/submissions/mine');
        return r.data as { submissions?: SubmissionResponse['submission'][] };
      } catch {
        return null;
      }
    },
  });

  const searchCitations = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await api.get('/api/learning/dtus/search', { params: { q } });
      const payload = r.data as { dtus?: CitationDTU[]; results?: CitationDTU[] };
      setSearchResults(payload.dtus ?? payload.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchCitations(search), 280);
    return () => clearTimeout(t);
  }, [search, searchCitations]);

  const submit = useMutation<SubmissionResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.post('/api/learning/submit', {
        claim,
        citations: selectedCitations.map(c => c.id),
      });
      return r.data as SubmissionResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning', 'submissions', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['learning', 'genome'] });
    },
  });

  const addCitation = (c: CitationDTU) => {
    if (!selectedCitations.some(s => s.id === c.id)) {
      setSelectedCitations([...selectedCitations, c]);
    }
    setSearch('');
    setSearchResults([]);
  };

  const removeCitation = (id: string) => {
    setSelectedCitations(selectedCitations.filter(c => c.id !== id));
  };

  const evaluation = submit.data?.evaluation;

  return (
    <PanelShell title="Proof by Citation" subtitle="Prove understanding by citing DTU evidence — passing submissions become new DTUs" icon={FileCheck} accent="neon-pink">
      <div className="space-y-4">
        <div>
          <label className="text-xs uppercase text-gray-400 mb-1 block">Your Claim</label>
          <textarea
            value={claim}
            onChange={e => setClaim(e.target.value)}
            placeholder="Articulate a non-trivial synthesis or argument…"
            className="w-full p-3 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
            rows={4}
          />
        </div>

        <div>
          <label className="text-xs uppercase text-gray-400 mb-1 block">Citations</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {selectedCitations.map(c => (
              <span
                key={c.id}
                className="flex items-center gap-1 px-2 py-1 bg-neon-pink/10 border border-neon-pink/30 text-neon-pink rounded-full text-xs"
              >
                {c.title}
                <button type="button" onClick={() => removeCitation(c.id)} className="hover:text-white" aria-label="Close">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {selectedCitations.length === 0 && (
              <span className="text-xs text-gray-400">No citations yet. Search to add DTUs.</span>
            )}
          </div>
          <div className="relative">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search DTUs to cite…"
              className="w-full p-2 pl-8 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
            />
            <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            {searching && <Loader2 className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 animate-spin" />}
            {searchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-lattice-deep border border-lattice-border rounded-lg max-h-48 overflow-auto">
                {searchResults.map(r => (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => addCitation(r)}
                    className="w-full text-left px-3 py-2 hover:bg-lattice-surface text-sm text-white border-b border-lattice-border last:border-0"
                  >
                    <div className="truncate">{r.title}</div>
                    <div className="text-xs text-gray-400">{r.domain ?? 'unknown'}{r.tier ? ` · ${r.tier}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => submit.mutate()}
          disabled={!claim || selectedCitations.length === 0 || submit.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-neon-pink/20 text-neon-pink border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 text-sm disabled:opacity-50"
        >
          {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {submit.isPending ? 'Evaluating…' : 'Submit for Evaluation'}
        </button>

        {evaluation && (
          <div className="p-4 bg-lattice-deep border border-lattice-border rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase text-gray-400">Evaluation</span>
              <span className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded',
                evaluation.c2Pass ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400',
              )}>
                {evaluation.c2Pass ? 'C2 PASS' : 'C2 FAIL'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <MetricBar label="Integrity" value={evaluation.citationIntegrity ?? 0} color="text-neon-cyan" />
              <MetricBar label="Coherence" value={evaluation.coherence ?? 0} color="text-neon-purple" />
              <MetricBar label="Novelty" value={evaluation.novelty ?? 0} color="text-neon-pink" />
              <MetricBar label="Depth" value={evaluation.depth ?? 0} color="text-amber-400" />
            </div>
            <div className="text-lg font-semibold text-white">
              Grade: {Math.round((evaluation.grade ?? 0) * 100)}%
            </div>
            {submit.data?.published && (
              <div className="text-xs text-emerald-400">Published as new DTU {submit.data.newDtu?.id ?? ''}</div>
            )}
            {evaluation.feedback && (
              <div className="text-xs text-gray-400 whitespace-pre-wrap border-t border-lattice-border pt-2">{evaluation.feedback}</div>
            )}
          </div>
        )}

        <div>
          <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Past Submissions</h4>
          {pastQuery.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
          {pastQuery.data?.submissions && pastQuery.data.submissions.length > 0 ? (
            <div className="space-y-2">
              {pastQuery.data.submissions.slice(0, 8).map((s, i) => (
                <div key={s?.id ?? i} className="p-3 bg-lattice-deep border border-lattice-border rounded-lg text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-white truncate">{s?.claim ?? 'Untitled submission'}</p>
                    <span className="text-xs text-gray-400 shrink-0">
                      {Math.round((s?.grade ?? 0) * 100)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No submissions yet.</p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

export function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-gray-400 uppercase text-[10px]">{label}</span>
        <span className={cn('text-[10px]', color)}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-lattice-bg rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color.replace('text-', 'bg-'))} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface TutorMessage {
  role: 'user' | 'tutor';
  text: string;
  citations?: Array<{ id: string; title?: string }>;
  socratic?: boolean;
}

interface TutorApiResponse {
  response?: string;
  answer?: string;
  citations?: Array<{ id: string; title?: string }>;
}

export function TutorPanel() {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('general');
  const [socratic, setSocratic] = useState(false);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const ask = useMutation<TutorApiResponse, Error, string>({
    mutationFn: async (q: string) => {
      const url = socratic ? '/api/learning/tutor/socratic' : '/api/learning/tutor/ask';
      const r = await api.post(url, { query: q, domain });
      return r.data as TutorApiResponse;
    },
    onSuccess: (res) => {
      setMessages(prev => [
        ...prev,
        {
          role: 'tutor',
          text: res.response ?? res.answer ?? '(no response)',
          citations: res.citations ?? [],
          socratic,
        },
      ]);
    },
    onError: (err) => {
      setMessages(prev => [
        ...prev,
        { role: 'tutor', text: `Tutor unavailable: ${err.message}` },
      ]);
    },
  });

  const submit = () => {
    if (!query.trim()) return;
    const q = query.trim();
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setQuery('');
    ask.mutate(q);
  };

  return (
    <PanelShell
      title="Entity Tutor"
      subtitle="AI mentors per domain — every answer is cited to DTU evidence"
      icon={GraduationCap}
      accent="neon-cyan"
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={domain}
          onChange={e => setDomain(e.target.value)}
          className="p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        >
          <option value="general">General</option>
          <option value="math">Math</option>
          <option value="physics">Physics</option>
          <option value="code">Code</option>
          <option value="philosophy">Philosophy</option>
          <option value="history">History</option>
          <option value="biology">Biology</option>
          <option value="art">Art</option>
        </select>
        <button
          type="button"
          onClick={() => setSocratic(!socratic)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
            socratic
              ? 'bg-neon-purple/20 text-neon-purple border-neon-purple/30'
              : 'bg-lattice-deep text-gray-400 border-lattice-border',
          )}
        >
          <Brain className="w-4 h-4" />
          Socratic Mode {socratic ? 'ON' : 'OFF'}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="h-72 overflow-y-auto bg-lattice-deep border border-lattice-border rounded-lg p-3 space-y-3 mb-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">Ask your domain tutor anything. In Socratic mode, the tutor asks back instead of telling.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'rounded-lg p-3 text-sm',
              m.role === 'user'
                ? 'bg-neon-cyan/10 border border-neon-cyan/30 text-white ml-8'
                : 'bg-lattice-surface border border-lattice-border text-gray-200 mr-8',
            )}
          >
            <div className="flex items-center gap-1 mb-1 text-[10px] uppercase tracking-wider text-gray-400">
              {m.role === 'user' ? <User className="w-3 h-3" /> : <GraduationCap className="w-3 h-3" />}
              {m.role}
              {m.socratic && <span className="text-neon-purple">· socratic</span>}
            </div>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.citations && m.citations.length > 0 && (
              <div className="mt-2 pt-2 border-t border-lattice-border">
                <p className="text-[10px] uppercase text-gray-400 mb-1">Cited DTUs</p>
                <div className="flex flex-wrap gap-1">
                  {m.citations.map(c => (
                    <span key={c.id} className="text-[10px] px-1.5 py-0.5 bg-neon-cyan/10 text-neon-cyan rounded">
                      {c.title ?? c.id}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {ask.isPending && (
          <div className="text-xs text-gray-400 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> tutor thinking…
          </div>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); submit(); }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Ask your tutor…"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="submit"
          disabled={!query || ask.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded-lg text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <Send className="w-4 h-4" />
          Ask
        </button>
      </form>
    </PanelShell>
  );
}

interface CohortMember {
  id: string;
  name?: string;
  mastery?: number;
}

interface Cohort {
  id: string;
  name?: string;
  domain?: string;
  members?: CohortMember[];
}

interface CohortApiResponse {
  ok?: boolean;
  cohorts?: Cohort[];
}

export function CohortPanel() {
  const queryClient = useQueryClient();
  const [newCohortDomain, setNewCohortDomain] = useState('');
  const [newCohortName, setNewCohortName] = useState('');

  const mineQuery = useQuery<CohortApiResponse | null>({
    queryKey: ['learning', 'cohort', 'mine'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/cohort/mine');
        return r.data as CohortApiResponse;
      } catch {
        return null;
      }
    },
  });

  const matchQuery = useQuery<CohortApiResponse | null>({
    queryKey: ['learning', 'cohort', 'match'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/cohort/match');
        return r.data as CohortApiResponse;
      } catch {
        return null;
      }
    },
  });

  const formCohort = useMutation({
    mutationFn: async () => {
      const r = await api.post('/api/learning/cohort/form', {
        name: newCohortName,
        domain: newCohortDomain,
      });
      return r.data;
    },
    onSuccess: () => {
      setNewCohortDomain('');
      setNewCohortName('');
      queryClient.invalidateQueries({ queryKey: ['learning', 'cohort'] });
    },
  });

  const peerTeach = useMutation({
    mutationFn: async (payload: { cohortId: string; peerId: string }) => {
      const r = await api.post('/api/learning/cohort/teach', payload);
      return r.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning', 'earnings'] });
    },
  });

  const myCohorts = mineQuery.data?.cohorts ?? [];
  const matches = matchQuery.data?.cohorts ?? [];

  return (
    <PanelShell title="Learning Cohorts" subtitle="Peer-matched learning groups — teach to earn" icon={Users} accent="neon-purple">
      <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg mb-4">
        <h4 className="text-xs uppercase text-neon-purple mb-2">Form a Cohort</h4>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={newCohortName}
            onChange={e => setNewCohortName(e.target.value)}
            placeholder="Cohort name"
            className="flex-1 p-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
          />
          <input
            value={newCohortDomain}
            onChange={e => setNewCohortDomain(e.target.value)}
            placeholder="Domain"
            className="flex-1 p-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
          />
          <button
            type="button"
            onClick={() => formCohort.mutate()}
            disabled={!newCohortName || !newCohortDomain || formCohort.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-neon-purple/20 text-neon-purple border border-neon-purple/30 rounded-lg text-sm disabled:opacity-50"
          >
            <UserPlus className="w-4 h-4" /> Form
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs uppercase text-neon-cyan mb-2">My Cohorts</h4>
          {mineQuery.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
          {!mineQuery.isLoading && myCohorts.length === 0 && (
            <p className="text-sm text-gray-400">No cohorts yet. Form one above.</p>
          )}
          <div className="space-y-2">
            {myCohorts.map(c => (
              <div key={c.id} className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm text-white">{c.name ?? `Cohort ${c.id}`}</p>
                    <p className="text-xs text-gray-400">{c.domain ?? 'mixed'} · {(c.members ?? []).length} members</p>
                  </div>
                </div>
                {(c.members ?? []).slice(0, 5).map(m => (
                  <div key={m.id} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-gray-300 truncate">{m.name ?? m.id}</span>
                    <button
                      type="button"
                      onClick={() => peerTeach.mutate({ cohortId: c.id, peerId: m.id })}
                      disabled={peerTeach.isPending}
                      className="px-2 py-0.5 bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 rounded text-[10px] hover:bg-neon-cyan/20 disabled:opacity-50"
                    >
                      <MessageSquare className="w-3 h-3 inline mr-0.5" /> Teach
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs uppercase text-neon-pink mb-2">Matching Your Genome</h4>
          {matchQuery.isLoading && <p className="text-sm text-gray-400">Finding matches…</p>}
          {!matchQuery.isLoading && matches.length === 0 && (
            <p className="text-sm text-gray-400">No match suggestions yet.</p>
          )}
          <div className="space-y-2">
            {matches.map(c => (
              <div key={c.id} className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
                <p className="text-sm text-white">{c.name ?? `Cohort ${c.id}`}</p>
                <p className="text-xs text-gray-400">{c.domain ?? 'mixed'} · {(c.members ?? []).length} members</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

type AssessmentQuestionType = 'synthesis' | 'application' | 'contradiction' | 'gap';

interface AssessmentQuestion {
  id: string;
  type: AssessmentQuestionType | string;
  prompt: string;
}

interface AssessmentApiResponse {
  ok?: boolean;
  assessmentId?: string;
  questions?: AssessmentQuestion[];
}

interface AssessmentGradeResponse {
  ok?: boolean;
  grades?: Array<{ questionId: string; score: number; feedback?: string }>;
  overall?: number;
}

const QUESTION_TYPE_META: Record<string, { color: string; label: string }> = {
  synthesis: { color: 'text-neon-cyan', label: 'Synthesis' },
  application: { color: 'text-neon-purple', label: 'Application' },
  contradiction: { color: 'text-neon-pink', label: 'Contradiction' },
  gap: { color: 'text-amber-400', label: 'Gap' },
};

export function AssessmentPanel() {
  const [domain, setDomain] = useState('general');
  const [responses, setResponses] = useState<Record<string, string>>({});

  const gen = useMutation<AssessmentApiResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.post('/api/learning/assessment/generate', { domain });
      return r.data as AssessmentApiResponse;
    },
    onSuccess: () => setResponses({}),
  });

  const grade = useMutation<AssessmentGradeResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.post('/api/learning/assessment/grade', {
        assessmentId: gen.data?.assessmentId,
        responses: Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer })),
      });
      return r.data as AssessmentGradeResponse;
    },
  });

  const questions = gen.data?.questions ?? [];

  return (
    <PanelShell title="STSVK Assessment" subtitle="Ungameable tests — synthesis, not recall" icon={ClipboardCheck} accent="neon-pink">
      <div className="flex gap-2 mb-4">
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="Domain (e.g. math, code, philosophy)"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="button"
          onClick={() => gen.mutate()}
          disabled={gen.isPending || !domain}
          className="px-4 py-2 bg-neon-pink/20 text-neon-pink border border-neon-pink/30 rounded-lg text-sm disabled:opacity-50"
        >
          {gen.isPending ? 'Generating…' : 'Generate Assessment'}
        </button>
      </div>

      {questions.length > 0 && (
        <div className="space-y-3">
          {questions.map((q, i) => {
            const meta = QUESTION_TYPE_META[q.type as string] ?? { color: 'text-gray-400', label: String(q.type) };
            const gradeItem = grade.data?.grades?.find(g => g.questionId === q.id);
            return (
              <div key={q.id ?? i} className="p-4 bg-lattice-deep border border-lattice-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] uppercase text-gray-400">Q{i + 1}</span>
                  <span className={cn('text-[10px] uppercase font-semibold', meta.color)}>{meta.label}</span>
                </div>
                <p className="text-sm text-white mb-3">{q.prompt}</p>
                <textarea
                  value={responses[q.id] ?? ''}
                  onChange={e => setResponses({ ...responses, [q.id]: e.target.value })}
                  placeholder="Your response…"
                  rows={3}
                  className="w-full p-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
                  disabled={!!grade.data}
                />
                {gradeItem && (
                  <div className="mt-2 p-2 bg-lattice-surface border border-lattice-border rounded text-xs">
                    <span className="text-neon-cyan">Score: {Math.round(gradeItem.score * 100)}%</span>
                    {gradeItem.feedback && <p className="text-gray-400 mt-1">{gradeItem.feedback}</p>}
                  </div>
                )}
              </div>
            );
          })}

          {!grade.data && (
            <button
              type="button"
              onClick={() => grade.mutate()}
              disabled={grade.isPending || Object.keys(responses).length === 0}
              className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded-lg text-sm disabled:opacity-50"
            >
              {grade.isPending ? 'Grading…' : 'Submit Responses'}
            </button>
          )}

          {grade.data?.overall != null && (
            <div className="p-3 bg-neon-pink/10 border border-neon-pink/30 rounded-lg text-center">
              <p className="text-xs text-gray-400 uppercase">Overall</p>
              <p className="text-2xl font-bold text-neon-pink">{Math.round((grade.data.overall ?? 0) * 100)}%</p>
            </div>
          )}
        </div>
      )}

      {!gen.data && (
        <p className="text-xs text-gray-400">Generate an assessment to see 4 question types — synthesis, application, contradiction, and gap.</p>
      )}
    </PanelShell>
  );
}

interface CredentialMetrics {
  dtusStudied?: number;
  dtusMastered?: number;
  dtusCreated?: number;
  timesTaught?: number;
  averageMastery?: number;
  citationsReceived?: number;
}

interface CredentialApiResponse {
  ok?: boolean;
  credential?: {
    credentialId?: string;
    studentId?: string;
    domain?: string;
    issuedAt?: string;
    hash?: string;
    verifyUrl?: string;
    metrics?: CredentialMetrics;
  };
}

const METRIC_LABELS: Record<keyof CredentialMetrics, string> = {
  dtusStudied: 'DTUs Studied',
  dtusMastered: 'DTUs Mastered',
  dtusCreated: 'DTUs Created',
  timesTaught: 'Times Taught',
  averageMastery: 'Avg Mastery',
  citationsReceived: 'Citations Recv.',
};

export function CredentialsPanel() {
  const [domain, setDomain] = useState('general');

  const issue = useMutation<CredentialApiResponse, Error, void>({
    mutationFn: async () => {
      const r = await api.get(`/api/learning/credential/me/${encodeURIComponent(domain)}`);
      return r.data as CredentialApiResponse;
    },
  });

  const credential = issue.data?.credential;
  const metrics = credential?.metrics ?? {};

  return (
    <PanelShell title="Credential Genome" subtitle="Living, verifiable proof of understanding" icon={Award} accent="neon-cyan">
      <div className="flex gap-2 mb-4">
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="Domain"
          className="flex-1 p-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white"
        />
        <button
          type="button"
          onClick={() => issue.mutate()}
          disabled={issue.isPending || !domain}
          className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded-lg text-sm disabled:opacity-50"
        >
          <Award className="w-4 h-4" />
          {issue.isPending ? 'Generating…' : 'Generate Credential'}
        </button>
      </div>

      {issue.isError && (
        <p className="text-sm text-amber-400">Credential unavailable for this domain yet.</p>
      )}

      {credential && (
        <div className="p-4 bg-gradient-to-br from-cyan-500/10 to-purple-500/5 border border-neon-cyan/30 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-neon-cyan">Verifiable Credential</p>
              <p className="text-sm text-white font-mono">{credential.credentialId ?? '—'}</p>
            </div>
            <Award className="w-8 h-8 text-neon-cyan" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {(Object.keys(METRIC_LABELS) as Array<keyof CredentialMetrics>).map(key => {
              const raw = metrics[key];
              const display = raw == null ? '—' : key === 'averageMastery' ? `${Math.round((raw as number) * 100)}%` : String(raw);
              return (
                <div key={key} className="p-2 bg-lattice-deep border border-lattice-border rounded-lg">
                  <p className="text-[10px] uppercase text-gray-400">{METRIC_LABELS[key]}</p>
                  <p className="text-sm text-white font-semibold">{display}</p>
                </div>
              );
            })}
          </div>
          {credential.hash && (
            <div className="pt-2 border-t border-lattice-border text-xs">
              <p className="text-gray-400 uppercase text-[10px]">Hash</p>
              <p className="text-neon-purple font-mono truncate">{credential.hash}</p>
            </div>
          )}
          {credential.verifyUrl && (
            <a
              href={credential.verifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-neon-cyan hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> Verify this credential
            </a>
          )}
        </div>
      )}
    </PanelShell>
  );
}

interface EarningsApiResponse {
  ok?: boolean;
  earnings?: {
    total?: number;
    count?: number;
    teachCount?: number;
    citationCount?: number;
    byAction?: Record<string, number>;
  };
}

interface LeaderboardEntry {
  rank?: number;
  userId?: string;
  name?: string;
  total?: number;
}

interface LeaderboardApiResponse {
  ok?: boolean;
  leaderboard?: LeaderboardEntry[];
}

interface RatesApiResponse {
  ok?: boolean;
  rates?: {
    earning?: Record<string, number>;
  };
}

export function EarningsPanel() {
  const earningsQuery = useQuery<EarningsApiResponse | null>({
    queryKey: ['learning', 'earnings'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/earnings/me');
        return r.data as EarningsApiResponse;
      } catch {
        return null;
      }
    },
  });

  const leaderboardQuery = useQuery<LeaderboardApiResponse | null>({
    queryKey: ['learning', 'leaderboard'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/leaderboard');
        return r.data as LeaderboardApiResponse;
      } catch {
        return null;
      }
    },
  });

  const ratesQuery = useQuery<RatesApiResponse | null>({
    queryKey: ['learning', 'rates'],
    queryFn: async () => {
      try {
        const r = await api.get('/api/learning/rates');
        return r.data as RatesApiResponse;
      } catch {
        return null;
      }
    },
  });

  const earnings = earningsQuery.data?.earnings;
  const byAction = earnings?.byAction ?? {};

  return (
    <PanelShell title="Education Earnings" subtitle="Learn free. Teaching earns." icon={Coins} accent="neon-purple">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total CC" value={earnings?.total ?? 0} />
        <StatCard label="Events" value={earnings?.count ?? 0} />
        <StatCard label="Taught" value={earnings?.teachCount ?? 0} />
        <StatCard label="Citations" value={earnings?.citationCount ?? 0} />
      </div>

      {Object.keys(byAction).length > 0 && (
        <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg mb-4">
          <p className="text-xs text-gray-400 uppercase mb-2">Earnings by Action</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-xs">
            {Object.entries(byAction).map(([action, value]) => (
              <div key={action} className="flex justify-between bg-lattice-surface rounded px-2 py-1">
                <span className="text-gray-400">{action}</span>
                <span className="text-neon-cyan">{value} CC</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            <p className="text-xs text-gray-400 uppercase">Leaderboard</p>
          </div>
          {leaderboardQuery.isLoading && <p className="text-xs text-gray-400">Loading…</p>}
          {!leaderboardQuery.isLoading && (leaderboardQuery.data?.leaderboard ?? []).length === 0 && (
            <p className="text-xs text-gray-400">No leaderboard data yet.</p>
          )}
          <div className="space-y-1">
            {(leaderboardQuery.data?.leaderboard ?? []).slice(0, 10).map((entry, i) => (
              <div key={entry.userId ?? i} className="flex items-center justify-between text-xs">
                <span className="text-gray-400">#{entry.rank ?? i + 1}</span>
                <span className="flex-1 mx-2 text-white truncate">{entry.name ?? entry.userId ?? '—'}</span>
                <span className="text-neon-cyan">{entry.total ?? 0} CC</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="w-4 h-4 text-neon-cyan" />
            <p className="text-xs text-gray-400 uppercase">Rate Card</p>
          </div>
          {ratesQuery.data?.rates?.earning ? (
            <div className="grid grid-cols-1 gap-1 text-xs">
              {Object.entries(ratesQuery.data.rates.earning).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-gray-400">{k}</span>
                  <span className="text-neon-cyan">+{v} CC</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Rates unavailable.</p>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 bg-lattice-deep border border-lattice-border rounded-lg">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-semibold text-white mt-1">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Khan / Coursera-parity workbench section                            */
/* ------------------------------------------------------------------ */

