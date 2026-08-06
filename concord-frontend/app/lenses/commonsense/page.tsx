'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConceptExplorer } from '@/components/commonsense/ConceptExplorer';
import { CommonsenseActionPanel } from '@/components/commonsense/CommonsenseActionPanel';
import { KnowledgeBaseWorkbench } from '@/components/commonsense/KnowledgeBaseWorkbench';
import { PipingProvider } from '@/components/panel-polish';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import {
  Lightbulb, Plus, Search, Database, ArrowRight, Brain,
  X, RefreshCw,
  Tag, Copy, BarChart3, Network, Eye, CheckCircle2, Shield,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface Fact {
  id?: string;
  subject: string;
  relation: string;
  object: string;
  confidence?: number;
  source?: string;
  createdAt?: string;
}

type ViewMode = 'list' | 'graph' | 'stats';
type SortMode = 'newest' | 'alphabetical' | 'confidence' | 'relation';

const RELATION_COLORS: Record<string, string> = {
  is_a: 'text-neon-blue',
  has_property: 'text-neon-green',
  part_of: 'text-neon-purple',
  used_for: 'text-neon-yellow',
  causes: 'text-neon-orange',
  capable_of: 'text-neon-cyan',
  located_at: 'text-neon-pink',
};

export default function CommonsenseLensPage() {
  useLensCommand(
    [
      { id: "commonsense-list", keys: "v", description: "View list", category: "view", action: () => setViewMode("list") },
      { id: "commonsense-grid", keys: "g", description: "View grid", category: "view", action: () => setViewMode("graph") },
      { id: "commonsense-newest", keys: "n", description: "Sort newest", category: "view", action: () => setSortMode("newest") },
      { id: "commonsense-oldest", keys: "o", description: "Sort alphabetical", category: "view", action: () => setSortMode("alphabetical") },
    ],
    { lensId: "commonsense" }
  );

  const viewLog = useArtifacts<{ at: string }>('commonsense', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('commonsense');
  void viewLog; void recordView;
  useLensNav('commonsense');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('commonsense');

  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [relation, setRelation] = useState('is_a');
  const [object, setObject] = useState('');
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [searchFilter, setSearchFilter] = useState('');
  const [relationFilter, setRelationFilter] = useState<string>('all');
  const [selectedFact, setSelectedFact] = useState<Fact | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // --- Lens Bridge ---
  const bridge = useLensBridge('commonsense', 'fact');

  // Facts + the "Inferences" count come from the SAME per-user
  // subject-relation-object fact store the Knowledge Base Workbench /
  // Concept Explorer / Action Panel below operate on
  // (server/domains/commonsense.js factList/inferChain) — deliberately NOT
  // the separate sentence-shaped `/api/commonsense/*` cognitive-axiom
  // substrate (server.js `ensureCommonsenseSubstrate`), whose facts carry
  // `{ fact, category }` and no subject/relation/object. Reading that store
  // here used to silently fork the "one knowledge base" this page presents
  // into two disconnected stores and crash the list/graph/stats render
  // (`f.relation.replace` on an undefined `relation`) the moment the
  // (auto-seeded) axiom store had any rows — which it always does.
  const { data: factsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['commonsense-facts'],
    queryFn: async () => {
      const r = await lensRun<{ facts: Fact[] }>('commonsense', 'factList', {});
      if (!r.data.ok) throw new Error(r.data.error || 'Failed to load facts');
      return r.data.result;
    },
    refetchInterval: 30_000,
  });

  const { data: inferData, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['commonsense-infer-count'],
    queryFn: async () => {
      const r = await lensRun<{ count: number }>('commonsense', 'inferChain', {});
      if (!r.data.ok) throw new Error(r.data.error || 'Failed to derive inferences');
      return r.data.result;
    },
    refetchInterval: 30_000,
  });

  const addFact = useMutation({
    mutationFn: async () => {
      const r = await lensRun('commonsense', 'factAdd', { subject, relation, object });
      if (!r.data.ok) throw new Error(r.data.error || 'Failed to add fact');
      return r.data.result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commonsense-facts'] });
      queryClient.invalidateQueries({ queryKey: ['commonsense-infer-count'] });
      setSubject('');
      setObject('');
      setShowAddForm(false);
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const queryFacts = useMutation({
    mutationFn: () => apiHelpers.commonsense.query({ query: queryText }),
    onSuccess: (res) => setResults(res.data),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const rawFacts: Fact[] = useMemo(() => {
    const f = factsData?.facts || [];
    return Array.isArray(f) ? f : [];
  }, [factsData]);

  const inferenceCount = inferData?.count ?? 0;

  // Filtered and sorted facts
  const filteredFacts = useMemo(() => {
    let list = [...rawFacts];

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter(
        (f) =>
          f.subject.toLowerCase().includes(q) ||
          f.object.toLowerCase().includes(q) ||
          f.relation.toLowerCase().includes(q)
      );
    }

    if (relationFilter !== 'all') {
      list = list.filter((f) => f.relation === relationFilter);
    }

    switch (sortMode) {
      case 'alphabetical':
        list.sort((a, b) => a.subject.localeCompare(b.subject));
        break;
      case 'confidence':
        list.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        break;
      case 'relation':
        list.sort((a, b) => a.relation.localeCompare(b.relation));
        break;
      default:
        list.reverse(); // newest first (assume appended)
    }

    return list;
  }, [rawFacts, searchFilter, relationFilter, sortMode]);

  // Relation distribution for stats view
  const relationStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of rawFacts) {
      counts[f.relation] = (counts[f.relation] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([rel, count]) => ({ relation: rel, count, pct: rawFacts.length > 0 ? (count / rawFacts.length) * 100 : 0 }));
  }, [rawFacts]);

  // Top subjects for stats
  const topSubjects = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of rawFacts) {
      counts[f.subject] = (counts[f.subject] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([subj, count]) => ({ subject: subj, count }));
  }, [rawFacts]);

  // Bridge commonsense facts into lens artifacts
  useEffect(() => {
    bridge.syncList(rawFacts, (f) => {
      const fact = f as Record<string, unknown>;
      return { title: `${fact.subject} ${fact.relation} ${fact.object}`, data: fact };
    });
  }, [rawFacts, bridge]);

  const handleCopyFact = useCallback((f: Fact) => {
    const text = `${f.subject} ${f.relation} ${f.object}`;
    navigator.clipboard?.writeText(text);
    setCopiedId(f.id || text);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const relations = ['is_a', 'has_property', 'part_of', 'used_for', 'causes', 'capable_of', 'located_at'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-yellow border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading commonsense knowledge...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }

  return (
    <LensShell lensId="commonsense" asMain={false}>
      <FirstRunTour lensId="commonsense" />
      <ManifestActionBar />
      <DepthBadge lensId="commonsense" size="sm" className="ml-2" />
    <div data-lens-theme="commonsense" className="p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Lightbulb className="w-7 h-7 text-neon-yellow" />
          <div>
            <h1 className="text-xl font-bold">Commonsense Lens</h1>
            <p className="text-sm text-gray-400">
              Knowledge base — facts, relations, and everyday reasoning
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="commonsense" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { refetch(); refetch2(); }}
            className="p-2 rounded-lg text-gray-400 hover:text-neon-yellow hover:bg-lattice-elevated transition-colors"
          aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddForm((s) => !s)}
            className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors ${
              showAddForm ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-400 hover:text-white'
            }`}
          >
            <Plus className="w-4 h-4" />
            Add Fact
          </button>
        </div>
      </header>

      {/* AI Actions */}

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Database className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{rawFacts.length}</p>
            <p className="text-xs text-gray-400">Facts Cataloged</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{rawFacts.length > 0 ? `${((rawFacts.filter(f => (f.confidence ?? 1) > 0.7).length / rawFacts.length) * 100).toFixed(0)}%` : '0%'}</p>
            <p className="text-xs text-gray-400">Verification Rate</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Shield className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{relationStats.length}</p>
            <p className="text-xs text-gray-400">Categories</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Brain className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{topSubjects.length}</p>
            <p className="text-xs text-gray-400">Unique Subjects</p>
          </div>
        </motion.div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Database className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{rawFacts.length}</p>
          <p className="text-sm text-gray-400">Facts</p>
        </div>
        <div className="lens-card">
          <Network className="w-5 h-5 text-neon-yellow mb-2" />
          <p className="text-2xl font-bold">{relationStats.length}</p>
          <p className="text-sm text-gray-400">Relation Types</p>
        </div>
        <div className="lens-card">
          <Brain className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{inferenceCount}</p>
          <p className="text-sm text-gray-400">Inferences</p>
        </div>
        <div className="lens-card">
          <Tag className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{topSubjects.length}</p>
          <p className="text-sm text-gray-400">Unique Subjects</p>
        </div>
      </div>

      {/* Add Fact Form (collapsible) */}
      {showAddForm && (
        <div className="panel p-4 space-y-3 border border-neon-purple/20">
          <h2 className="font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4 text-neon-purple" /> Add New Fact
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject (e.g., 'dog')" className="input-lattice w-full"
            />
            <select value={relation} onChange={(e) => setRelation(e.target.value)} className="input-lattice w-full">
              {relations.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
            <input
              type="text" value={object} onChange={(e) => setObject(e.target.value)}
              placeholder="Object (e.g., 'animal')" className="input-lattice w-full"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddForm(false)} className="px-3 py-2 text-sm text-gray-400 hover:text-white">
              Cancel
            </button>
            <button
              onClick={() => addFact.mutate()}
              disabled={!subject || !object || addFact.isPending}
              className="btn-neon purple"
            >
              {addFact.isPending ? 'Adding...' : 'Add Fact'}
            </button>
          </div>
        </div>
      )}

      {/* View Mode Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1">
          {([
            { id: 'list' as ViewMode, label: 'List', icon: Database },
            { id: 'graph' as ViewMode, label: 'Graph', icon: Network },
            { id: 'stats' as ViewMode, label: 'Stats', icon: BarChart3 },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors ${
                viewMode === id ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter facts..." className="input-lattice w-full pl-10 pr-10"
          />
          {searchFilter && (
            <button onClick={() => setSearchFilter('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <select value={relationFilter} onChange={(e) => setRelationFilter(e.target.value)}
            className="input-lattice text-xs py-1">
            <option value="all">All relations</option>
            {relations.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="input-lattice text-xs py-1">
            <option value="newest">Newest</option>
            <option value="alphabetical">A-Z</option>
            <option value="confidence">Confidence</option>
            <option value="relation">By Relation</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Query Panel */}
          <div className="panel p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Search className="w-4 h-4 text-neon-cyan" /> Ask the Built-in Commonsense Base
            </h2>
            <p className="text-[11px] text-gray-500 -mt-1">
              Free-text search over general physical / temporal / social / causal axioms —
              a separate reference base from the fact triples you catalog below.
            </p>
            <div className="flex gap-2">
              <input
                type="text" value={queryText} onChange={(e) => setQueryText(e.target.value)}
                placeholder="Ask a commonsense question..."
                className="input-lattice flex-1"
                onKeyDown={(e) => e.key === 'Enter' && queryText && queryFacts.mutate()}
              />
              <button
                onClick={() => queryFacts.mutate()}
                disabled={!queryText || queryFacts.isPending}
                className="btn-neon shrink-0"
              >
                {queryFacts.isPending ? 'Querying...' : 'Query'}
              </button>
            </div>
            {results !== null && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1">
                    <ArrowRight className="w-3 h-3 text-neon-green" /> Results
                  </h3>
                  <button onClick={() => setResults(null)} className="text-xs text-gray-400 hover:text-white">
                    Clear
                  </button>
                </div>
                {(() => {
                  const qr = results as { ok?: boolean; results?: { id: string; fact: string; category: string; confidence: number; relevance: number }[]; query?: string } | null;
                  const facts = qr?.results || [];
                  if (facts.length === 0) {
                    return <p className="text-xs text-gray-400 italic">No matching facts found.</p>;
                  }
                  return (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {facts.map((f) => (
                        <div key={f.id} className="flex items-start gap-2 bg-lattice-surface rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-200 leading-relaxed">{f.fact}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 capitalize">{f.category}</span>
                              <span className="text-[10px] text-gray-400">conf: <span className="text-gray-400 font-mono">{(f.confidence * 100).toFixed(0)}%</span></span>
                              <span className="text-[10px] text-gray-400">rel: <span className="text-neon-green font-mono">{(f.relevance * 100).toFixed(0)}%</span></span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* List View */}
          {viewMode === 'list' && (
            <div className="space-y-1">
              <div className="text-xs text-gray-400 mb-2">
                {filteredFacts.length} fact{filteredFacts.length !== 1 ? 's' : ''}
                {searchFilter && ` matching "${searchFilter}"`}
              </div>
              {filteredFacts.length === 0 ? (
                <div className="panel p-8 text-center text-gray-400">
                  <Database className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p>No facts match your filters</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-[600px] overflow-y-auto">
                  {filteredFacts.map((f, i) => {
                    const key = f.id || `${f.subject}-${f.relation}-${f.object}-${i}`;
                    const isCopied = copiedId === (f.id || `${f.subject} ${f.relation} ${f.object}`);
                    const isSelected = selectedFact === f;
                    return (
                      <motion.div
                        key={key}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                          isSelected ? 'bg-neon-blue/10 border border-neon-blue/20' : 'hover:bg-lattice-elevated'
                        }`}
                        onClick={() => setSelectedFact(isSelected ? null : f)}
                      >
                        <span className={`text-sm font-medium ${RELATION_COLORS[f.relation] || 'text-gray-400'}`}>
                          {f.relation.replace(/_/g, ' ')}
                        </span>
                        <span className="text-sm text-neon-cyan">{f.subject}</span>
                        <ArrowRight className="w-3 h-3 text-gray-600 shrink-0" />
                        <span className="text-sm text-neon-purple flex-1">{f.object}</span>
                        {f.confidence !== undefined && (
                          <span className="text-[10px] text-gray-400 font-mono">{(f.confidence * 100).toFixed(0)}%</span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopyFact(f); }}
                          className={`shrink-0 transition-colors ${isCopied ? 'text-neon-green' : 'text-gray-400 hover:text-white'}`}
                        aria-label="Copy">
                          <Copy className="w-3 h-3" />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Graph View (visual relation map) */}
          {viewMode === 'graph' && (
            <div className="panel p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Network className="w-4 h-4 text-neon-yellow" /> Relation Graph
              </h3>
              <div className="space-y-3">
                {relationStats.map(({ relation: rel, count }) => {
                  const relFacts = filteredFacts.filter((f) => f.relation === rel).slice(0, 5);
                  return (
                    <div key={rel} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${RELATION_COLORS[rel] || 'text-gray-400'}`}>
                          {rel.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-gray-400">({count})</span>
                      </div>
                      <div className="ml-4 space-y-1">
                        {relFacts.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="text-neon-cyan">{f.subject}</span>
                            <ArrowRight className="w-2 h-2 text-gray-600" />
                            <span className="text-neon-purple">{f.object}</span>
                          </div>
                        ))}
                        {count > 5 && (
                          <button
                            onClick={() => { setRelationFilter(rel); setViewMode('list'); }}
                            className="text-xs text-neon-blue hover:underline"
                          >
                            +{count - 5} more
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {relationStats.length === 0 && (
                  <p className="text-gray-400 text-center py-8">No relations to visualize</p>
                )}
              </div>
            </div>
          )}

          {/* Stats View */}
          {viewMode === 'stats' && (
            <div className="space-y-4">
              <div className="panel p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-neon-blue" /> Relation Distribution
                </h3>
                <div className="space-y-3">
                  {relationStats.map(({ relation: rel, count, pct }) => (
                    <div key={rel} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className={RELATION_COLORS[rel] || 'text-gray-400'}>{rel.replace(/_/g, ' ')}</span>
                        <span className="text-gray-400 font-mono">{count} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="w-full h-2 bg-lattice-elevated rounded-full overflow-hidden">
                        <div className="h-full bg-neon-blue/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel p-4">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Eye className="w-4 h-4 text-neon-cyan" /> Top Subjects
                </h3>
                <div className="space-y-2">
                  {topSubjects.map(({ subject: subj, count }, i) => (
                    <div key={subj} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-4 text-right font-mono">{i + 1}</span>
                      <span className="text-sm text-neon-cyan flex-1">{subj}</span>
                      <span className="text-xs text-gray-400 font-mono">{count} facts</span>
                    </div>
                  ))}
                  {topSubjects.length === 0 && (
                    <p className="text-gray-400 text-center py-4">No subjects yet</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar - Fact Detail / Info */}
        <div className="space-y-4">
          {selectedFact && (
            <div className="panel p-4 border border-neon-blue/20">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-neon-yellow" /> Fact Detail
              </h3>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-xs text-gray-400">Subject</span>
                  <p className="text-neon-cyan font-medium">{selectedFact.subject}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Relation</span>
                  <p className={`font-medium ${RELATION_COLORS[selectedFact.relation] || 'text-gray-400'}`}>
                    {selectedFact.relation.replace(/_/g, ' ')}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Object</span>
                  <p className="text-neon-purple font-medium">{selectedFact.object}</p>
                </div>
                {selectedFact.confidence !== undefined && (
                  <div>
                    <span className="text-xs text-gray-400">Confidence</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full bg-neon-green/60 rounded-full"
                          style={{ width: `${selectedFact.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono">{(selectedFact.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                )}
                {selectedFact.source && (
                  <div>
                    <span className="text-xs text-gray-400">Source</span>
                    <p className="text-gray-300">{selectedFact.source}</p>
                  </div>
                )}
                <button
                  onClick={() => handleCopyFact(selectedFact)}
                  className="btn-neon w-full text-xs mt-2"
                >
                  <Copy className="w-3 h-3 mr-1 inline" /> Copy Triple
                </button>
              </div>
            </div>
          )}

          {/* Quick Add Shortcut */}
          {!showAddForm && (
            <div className="panel p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4 text-neon-purple" /> Quick Add
              </h3>
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full py-6 border-2 border-dashed border-lattice-border rounded-lg text-gray-400 hover:text-neon-purple hover:border-neon-purple/30 transition-colors text-sm"
              >
                Click to add a new fact
              </button>
            </div>
          )}

          {/* Knowledge Summary */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Brain className="w-4 h-4 text-neon-purple" /> Summary
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Facts</span>
                <span className="font-mono">{rawFacts.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Relation Types</span>
                <span className="font-mono">{relationStats.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Unique Subjects</span>
                <span className="font-mono">{topSubjects.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Inferences</span>
                <span className="font-mono">{inferenceCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Filtered</span>
                <span className="font-mono">{filteredFacts.length}</span>
              </div>
            </div>
          </div>

          {/* Relation Legend */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-neon-green" /> Relations
            </h3>
            <div className="space-y-1">
              {relations.map((r) => {
                const count = rawFacts.filter((f) => f.relation === r).length;
                return (
                  <button
                    key={r}
                    onClick={() => setRelationFilter(relationFilter === r ? 'all' : r)}
                    className={`flex items-center justify-between w-full px-2 py-1 rounded text-xs transition-colors ${
                      relationFilter === r ? 'bg-lattice-elevated' : 'hover:bg-lattice-elevated'
                    }`}
                  >
                    <span className={RELATION_COLORS[r] || 'text-gray-400'}>{r.replace(/_/g, ' ')}</span>
                    <span className="text-gray-400 font-mono">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="commonsense"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>


      {/* Knowledge Base Workbench — graph, inference, contradiction,
          taxonomy, confidence query, text import, provenance */}
      <section className="mt-6 rounded-xl border border-amber-500/20 bg-zinc-950/40 p-4">
        <KnowledgeBaseWorkbench />
      </section>

      {/* Bespoke ConceptNet concept graph explorer with Save-as-DTU */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ConceptExplorer />
      </section>

      <PipingProvider>
        <section className="mt-6">
          <CommonsenseActionPanel />
        </section>
      </PipingProvider>
    </div>

      <a href="#commonsense-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to commonsense content</a>
          <RecentMineCard domain="commonsense" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="commonsense" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="commonsense" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
