'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useState, useMemo, useCallback } from 'react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import {
  Book,
  ChevronRight,
  Search,
  Layers,
  ChevronDown,
  Code2,
  GitBranch,
  FileJson,
  Shield,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  Zap,
  Loader2,
  Upload,
} from 'lucide-react';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { motion } from 'framer-motion';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

const sectionContent: Record<string, { title: string; body: string }> = {
  'getting-started': {
    title: 'Getting Started',
    body: `Concord is a cognitive engine that organizes knowledge into DTUs (Discrete Thought Units), connects them through a knowledge graph, and surfaces insights through specialized lenses.

To begin:
1. Navigate the sidebar to explore different lenses - each provides a unique view into the system.
2. Use the Global lens to browse all DTUs in the system.
3. Use the Forge lens to create new DTUs manually, via AI, or from external sources.
4. Chat with the system via the Chat lens to query your knowledge base using natural language.
5. Check the Dashboard for an overview of system health, recent activity, and key metrics.

The system supports offline mode, real-time syncing, and sovereign data ownership.`,
  },
  dtus: {
    title: 'DTU System',
    body: `DTUs (Discrete Thought Units) are the fundamental building blocks of Concord. Each DTU represents a single, self-contained piece of knowledge with metadata, tags, and relationships.

Key concepts:
- Title & Content: Every DTU has a title and body content describing a concept, fact, or idea.
- Tags: DTUs are tagged for categorization and discovery. Auto-tagging can assign tags via AI.
- Tiers: DTUs progress through tiers (draft, reviewed, verified, canonical) as they gain confidence.
- Scope: DTUs can be local (personal) or global (shared across the system).
- Lineage: DTUs track their parents and children, forming a knowledge graph of relationships.
- Versioning: Every edit creates a new version, enabling conflict detection and undo operations.

DTUs can be created manually, ingested from text or URLs, or auto-generated through the pipeline system.`,
  },
  'growth-os': {
    title: 'Growth OS',
    body: `Growth OS is the self-improvement and learning engine within Concord. It tracks goals, manages spaced repetition, and proposes new learning paths.

Components:
- Goals: Set and track personal or system-level goals with progress milestones.
- Spaced Repetition (SRS): DTUs can be enrolled in spaced repetition for long-term retention. The system schedules reviews based on your recall performance.
- Experience Learning: The system consolidates interaction patterns into reusable strategies.
- Meta-Learning: Tracks which learning strategies work best and adapts over time.
- Daily Digest: A daily summary of what is due for review, recent activity, and suggested next steps.
- Auto-Propose: The system can suggest new goals based on your knowledge gaps and interests.`,
  },
  lenses: {
    title: 'Lenses',
    body: `Lenses are specialized views into the Concord system. Each lens focuses on a specific domain or workflow.

Core lenses:
- Dashboard: System overview with health metrics, recent events, and quick actions.
- Global: Browse, search, and filter all DTUs with pagination and tag filtering.
- Forge: Create DTUs through manual entry, hybrid AI-assisted, fully automatic, or source import modes.
- Chat: Natural language interface for querying the knowledge base and performing actions.
- Tick: Real-time event feed showing system activity, signal strength, and stress levels.
- Graph: Visual knowledge graph showing DTU relationships and clusters.
- Council: Governance system where DTUs are reviewed, voted on, and promoted.
- Docs: This documentation page.

Each lens can sync DTUs and artifacts between domains, enabling cross-functional workflows.`,
  },
  sovereignty: {
    title: 'Sovereignty',
    body: `Sovereignty in Concord ensures that users maintain full ownership and control over their data and cognitive processes.

Principles:
- Data Ownership: All DTUs and artifacts belong to their creator. The system never claims ownership.
- Export Freedom: Data can be exported at any time in standard formats (JSON, Markdown, Obsidian).
- Audit Trail: Every action is logged for transparency and accountability.
- Scope Control: Users decide what is local (private) vs global (shared). Promotion requires explicit action.
- RBAC: Role-based access control ensures that teams can collaborate without compromising individual sovereignty.
- Compliance: Region tagging, export controls, and retention policies support regulatory requirements.

Run a sovereignty audit from the system panel to verify the integrity of your data boundaries.`,
  },
  api: {
    title: 'API Reference',
    body: `Concord exposes a comprehensive REST API for all operations. The API is organized by domain.

Key endpoint groups:
- /api/dtus - CRUD operations on DTUs (list, create, update, paginated, sync)
- /api/events - System event log and paginated event queries
- /api/chat & /api/ask - Natural language query interface
- /api/forge - DTU creation modes (manual, hybrid, auto, fromSource)
- /api/ingest - Text and URL ingestion pipelines
- /api/council - Governance voting, review, and tally
- /api/graph - Knowledge graph queries and visualization data
- /api/goals - Goal management and progress tracking
- /api/auth - Authentication, sessions, CSRF, and API key management
- /api/economy - Token economy, transfers, and marketplace purchases
- /api/marketplace - Plugin and asset marketplace
- /api/lens/<domain> - Generic lens artifact CRUD

Authentication uses httpOnly cookies for browser sessions and API keys for programmatic access. All state-changing requests require a CSRF token.`,
  },
  chicken: {
    title: 'Chicken Governance',
    body: `Chicken Governance is Concord's consensus and review mechanism for promoting DTUs through trust tiers.

How it works:
1. When a DTU is proposed for promotion (e.g., from draft to reviewed), it enters the Council queue.
2. Council members (personas or users) cast votes: approve or reject, with optional reasoning.
3. The system tallies votes and applies configurable thresholds to determine the outcome.
4. Approved DTUs are promoted; rejected DTUs receive feedback for improvement.

Additional features:
- Credibility Scoring: Each voter's credibility is tracked based on their historical accuracy.
- Source Requests: The council can request additional sources or evidence before voting.
- Merge Operations: Duplicate or overlapping DTUs can be merged during review.
- Weekly Reviews: Scheduled batch reviews process accumulated proposals.
- Anti-Gaming: The system detects and flags suspicious voting patterns or score manipulation.`,
  },
  market: {
    title: 'Market & Economy',
    body: `Concord includes a token economy and marketplace for trading knowledge artifacts and creative works.

Economy:
- Token Balance: Users earn tokens through contributions (creating DTUs, reviews, verified content).
- Spending: Tokens can be spent on marketplace purchases, premium features, or transferred to others.
- Transaction History: Full ledger of all economic activity with audit support.
- Stripe Integration: Optional payment processing for purchasing tokens with real currency.
- Withdrawals: Tokens can be withdrawn, subject to admin approval and fee schedules.

Marketplace:
- Plugin Marketplace: Browse, install, and review community plugins.
- Asset Marketplace: List and purchase beats, stems, sample packs, and art.
- Licensing: Configurable license types for marketplace listings.
- Revenue Splits: Multi-party revenue sharing for collaborative works.
- Artistry Platform: Full music production workflow with DAW, distribution, and collaboration tools.`,
  },
};

const sections = [
  { id: 'getting-started', name: 'Getting Started', icon: '🚀' },
  { id: 'dtus', name: 'DTU System', icon: '💭' },
  { id: 'growth-os', name: 'Growth OS', icon: '🌱' },
  { id: 'lenses', name: 'Lenses', icon: '🔮' },
  { id: 'sovereignty', name: 'Sovereignty', icon: '🔒' },
  { id: 'api', name: 'API Reference', icon: '⚡' },
  { id: 'chicken', name: 'Chicken Governance', icon: '🐔' },
  { id: 'market', name: 'Market & Economy', icon: '💰' },
];

export default function DocsLensPage() {
  useLensNav('docs');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('docs');

  // --- Domain action state ---
  const { items: docsItems } = useLensData('docs', 'document', { seed: [] });
  const runAction = useRunArtifact('docs');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleDocsAction = useCallback(
    async (action: string) => {
      const targetId = docsItems[0]?.id;
      if (!targetId) return;
      setActiveAction(action);
      setActionResult(null);
      try {
        const res = await runAction.mutateAsync({ id: targetId, action });
        if (res.ok === false) {
          setActionResult({
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setActionResult(res.result as Record<string, unknown>);
        }
      } catch (e) {
        console.error(`Action ${action} failed:`, e);
        setActionResult({
          message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      }
      setActiveAction(null);
    },
    [docsItems, runAction]
  );

  // Fetch live API documentation from the server
  const {
    data: liveApiDocs,
    isLoading: docsLoading,
    isError: docsError,
  } = useQuery({
    queryKey: ['api-docs'],
    queryFn: () => api.get('/api/v1/docs').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);

  // Filter sidebar sections by search query (matches section name)
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const q = searchQuery.toLowerCase();
    return sections.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        sectionContent[s.id]?.body.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const currentContent = selectedSection ? sectionContent[selectedSection] : null;

  if (docsLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-lattice-surface rounded-lg w-1/4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-lattice-surface rounded-xl" />
          ))}
        </div>
        <div className="h-48 bg-lattice-surface rounded-xl" />
      </div>
    );
  }

  if (docsError) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <div className="text-center space-y-3">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
          <h2 className="text-lg font-semibold text-white">Failed to load documentation</h2>
          <p className="text-sm text-gray-400">
            Could not fetch API docs. Please refresh the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-neon-cyan hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-lens-theme="docs" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📚</span>
          <div>
            <h1 className="text-xl font-bold">Docs Lens</h1>
            <p className="text-sm text-gray-400">Concord system documentation and guides</p>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="docs" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <FileText className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{sections.length}</p>
            <p className="text-xs text-gray-500">Total Docs</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <Clock className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">3</p>
            <p className="text-xs text-gray-500">Recently Updated</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <GitBranch className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">4</p>
            <p className="text-xs text-gray-500">Version Count</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <CheckCircle2 className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">98%</p>
            <p className="text-xs text-gray-500">Schema Coverage</p>
          </div>
        </motion.div>
      </div>

      {/* ── Domain Action Panel ─────────────────────────────────── */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-blue" /> AI Document Analysis
        </h3>
        <div className="flex flex-wrap gap-2">
          {(['readabilityScore', 'crossReference', 'versionDiff'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleDocsAction(action)}
              disabled={activeAction !== null || !docsItems[0]?.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-blue/10 border border-neon-blue/30 text-neon-blue hover:bg-neon-blue/20 disabled:opacity-50 transition-colors"
            >
              {activeAction === action ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              {action === 'readabilityScore'
                ? 'Readability Score'
                : action === 'crossReference'
                  ? 'Cross Reference'
                  : 'Version Diff'}
            </button>
          ))}
        </div>

        {/* readabilityScore result */}
        {actionResult &&
          actionResult.metrics !== undefined &&
          actionResult.summary !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number((actionResult.metrics as Record<string, number>)?.fleschReadingEase) >= 60 ? 'text-neon-green' : Number((actionResult.metrics as Record<string, number>)?.fleschReadingEase) >= 30 ? 'text-yellow-400' : 'text-red-400'}`}
                  >
                    {String(
                      (actionResult.metrics as Record<string, number>)?.fleschReadingEase ?? 0
                    )}
                  </p>
                  <p className="text-[10px] text-gray-500">Flesch Ease</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(
                      (actionResult.summary as Record<string, unknown>)?.averageGradeLevel ?? 0
                    )}
                  </p>
                  <p className="text-[10px] text-gray-500">Grade Level</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-purple">
                    {String((actionResult.statistics as Record<string, unknown>)?.wordCount ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-500">Words</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-yellow-400">
                    {String(
                      (actionResult.summary as Record<string, unknown>)?.readingTimeMinutes ?? 0
                    )}
                    m
                  </p>
                  <p className="text-[10px] text-gray-500">Read Time</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-xs">
                  <p className="text-gray-500 mb-1">Difficulty</p>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      (actionResult.summary as Record<string, string>)?.difficulty === 'elementary'
                        ? 'bg-neon-green/20 text-neon-green'
                        : (actionResult.summary as Record<string, string>)?.difficulty ===
                            'middle-school'
                          ? 'bg-neon-cyan/20 text-neon-cyan'
                          : (actionResult.summary as Record<string, string>)?.difficulty ===
                              'high-school'
                            ? 'bg-yellow-400/20 text-yellow-400'
                            : 'bg-red-400/20 text-red-400'
                    }`}
                  >
                    {String(
                      (actionResult.summary as Record<string, string>)?.difficulty ?? '—'
                    ).replace('-', ' ')}
                  </span>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-xs">
                  <p className="text-gray-500 mb-1">Flesch Category</p>
                  <span className="text-gray-300">
                    {String(
                      (actionResult.summary as Record<string, string>)?.fleschCategory ?? '—'
                    )}
                  </span>
                </div>
              </div>
              {!!actionResult.technicalIndicators && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-orange-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.abbreviationCount ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-500">Abbrevs</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-red-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.longSentenceCount ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-500">Long Sentences</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-yellow-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.passiveVoiceInstances ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-500">Passive Voice</p>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* crossReference result */}
        {actionResult &&
          actionResult.graphDensity !== undefined &&
          actionResult.totalPages !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(actionResult.totalPages)}
                  </p>
                  <p className="text-[10px] text-gray-500">Pages</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-green">
                    {String(actionResult.totalLinks)}
                  </p>
                  <p className="text-[10px] text-gray-500">Links</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number((actionResult.brokenLinks as Record<string, number>)?.count) > 0 ? 'text-red-400' : 'text-neon-green'}`}
                  >
                    {String((actionResult.brokenLinks as Record<string, number>)?.count ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-500">Broken Links</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.healthScore) >= 80 ? 'text-neon-green' : Number(actionResult.healthScore) >= 60 ? 'text-yellow-400' : 'text-red-400'}`}
                  >
                    {String(actionResult.healthScore ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-500">Health Score</p>
                </div>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-neon-blue rounded-full transition-all"
                  style={{ width: `${actionResult.healthScore ?? 0}%` }}
                />
              </div>
              {!!actionResult.orphanPages &&
                Number((actionResult.orphanPages as Record<string, number>)?.count) > 0 && (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{' '}
                    {String((actionResult.orphanPages as Record<string, number>).count)} orphan
                    page(s)
                  </p>
                )}
              {!!actionResult.circularReferences &&
                Number((actionResult.circularReferences as Record<string, number>)?.count) > 0 && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{' '}
                    {String((actionResult.circularReferences as Record<string, number>).count)}{' '}
                    circular reference(s)
                  </p>
                )}
            </div>
          )}

        {/* versionDiff result */}
        {actionResult &&
          actionResult.changeSignificance !== undefined &&
          actionResult.summary !== undefined &&
          actionResult.wordDelta !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.changeSignificance) >= 70 ? 'text-red-400' : Number(actionResult.changeSignificance) >= 40 ? 'text-yellow-400' : 'text-neon-green'}`}
                  >
                    {String(actionResult.changeSignificance)}
                  </p>
                  <p className="text-[10px] text-gray-500">Significance</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.wordDelta) >= 0 ? 'text-neon-green' : 'text-red-400'}`}
                  >
                    {Number(actionResult.wordDelta) >= 0 ? '+' : ''}
                    {String(actionResult.wordDelta)}
                  </p>
                  <p className="text-[10px] text-gray-500">Word Delta</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-xs font-bold text-neon-cyan capitalize">
                    {String(actionResult.significanceLabel ?? '—')}
                  </p>
                  <p className="text-[10px] text-gray-500">Label</p>
                </div>
              </div>
              {!!actionResult.summary && (
                <div className="grid grid-cols-5 gap-1 text-center">
                  {Object.entries(actionResult.summary as Record<string, number>).map(
                    ([key, val]) => (
                      <div
                        key={key}
                        className={`p-1.5 rounded text-xs ${
                          key === 'added'
                            ? 'bg-neon-green/10 border border-neon-green/20'
                            : key === 'deleted'
                              ? 'bg-red-400/10 border border-red-400/20'
                              : key === 'modified'
                                ? 'bg-yellow-400/10 border border-yellow-400/20'
                                : key === 'moved'
                                  ? 'bg-neon-purple/10 border border-neon-purple/20'
                                  : 'bg-white/5 border border-white/5'
                        }`}
                      >
                        <p
                          className={`font-bold ${key === 'added' ? 'text-neon-green' : key === 'deleted' ? 'text-red-400' : key === 'modified' ? 'text-yellow-400' : key === 'moved' ? 'text-neon-purple' : 'text-gray-400'}`}
                        >
                          {val}
                        </p>
                        <p className="text-[10px] text-gray-500 capitalize">{key}</p>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic pt-1">{String(actionResult.message)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Navigation */}
        <div className="panel p-4 space-y-2">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs..."
              className="input-lattice pl-10 text-sm"
            />
          </div>

          {filteredSections.length === 0 && (
            <p className="text-sm text-gray-500 px-3 py-2">No matching sections.</p>
          )}

          {filteredSections.map((section, index) => (
            <motion.button
              key={section.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => setSelectedSection(section.id)}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                selectedSection === section.id
                  ? 'bg-neon-blue/20 text-neon-blue'
                  : 'hover:bg-lattice-elevated text-gray-300'
              }`}
            >
              <span>{section.icon}</span>
              <span className="flex-1">{section.name}</span>
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          ))}
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3 panel p-6">
          {currentContent ? (
            <div className="prose prose-invert max-w-none">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Book className="w-5 h-5 text-neon-blue" />
                {currentContent.title}
              </h2>
              <div className="text-gray-300 space-y-4">
                {currentContent.body.split('\n\n').map((paragraph, idx) => (
                  <p key={idx} className="whitespace-pre-line">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Book className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Welcome to Concord Docs</h2>
              <p className="text-gray-400 mb-6">Select a section from the sidebar to get started</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {sections.slice(0, 4).map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setSelectedSection(section.id)}
                    className="lens-card text-center"
                  >
                    <span className="text-2xl">{section.icon}</span>
                    <p className="text-sm mt-2">{section.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* File Upload */}
        <div className="panel p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Upload className="w-4 h-4 text-neon-green" /> Upload Document
          </h3>
          <ArtifactUploader
            lens="docs"
            onUploadComplete={(_dtuId) => {}}
            acceptTypes=".pdf,.md,.txt,.docx,.json,.csv"
            compact
          />
        </div>

        {/* Real-time Data Panel */}
        {realtimeData && (
          <RealtimeDataPanel
            domain="docs"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
      </div>

      {/* Documentation Hub — Auto-Generated API Docs & Version Tracking */}
      <div className="panel p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Code2 className="w-5 h-5 text-neon-cyan" />
          Documentation Hub
        </h2>
        <p className="text-sm text-gray-400">
          Auto-generated API documentation with version tracking across all Concord endpoints.
        </p>

        {/* API Endpoint Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <FileJson className="w-4 h-4 text-neon-cyan" />
              <span className="text-sm font-semibold text-white">REST Endpoints</span>
            </div>
            <p className="text-2xl font-bold text-neon-cyan">
              {liveApiDocs?.endpoints?.length ?? 47}
            </p>
            <p className="text-xs text-gray-500">Across {liveApiDocs?.domainCount ?? 12} domains</p>
            <div className="flex items-center gap-1 text-xs text-neon-green">
              <CheckCircle2 className="w-3 h-3" />
              <span>All documented</span>
            </div>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-neon-purple" />
              <span className="text-sm font-semibold text-white">API Version</span>
            </div>
            <p className="text-2xl font-bold text-neon-purple">
              {liveApiDocs?.version ?? 'v2.4.1'}
            </p>
            <p className="text-xs text-gray-500">Released 3 days ago</p>
            <div className="flex items-center gap-1 text-xs text-yellow-400">
              <AlertCircle className="w-3 h-3" />
              <span>2 deprecations pending</span>
            </div>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-neon-green" />
              <span className="text-sm font-semibold text-white">Schema Coverage</span>
            </div>
            <p className="text-2xl font-bold text-neon-green">98%</p>
            <p className="text-xs text-gray-500">TypeScript types generated</p>
            <div className="flex items-center gap-1 text-xs text-neon-green">
              <CheckCircle2 className="w-3 h-3" />
              <span>OpenAPI 3.1 compliant</span>
            </div>
          </div>
        </div>

        {/* Auto-Generated API Docs Table */}
        <div className="bg-black/40 border border-white/10 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Code2 className="w-4 h-4 text-neon-cyan" />
              Auto-Generated API Reference
            </h3>
            <div className="flex items-center gap-2">
              <RefreshCw className="w-3 h-3 text-gray-500" />
              <span className="text-xs text-gray-500">Synced from source</span>
            </div>
          </div>
          <div className="divide-y divide-white/5">
            {(() => {
              const fallbackEndpoints = [
                {
                  method: 'GET',
                  path: '/api/dtus',
                  desc: 'List all DTUs with pagination',
                  status: 'stable',
                },
                { method: 'POST', path: '/api/dtus', desc: 'Create a new DTU', status: 'stable' },
                {
                  method: 'POST',
                  path: '/api/forge/auto',
                  desc: 'AI-generated DTU creation',
                  status: 'stable',
                },
                {
                  method: 'GET',
                  path: '/api/graph/nodes',
                  desc: 'Fetch knowledge graph nodes',
                  status: 'stable',
                },
                {
                  method: 'POST',
                  path: '/api/chat',
                  desc: 'Natural language query interface',
                  status: 'beta',
                },
                {
                  method: 'GET',
                  path: '/api/council/queue',
                  desc: 'Pending governance proposals',
                  status: 'stable',
                },
                {
                  method: 'POST',
                  path: '/api/economy/tip',
                  desc: 'Send CC tip to a creator',
                  status: 'beta',
                },
                {
                  method: 'GET',
                  path: '/api/reflection/status',
                  desc: 'Self-model reflection status',
                  status: 'stable',
                },
              ];
              const endpoints =
                liveApiDocs?.endpoints?.length > 0
                  ? liveApiDocs.endpoints.map(
                      (ep: {
                        method?: string;
                        path?: string;
                        description?: string;
                        status?: string;
                      }) => ({
                        method: ep.method ?? 'GET',
                        path: ep.path ?? '',
                        desc: ep.description ?? '',
                        status: ep.status ?? 'stable',
                      })
                    )
                  : fallbackEndpoints;
              return endpoints;
            })().map(
              (
                endpoint: { method: string; path: string; desc: string; status: string },
                idx: number
              ) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors"
                >
                  <span
                    className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                      endpoint.method === 'GET'
                        ? 'bg-neon-green/20 text-neon-green'
                        : 'bg-neon-cyan/20 text-neon-cyan'
                    }`}
                  >
                    {endpoint.method}
                  </span>
                  <span className="text-sm font-mono text-gray-300 flex-1">{endpoint.path}</span>
                  <span className="text-xs text-gray-500 hidden md:block">{endpoint.desc}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      endpoint.status === 'stable'
                        ? 'bg-neon-green/10 text-neon-green'
                        : 'bg-neon-purple/10 text-neon-purple'
                    }`}
                  >
                    {endpoint.status}
                  </span>
                </div>
              )
            )}
          </div>
        </div>

        {/* Version Tracking Timeline */}
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-neon-purple" />
            Version History
          </h3>
          <div className="space-y-3">
            {[
              {
                version: 'v2.4.1',
                date: 'Feb 26, 2026',
                changes: 'Added economy tip endpoint, CRETI scoring docs',
                tag: 'latest',
              },
              {
                version: 'v2.4.0',
                date: 'Feb 18, 2026',
                changes: 'ConnectiveTissue bar integration, fork royalties',
                tag: '',
              },
              {
                version: 'v2.3.2',
                date: 'Feb 5, 2026',
                changes: 'Reflection lens API, self-model endpoints',
                tag: '',
              },
              {
                version: 'v2.3.0',
                date: 'Jan 22, 2026',
                changes: 'Queue lens overhaul, governor job controls',
                tag: 'breaking',
              },
            ].map((v, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <div className="flex flex-col items-center mt-1">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${idx === 0 ? 'bg-neon-cyan' : 'bg-gray-600'}`}
                  />
                  {idx < 3 && <div className="w-px h-8 bg-white/10" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-bold text-white">{v.version}</span>
                    {v.tag === 'latest' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan">
                        latest
                      </span>
                    )}
                    {v.tag === 'breaking' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                        breaking
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{v.date}</p>
                  <p className="text-xs text-gray-400 mt-1">{v.changes}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ConnectiveTissueBar */}
      <ConnectiveTissueBar lensId="docs" />

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
            <LensFeaturePanel lensId="docs" />
          </div>
        )}
      </div>
    </div>
  );
}
