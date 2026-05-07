'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Search,
  Filter,
  ArrowRight,
  BookOpen,
  Tag,
  Calendar,
  Layers,
  ChevronDown,
  RefreshCw,
  Beaker,
  Download,
  X,
  AlertCircle,
  Zap,
  Save,
  FileText,
  Microscope,
  CheckCircle,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { useUIStore } from '@/store/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { FeedBanner } from '@/components/lens/FeedBanner';

interface DTUResult {
  id: string;
  title?: string;
  content?: string;
  summary?: string;
  domain?: string;
  tier?: string;
  tags?: string[];
  createdAt?: string;
  creti?: Record<string, number>;
}

export default function ResearchLensPage() {
  useLensNav('research');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('research');

  const {
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    tierDistribution,
    publishToMarketplace,
    isLoading: dtusLoading,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'research' });

  const [query, setQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'tier'>('date');
  const [selectedDtu, setSelectedDtu] = useState<DTUResult | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  /* ---------- domain actions ---------- */
  const runResearchAction = useRunArtifact('research');
  const [researchActionResult, setResearchActionResult] = useState<Record<string, unknown> | null>(
    null
  );
  const [researchActiveAction, setResearchActiveAction] = useState<string | null>(null);

  const handleResearchAction = useCallback(
    async (action: string) => {
      const all = [...hyperDTUs, ...megaDTUs, ...regularDTUs];
      const id = all[0]?.id;
      if (!id) return;
      setResearchActiveAction(action);
      try {
        const res = await runResearchAction.mutateAsync({ id, action });
        if (res.ok === false) {
          setResearchActionResult({
            action,
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setResearchActionResult({ action, ...(res.result as Record<string, unknown>) });
        }
      } catch (err) {
        console.error('Research action failed:', err);
      } finally {
        setResearchActiveAction(null);
      }
    },
    [hyperDTUs, megaDTUs, regularDTUs, runResearchAction]
  );

  /* ---------- hypothesis / generate ---------- */
  const [hypothesis, setHypothesis] = useState('');
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ content: string; title: string } | null>(
    null
  );
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [savingDTU, setSavingDTU] = useState(false);
  const [deepResearchLoading, setDeepResearchLoading] = useState(false);

  const handleDeepResearch = useCallback(async () => {
    if (!hypothesis.trim()) return;
    setDeepResearchLoading(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const data = await api
        .post('/api/research/conduct', { topic: hypothesis.trim() })
        .then((r) => r.data);
      const content =
        typeof data?.result === 'string'
          ? data.result
          : typeof data?.content === 'string'
            ? data.content
            : JSON.stringify(data, null, 2);
      setGenerateResult({
        content,
        title: data?.title || 'Deep Research Result',
      });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Deep research failed');
    } finally {
      setDeepResearchLoading(false);
    }
  }, [hypothesis]);

  const handleRunAnalysis = useCallback(async () => {
    if (!hypothesis.trim()) return;
    setGenerateLoading(true);
    setGenerateError(null);
    setGenerateResult(null);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'research',
        action: 'generate',
        input: { hypothesis: hypothesis.trim(), type: 'analysis' },
      });
      const data = res.data;
      const content =
        typeof data?.result === 'string'
          ? data.result
          : typeof data?.result?.content === 'string'
            ? data.result.content
            : JSON.stringify(data?.result ?? data, null, 2);
      setGenerateResult({
        content,
        title: data?.result?.title || 'Research Analysis',
      });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setGenerateLoading(false);
    }
  }, [hypothesis]);

  const handleDownloadResult = useCallback((content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const {
    data: dtusData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['research-dtus'],
    queryFn: () =>
      api
        .get('/api/dtus?limit=200')
        .then((r) => r.data)
        .catch(() => ({ dtus: [] })),
  });

  const handleSaveAsDTU = useCallback(async () => {
    if (!generateResult) return;
    setSavingDTU(true);
    try {
      await api.post('/api/dtus', {
        title: generateResult.title,
        content: generateResult.content,
        domain: 'research',
        tags: ['research', 'analysis', 'generated'],
      });
      setSavingDTU(false);
      refetch();
      refetchDTUs();
    } catch (e) {
      console.error('Failed to save research DTU:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to save research result' });
      setSavingDTU(false);
    }
  }, [generateResult, refetch, refetchDTUs]);

  const dtus: DTUResult[] = useMemo(() => dtusData?.dtus || [], [dtusData]);

  // Extract unique domains and tags for filters
  const domains = useMemo(() => {
    const set = new Set<string>();
    dtus.forEach((d) => {
      if (d.domain) set.add(d.domain);
    });
    return Array.from(set).sort();
  }, [dtus]);

  // Full-text search + filtering
  const results = useMemo(() => {
    let filtered = [...dtus];

    // Text search
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter((d) => {
        const text = [d.title, d.content, d.summary, ...(d.tags || [])].join(' ').toLowerCase();
        return text.includes(q);
      });
    }

    // Domain filter
    if (domainFilter) {
      filtered = filtered.filter((d) => d.domain === domainFilter);
    }

    // Tier filter
    if (tierFilter) {
      filtered = filtered.filter((d) => d.tier === tierFilter);
    }

    // Sort
    if (sortBy === 'date') {
      filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } else if (sortBy === 'tier') {
      const tierOrder: Record<string, number> = { hyper: 0, mega: 1, regular: 2, shadow: 3 };
      filtered.sort(
        (a, b) => (tierOrder[a.tier || 'regular'] || 2) - (tierOrder[b.tier || 'regular'] || 2)
      );
    }

    return filtered;
  }, [dtus, query, domainFilter, tierFilter, sortBy]);

  // Snippet generation
  const getSnippet = (dtu: DTUResult): string => {
    const text = dtu.content || dtu.summary || dtu.title || '';
    if (!query) return text.slice(0, 200);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, 200);
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + query.length + 100);
    return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
  };

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={(error as Error)?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div data-lens-theme="research" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <BookOpen className="w-6 h-6 text-neon-cyan" />
        <div>
          <h1 className="text-xl font-bold">Research</h1>
          <p className="text-sm text-gray-400">
            Search across all DTUs with full-text search and filters
          </p>
        </div>

        {/* Real-time Enhancement Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="research" data={realtimeData || {}} compact />
          <VisionAnalyzeButton
            domain="research"
            prompt="Analyze this research image (chart, graph, diagram, figure, data visualization, etc.). Extract key findings, describe the data shown, and suggest relevant research tags and domain classification."
            onResult={(res) => {
              setSelectedDtu({
                id: `vision-${Date.now()}`,
                title: 'Vision Analysis',
                content: res.analysis,
                summary: res.analysis.slice(0, 200),
                domain: 'research',
                tags: res.suggestedTags || [],
                createdAt: new Date().toISOString(),
              });
            }}
          />
          <button
            onClick={() => refetchDTUs()}
            disabled={dtusLoading}
            className="p-1 rounded hover:bg-lattice-surface/50 disabled:opacity-50 transition-colors"
            title="Refresh DTUs"
          >
            {dtusLoading ? (
              <span className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin inline-block" />
            ) : (
              <RefreshCw className="w-4 h-4 text-gray-400" />
            )}
          </button>
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      <FeedBanner domain="research" />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: FileText, label: 'Total DTUs', value: dtus.length, color: 'text-neon-cyan' },
          {
            icon: Microscope,
            label: 'Hyper Tier',
            value: dtus.filter((d) => d.tier === 'hyper').length,
            color: 'text-pink-400',
          },
          { icon: BookOpen, label: 'Domains', value: domains.length, color: 'text-purple-400' },
          {
            icon: Tag,
            label: 'Tagged',
            value: dtus.filter((d) => (d.tags || []).length > 0).length,
            color: 'text-green-400',
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 mb-2 ${stat.color}`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Hypothesis / Generate Panel */}
      <div className="p-4 bg-lattice-surface border border-lattice-border rounded-xl space-y-3">
        <div className="flex items-center gap-2">
          <Beaker className="w-5 h-5 text-neon-cyan" />
          <h2 className="text-sm font-semibold text-white">Run Analysis</h2>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunAnalysis()}
            placeholder="Enter a hypothesis or research question..."
            className="flex-1 px-4 py-2.5 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan text-sm"
          />
          <button
            onClick={handleRunAnalysis}
            disabled={generateLoading || deepResearchLoading || !hypothesis.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm font-medium hover:bg-neon-cyan/30 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {generateLoading ? (
              <span className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {generateLoading ? 'Analyzing...' : 'Analyze'}
          </button>
          <button
            onClick={handleDeepResearch}
            disabled={deepResearchLoading || generateLoading || !hypothesis.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-purple-500/20 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-500/30 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {deepResearchLoading ? (
              <span className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Microscope className="w-4 h-4" />
            )}
            {deepResearchLoading ? 'Researching...' : 'Deep Research'}
          </button>
        </div>
        {generateError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {generateError}
          </div>
        )}
        {generateResult && (
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-lattice-deep border border-lattice-border">
              <h4 className="text-sm font-semibold text-neon-cyan mb-2">{generateResult.title}</h4>
              <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">
                {generateResult.content}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  handleDownloadResult(
                    generateResult.content,
                    `${generateResult.title.replace(/\s+/g, '-').toLowerCase()}.txt`
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-cyan/10 text-neon-cyan rounded-lg text-xs hover:bg-neon-cyan/20"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </button>
              <button
                onClick={handleSaveAsDTU}
                disabled={savingDTU}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-purple/10 text-neon-purple rounded-lg text-xs hover:bg-neon-purple/20 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" /> {savingDTU ? 'Saving...' : 'Save as DTU'}
              </button>
              <button
                onClick={() => setGenerateResult(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-gray-400 hover:text-white text-xs"
              >
                <X className="w-3.5 h-3.5" /> Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search DTUs by title, content, tags..."
          className="w-full pl-12 pr-4 py-3 bg-lattice-surface border border-lattice-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan text-sm"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
          >
            <option value="">All Domains</option>
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
        >
          <option value="">All Tiers</option>
          <option value="hyper">Hyper</option>
          <option value="mega">Mega</option>
          <option value="regular">Regular</option>
          <option value="shadow">Shadow</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'relevance' | 'date' | 'tier')}
          className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white"
        >
          <option value="date">Sort by Date</option>
          <option value="tier">Sort by Tier</option>
          <option value="relevance">Sort by Relevance</option>
        </select>
        <span className="text-sm text-gray-500 self-center ml-auto">
          {results.length} result{results.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Results list */}
        <div className="lg:col-span-2 space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-24 bg-lattice-surface animate-pulse rounded-lg" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-16">
              <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">
                {query
                  ? `No results for "${query}"`
                  : 'No DTUs found. Create some in the Chat lens.'}
              </p>
            </div>
          ) : (
            results.map((dtu, idx) => (
              <motion.button
                key={dtu.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                onClick={() => setSelectedDtu(dtu)}
                className={cn(
                  'w-full text-left p-4 rounded-lg border transition-colors',
                  selectedDtu?.id === dtu.id
                    ? 'bg-lattice-surface border-neon-cyan/50'
                    : 'bg-lattice-surface/50 border-lattice-border hover:border-gray-600'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-white truncate">
                      {dtu.title || dtu.summary?.slice(0, 80) || `DTU ${dtu.id.slice(0, 8)}`}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{getSnippet(dtu)}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {dtu.domain && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan">
                          {dtu.domain}
                        </span>
                      )}
                      {dtu.tier && dtu.tier !== 'regular' && (
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded',
                            dtu.tier === 'hyper'
                              ? 'bg-pink-500/20 text-pink-400'
                              : dtu.tier === 'mega'
                                ? 'bg-purple-500/20 text-purple-400'
                                : 'bg-gray-500/20 text-gray-400'
                          )}
                        >
                          {dtu.tier}
                        </span>
                      )}
                      {/* Citation count badge */}
                      {dtu.creti && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 flex items-center gap-1">
                          <Microscope className="w-3 h-3" /> {Object.keys(dtu.creti).length} scores
                        </span>
                      )}
                      {/* Peer review status */}
                      {dtu.tier === 'hyper' && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Verified
                        </span>
                      )}
                      {(dtu.tags || []).slice(0, 3).map((tag) => (
                        <span key={tag} className="text-xs text-gray-500">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 mt-1">
                    <PullToSubstrate domain="research" artifactId={dtu.id} compact />
                    <ArrowRight className="w-4 h-4 text-gray-600" />
                  </div>
                </div>
              </motion.button>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div className="panel p-4 space-y-4 sticky top-4">
          {selectedDtu ? (
            <>
              <h2 className="font-semibold text-white">
                {selectedDtu.title || selectedDtu.summary?.slice(0, 60) || 'DTU Detail'}
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-gray-400">
                  <Layers className="w-4 h-4" />
                  <span>Tier: {selectedDtu.tier || 'regular'}</span>
                </div>
                {selectedDtu.domain && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <BookOpen className="w-4 h-4" />
                    <span>Domain: {selectedDtu.domain}</span>
                  </div>
                )}
                {selectedDtu.createdAt && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Calendar className="w-4 h-4" />
                    <span>{new Date(selectedDtu.createdAt).toLocaleDateString()}</span>
                  </div>
                )}
                {(selectedDtu.tags || []).length > 0 && (
                  <div className="flex items-center gap-2 text-gray-400 flex-wrap">
                    <Tag className="w-4 h-4" />
                    {selectedDtu.tags!.map((t) => (
                      <span
                        key={t}
                        className="text-xs px-1.5 py-0.5 rounded bg-lattice-deep text-gray-300"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="pt-3 border-t border-lattice-border">
                  <p className="text-gray-300 whitespace-pre-wrap text-xs leading-relaxed">
                    {selectedDtu.content || selectedDtu.summary || 'No content available.'}
                  </p>
                </div>
                {selectedDtu.creti && (
                  <div className="pt-3 border-t border-lattice-border">
                    <p className="text-xs font-medium text-gray-400 mb-2">CRETI Scores</p>
                    <div className="space-y-1">
                      {Object.entries(selectedDtu.creti).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-20">{key}</span>
                          <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                            <div
                              className="h-full bg-neon-cyan rounded-full"
                              style={{ width: `${(val as number) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-10 text-right">
                            {((val as number) * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a result to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* DTU Context */}
      <div className="mt-6 space-y-3">
        <LensContextPanel
          hyperDTUs={hyperDTUs}
          megaDTUs={megaDTUs}
          regularDTUs={regularDTUs}
          tierDistribution={tierDistribution}
          onPublish={(dtu) => publishToMarketplace({ dtuId: dtu.id })}
          title="Research DTUs"
        />
        <FeedbackWidget targetType="lens" targetId="research" />

        {/* Real-time Data Panel */}
        {realtimeData && (
          <>
            <UniversalActions domain="research" artifactId={null} compact />
            <RealtimeDataPanel
              domain="research"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          </>
        )}
      </div>

      {/* Research Domain Actions */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neon-cyan flex items-center gap-2">
          <Microscope className="w-4 h-4" /> Research Analysis
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'citationNetwork', label: 'Citation Network' },
            { action: 'methodologyScore', label: 'Methodology Score' },
            { action: 'reproducibilityCheck', label: 'Reproducibility Check' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleResearchAction(action)}
              disabled={researchActiveAction === action}
              className="px-3 py-1.5 text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded-lg hover:bg-neon-cyan/20 disabled:opacity-50 flex items-center gap-1.5"
            >
              {researchActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" />
              ) : (
                <Zap className="w-3 h-3 text-neon-cyan" />
              )}
              {label}
            </button>
          ))}
        </div>
        {researchActionResult && (
          <div className="p-3 bg-black/40 rounded-lg border border-neon-cyan/20 text-xs space-y-2">
            {researchActionResult.action === 'citationNetwork' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">
                    Papers:{' '}
                    <span className="text-white font-mono">
                      {String(researchActionResult.totalPapers ?? '')}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Citations:{' '}
                    <span className="text-neon-cyan font-mono">
                      {String(researchActionResult.totalCitations ?? '')}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    H-index:{' '}
                    <span className="text-neon-blue font-mono">
                      {String(researchActionResult.hIndex ?? '')}
                    </span>
                  </span>
                </div>
                {!!researchActionResult.message && (
                  <p className="text-gray-400 italic">{String(researchActionResult.message)}</p>
                )}
              </div>
            )}
            {researchActionResult.action === 'methodologyScore' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">
                    Score:{' '}
                    <span
                      className={`font-mono font-bold ${(researchActionResult.score as number) >= 7 ? 'text-green-400' : (researchActionResult.score as number) >= 4 ? 'text-yellow-400' : 'text-red-400'}`}
                    >
                      {String(researchActionResult.score ?? '')}/10
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Quality:{' '}
                    <span className="text-white">{String(researchActionResult.quality ?? '')}</span>
                  </span>
                </div>
                {Array.isArray(researchActionResult.strengths) &&
                  researchActionResult.strengths.length > 0 && (
                    <div className="space-y-0.5">
                      {(researchActionResult.strengths as string[]).map((s, i) => (
                        <p key={i} className="text-green-300">
                          ✓ {s}
                        </p>
                      ))}
                    </div>
                  )}
                {!!researchActionResult.message && (
                  <p className="text-gray-400 italic">{String(researchActionResult.message)}</p>
                )}
              </div>
            )}
            {researchActionResult.action === 'reproducibilityCheck' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">
                    Score:{' '}
                    <span
                      className={`font-mono font-bold ${(researchActionResult.reproducibilityScore as number) >= 7 ? 'text-green-400' : (researchActionResult.reproducibilityScore as number) >= 4 ? 'text-yellow-400' : 'text-red-400'}`}
                    >
                      {String(researchActionResult.reproducibilityScore ?? '')}/10
                    </span>
                  </span>
                </div>
                {Array.isArray(researchActionResult.issues) &&
                  researchActionResult.issues.length > 0 && (
                    <div className="space-y-0.5">
                      {(researchActionResult.issues as string[]).map((s, i) => (
                        <p key={i} className="text-yellow-300">
                          ⚠ {s}
                        </p>
                      ))}
                    </div>
                  )}
                {!!researchActionResult.message && (
                  <p className="text-gray-400 italic">{String(researchActionResult.message)}</p>
                )}
              </div>
            )}
            <button
              onClick={() => setResearchActionResult(null)}
              className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Live Web Feed — science feeds are relevant to research */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="science" />
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="research" />
          </div>
        )}
      </div>
    </div>
  );
}
