'use client';

/**
 * Guide handbook — static Concord docs sections + document upload.
 * Extracted from docs/page.tsx during consolidation (no behavior change).
 */

import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Upload, ChevronRight } from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { useLensCommand } from '@/hooks/useLensCommand';

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


export function GuidePanel() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },
    ],
    { lensId: "docs" }
  );
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="panel p-4 space-y-2">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs..."
              className="input-lattice pl-10 text-sm"
            />
          </div>

          {filteredSections.length === 0 && (
            <p className="text-sm text-gray-400 px-3 py-2">No matching sections.</p>
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

        <div className="lg:col-span-3 panel p-6">
          {currentContent ? (
            <div className="prose prose-invert max-w-none">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <SvgIcon name="book" size={20} className="text-neon-blue" />
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
              <SvgIcon name="book" size={64} className="text-gray-600 mx-auto mb-4" />
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
      </div>
    </div>
  );
}
