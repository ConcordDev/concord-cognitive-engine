/**
 * Lens Status Taxonomy — Step 1 of the Core Lenses Roadmap.
 *
 * Every lens is tagged with its maturity level. This stops entropy:
 * no new lens advances past 'viewer' without passing the Product Lens Gate.
 *
 * Statuses:
 *   - product:  Has primary artifact, persistence, engine, pipeline, DTU exhaust.
 *              These are the world-class lenses Concord bets on.
 *   - hybrid:   Has some persistence or artifacts but missing engine/pipeline.
 *              In transition toward product status.
 *   - viewer:   Displays DTU exhaust or data but produces no primary artifact.
 *              These should merge into a product lens as a mode.
 *   - system:   Infrastructure lens (admin, debug, queue). Not user-facing products.
 *   - deprecated: Scheduled for merge into a product lens. Will be removed.
 *
 * The non-negotiable rule:
 *   A lens must have a primary artifact that survives without DTUs.
 *   DTUs are exhaust — not the product.
 */

export type LensStatus = 'product' | 'hybrid' | 'viewer' | 'system' | 'deprecated';

export interface LensStatusEntry {
  /** Lens ID matching lens-registry.ts */
  id: string;
  /** Current maturity level */
  status: LensStatus;
  /** Which product lens this merges into (null if standalone) */
  mergeTarget: string | null;
  /** Role after merge: 'standalone' | 'mode' | 'engine' | 'absorbed' */
  postMergeRole: 'standalone' | 'mode' | 'engine' | 'absorbed';
  /** Brief rationale for classification */
  rationale: string;
}

/**
 * Complete lens status map. Every lens in the registry must appear here.
 * This is the source of truth for what stays, what merges, and what role each plays.
 */
export const LENS_STATUS_MAP: LensStatusEntry[] = [
  // ═══════════════════════════════════════════════════════════════
  // TIER A — PRODUCT LENSES (world-class targets)
  // These are the 10 lenses Concord pushes to dominance.
  // ═══════════════════════════════════════════════════════════════

  // 1. Research (the crown jewel)
  {
    id: 'paper',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Core of the Research super-lens. Artifacts: ResearchProject, Claim, Hypothesis, Evidence, Experiment, Synthesis.',
  },

  // 2. Reasoning / Argument
  {
    id: 'reasoning',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'HLR reasoning reader/dashboard + chain starter. Has create (create_chain) + run + list/get traces; update/delete/export are by-design absent (an HLR trace is an immutable record of a reasoning pass — see manifest.ts), so full-CRUD product status would misrepresent it. Hybrid is the honest fit.',
  },

  // 3. Governance / City / Microbond
  {
    id: 'council',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Governance super-lens. Artifacts: Proposal, Vote, BudgetModel, Project, AuditTrail.',
  },
  {
    id: 'vote',
    status: 'hybrid',
    mergeTarget: 'council',
    postMergeRole: 'mode',
    rationale: 'Voting is a mode within Governance, not a standalone product.',
  },
  {
    id: 'ethics',
    status: 'hybrid',
    mergeTarget: 'council',
    postMergeRole: 'mode',
    rationale: 'Ethics review is a governance mode.',
  },
  {
    id: 'alliance',
    status: 'hybrid',
    mergeTarget: 'council',
    postMergeRole: 'mode',
    rationale: 'Alliance management is a governance mode.',
  },

  // 4. Agents / Council
  {
    id: 'agents',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Enterprise agent OS. Artifacts: Agent, Role, Task, Deliberation, Decision.',
  },
  {
    id: 'ml',
    status: 'hybrid',
    mergeTarget: 'agents',
    postMergeRole: 'engine',
    rationale: 'ML is an engine powering agents, not a standalone product.',
  },

  // 5. Simulation / Forecasting
  {
    id: 'sim',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Simulation super-lens. Artifacts: Scenario, AssumptionSet, SimulationRun, OutcomeDistribution.',
  },

  // 6. Studio (Creative Super-Lens)
  {
    id: 'studio',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Creative production studio super-lens. Artifacts: Project, Track, Effect, Session, Mixdown.',
  },
  {
    id: 'art',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Visual art creation and gallery. Artifacts: Artwork, Collection, Style, Gallery, Exhibition.',
  },
  {
    id: 'music',
    status: 'hybrid',
    mergeTarget: 'studio',
    postMergeRole: 'mode',
    rationale: 'Music creation is a Studio mode.',
  },
  {
    id: 'game',
    status: 'hybrid',
    mergeTarget: 'studio',
    postMergeRole: 'mode',
    rationale: 'Game development is a Studio mode.',
  },
  {
    id: 'ar',
    status: 'hybrid',
    mergeTarget: 'studio',
    postMergeRole: 'mode',
    rationale: 'AR experiences are a Studio mode.',
  },
  {
    id: 'fractal',
    status: 'viewer',
    mergeTarget: 'studio',
    postMergeRole: 'mode',
    rationale: 'Fractal visualization is a Studio generative mode.',
  },

  // 7. Legal / Policy
  {
    id: 'law',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Legal super-lens. Artifacts: CaseFile, Clause, Draft, PrecedentGraph.',
  },

  // 8. Knowledge Graph / Entity
  {
    id: 'graph',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Knowledge graph super-lens. Artifacts: Entity, Relation, Assertion, Source.',
  },
  {
    id: 'entity',
    status: 'hybrid',
    mergeTarget: 'graph',
    postMergeRole: 'mode',
    rationale: 'Entity browser is a Knowledge Graph mode.',
  },
  {
    id: 'invariant',
    status: 'viewer',
    mergeTarget: 'graph',
    postMergeRole: 'engine',
    rationale: 'Invariant checking is a Knowledge Graph engine.',
  },
  {
    id: 'meta',
    status: 'viewer',
    mergeTarget: 'graph',
    postMergeRole: 'absorbed',
    rationale: 'Meta-information feeds Knowledge Graph.',
  },

  // 9. Collaboration / Whiteboard
  {
    id: 'whiteboard',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Collaboration super-lens. Artifacts: Board, Node, Connection, Comment.',
  },
  {
    id: 'collab',
    status: 'hybrid',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Real-time collab is a Collaboration mode.',
  },

  // 10. Database / Structured Knowledge
  {
    id: 'database',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Structured knowledge lens. Artifacts: Table, Record, Schema, View.',
  },

  // ═══════════════════════════════════════════════════════════════
  // MERGE GROUP A — Into Research super-lens as modes
  // These are conceptually inseparable from research.
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'hypothesis',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Hypothesis testing is a Research mode.',
  },
  {
    id: 'reflection',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Self-reflection is a Research mode.',
  },
  {
    id: 'inference',
    status: 'deprecated',
    mergeTarget: 'reasoning',
    postMergeRole: 'mode',
    rationale: 'Inference engine is a Reasoning mode.',
  },
  {
    id: 'metacognition',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Metacognition is a Research cognitive-audit mode.',
  },
  {
    id: 'metalearning',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Learning strategy optimization is a Research mode.',
  },
  {
    id: 'commonsense',
    status: 'deprecated',
    mergeTarget: 'graph',
    postMergeRole: 'engine',
    rationale: 'Commonsense knowledge feeds Knowledge Graph.',
  },
  {
    id: 'attention',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Attention management is a Research mode.',
  },
  {
    id: 'experience',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Experience learning is a Research mode.',
  },
  {
    id: 'suffering',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Suffering detection is a Research / ethics mode.',
  },
  {
    id: 'organ',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'absorbed',
    rationale: 'Organization tools absorbed into Research.',
  },
  {
    id: 'affect',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'engine',
    rationale: 'Affect engine feeds Research as emotional-state tracking.',
  },
  {
    id: 'transfer',
    status: 'deprecated',
    mergeTarget: 'paper',
    postMergeRole: 'engine',
    rationale: 'Transfer learning is a Research engine.',
  },
  {
    id: 'grounding',
    status: 'deprecated',
    mergeTarget: 'graph',
    postMergeRole: 'engine',
    rationale: 'Grounding feeds Knowledge Graph entity resolution.',
  },

  // ═══════════════════════════════════════════════════════════════
  // MERGE GROUP B — Into Science + Simulation as engines
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'math',
    status: 'deprecated',
    mergeTarget: 'sim',
    postMergeRole: 'engine',
    rationale: 'Math is a Simulation engine, not a standalone viewer.',
  },
  {
    id: 'physics',
    status: 'deprecated',
    mergeTarget: 'sim',
    postMergeRole: 'engine',
    rationale: 'Physics simulations are a Simulation engine.',
  },
  {
    id: 'quantum',
    status: 'deprecated',
    mergeTarget: 'sim',
    postMergeRole: 'engine',
    rationale: 'Quantum computing explorer is a Simulation engine.',
  },
  {
    id: 'chem',
    status: 'deprecated',
    mergeTarget: 'sim',
    postMergeRole: 'engine',
    rationale: 'Chemistry tools are a Simulation engine.',
  },
  {
    id: 'bio',
    status: 'deprecated',
    mergeTarget: 'sim',
    postMergeRole: 'engine',
    rationale: 'Biology tools are a Simulation engine.',
  },
  {
    id: 'neuro',
    status: 'deprecated',
    mergeTarget: 'sim',
    postMergeRole: 'engine',
    rationale: 'Neuroscience tools are a Simulation engine.',
  },

  // ═══════════════════════════════════════════════════════════════
  // MERGE GROUP D — Into Collaboration / Discourse
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'forum',
    status: 'deprecated',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Forum discussions become a Collaboration mode.',
  },
  {
    id: 'thread',
    status: 'deprecated',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Threaded conversations become a Collaboration mode.',
  },
  {
    id: 'feed',
    status: 'deprecated',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Feed/timeline becomes a Collaboration mode.',
  },
  {
    id: 'daily',
    status: 'deprecated',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Daily journal becomes a Collaboration mode.',
  },
  {
    id: 'news',
    status: 'deprecated',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'News aggregation becomes a Collaboration mode.',
  },
  {
    id: 'docs',
    status: 'deprecated',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Docs viewer becomes a Collaboration mode.',
  },

  // ═══════════════════════════════════════════════════════════════
  // CORE LENSES THAT STAY (not in the 10 but standalone)
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'chat',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Primary interaction surface. Artifact: Conversation.',
  },
  {
    id: 'code',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Code editing and execution. Artifact: Codebase, Snippet, Project.',
  },

  // ═══════════════════════════════════════════════════════════════
  // SYSTEM LENSES (infrastructure, not user-facing products)
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'admin',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System administration. Infrastructure.',
  },
  {
    id: 'repair-telemetry',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only operator dashboard over the repair (autonomic) domain — Homeostasis ledger + escalation inbox + Repair Memory stats. A monitoring surface, not a product: persist/dtu/pipeline are by-design-absent (it observes the repair loop, it does not author). Infrastructure.',
  },
  {
    id: 'ops-telemetry',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only operator dashboard over the concurrency/threading stack (a Datadog/Grafana analog) — heartbeat module p50/p90/p99 timings, macro + heartbeat worker pool utilisation, brain endpoint inflight/failures, per-world shard status + restart, and 24h inference cost. REST-backed by design: it fetches six admin-gated /api/admin/* routes, NOT the macro system. A monitoring surface, not a product: persistence/engine/pipeline/dtu are by-design-absent (it observes live server state over REST; the one mutation — shard restart — is an operator command on existing infra, not artifact authoring). Infrastructure.',
  },
  {
    id: 'lattice',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Brain self-training operator dashboard (an MLOps / Weights-&-Biases analog for the 4 cognitive brains) — consent corpus snapshot + per-creator training-consent control, per-brain corpus health, active models, run history with eval deltas, eval/loss curves, model rollback, refresh cadence + A/B candidate tests, consent audit log, and drift-monitor alerts. REST-backed by design: it binds to /api/lattice/* (routes/lattice.js) + /api/brains/* (routes/brains.js), NOT the macro system — there is no `lattice` macro domain. A monitoring/ops surface, not a product: pipeline/dtu_exhaust are by-design-absent (it inspects the training corpus and triggers admin refreshes; it does not author new knowledge DTUs). Infrastructure.',
  },
  {
    id: 'debug',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Debug console. Infrastructure.',
  },
  {
    id: 'audit',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Audit trail viewer. Infrastructure.',
  },
  {
    id: 'schema',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Schema management. Infrastructure.',
  },
  {
    id: 'integrations',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Third-party integrations. Infrastructure.',
  },
  {
    id: 'queue',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Job queue monitor. Infrastructure.',
  },
  {
    id: 'tick',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System tick monitor. Infrastructure.',
  },
  {
    id: 'lock',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Sovereignty lock status. Infrastructure.',
  },
  {
    id: 'offline',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Offline data manager. Infrastructure.',
  },
  {
    id: 'export',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Data export utility. Infrastructure.',
  },
  {
    id: 'import',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Data import utility. Infrastructure.',
  },
  {
    id: 'custom',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Custom lens builder. Infrastructure.',
  },

  {
    id: 'platform',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Mega platform dashboard. Infrastructure.',
  },
  {
    id: 'global',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Global DTU/artifact browser. Platform infrastructure.',
  },
  {
    id: 'hub',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Lens discovery hub. Platform infrastructure.',
  },

  // ═══════════════════════════════════════════════════════════════
  // REMAINING LENSES — classified for merge or standalone
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'resonance',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System health dashboard. Infrastructure.',
  },
  {
    id: 'marketplace',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Plugin marketplace. Needs productization.',
  },
  {
    id: 'market',
    status: 'hybrid',
    mergeTarget: 'marketplace',
    postMergeRole: 'mode',
    rationale: 'DTU market merges into general Marketplace.',
  },
  {
    id: 'questmarket',
    status: 'hybrid',
    mergeTarget: 'marketplace',
    postMergeRole: 'mode',
    rationale: 'Bounty system merges into Marketplace.',
  },
  {
    id: 'finance',
    status: 'hybrid',
    mergeTarget: 'sim',
    postMergeRole: 'mode',
    rationale: 'Financial tools become a Simulation/Forecasting mode.',
  },
  {
    id: 'anon',
    status: 'viewer',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Anonymous messaging becomes a Collaboration mode.',
  },
  {
    id: 'billing',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Billing is system infrastructure.',
  },
  {
    id: 'crypto',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Cryptography tools are system infrastructure.',
  },
  {
    id: 'lab',
    status: 'hybrid',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Lab experimentation is a Research mode.',
  },
  {
    id: 'voice',
    status: 'viewer',
    mergeTarget: 'studio',
    postMergeRole: 'mode',
    rationale: 'Voice I/O is a Studio mode.',
  },
  {
    id: 'temporal',
    status: 'viewer',
    mergeTarget: 'graph',
    postMergeRole: 'engine',
    rationale: 'Temporal reasoning feeds Knowledge Graph.',
  },
  {
    id: 'fork',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'DTU fork management is system infrastructure.',
  },
  {
    id: 'eco',
    status: 'viewer',
    mergeTarget: 'graph',
    postMergeRole: 'absorbed',
    rationale: 'Ecosystem overview absorbed into Knowledge Graph.',
  },
  {
    id: 'legacy',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Legacy data viewer. System infrastructure.',
  },
  {
    id: 'repos',
    status: 'hybrid',
    mergeTarget: 'code',
    postMergeRole: 'mode',
    rationale: 'Repository browser is a Code lens mode.',
  },
  {
    id: 'timeline',
    status: 'viewer',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Timeline is a Collaboration mode.',
  },
  {
    id: 'board',
    status: 'hybrid',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Kanban board is a Collaboration mode.',
  },
  {
    id: 'calendar',
    status: 'hybrid',
    mergeTarget: 'whiteboard',
    postMergeRole: 'mode',
    rationale: 'Calendar is a Collaboration mode.',
  },
  {
    id: 'goals',
    status: 'hybrid',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Goals feed Research planning.',
  },
  {
    id: 'srs',
    status: 'hybrid',
    mergeTarget: 'paper',
    postMergeRole: 'mode',
    rationale: 'Spaced repetition supports Research learning.',
  },

  // ═══════════════════════════════════════════════════════════════
  // SUPER-LENSES — 23 universal-coverage product lenses
  // These expand Concord from cognitive-domain to ALL human work.
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'healthcare',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Healthcare super-lens. Absorbs clinical, pharmacy, mental health, veterinary, dental, PT, rehab, emergency, home health, research trials, nutrition.',
  },
  {
    id: 'trades',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Trades super-lens. Absorbs general contracting, electrical, plumbing, HVAC, welding, landscaping, auto mechanics, carpentry.',
  },
  {
    id: 'food',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Food & Hospitality super-lens. Absorbs restaurant, catering, brewing, bakery, hotel, bar, food truck.',
  },
  {
    id: 'retail',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Retail super-lens. Absorbs inventory, POS, CRM, helpdesk, e-commerce, merchandising, wholesale.',
  },
  {
    id: 'household',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Household super-lens. Absorbs family coordination, childcare, pet care, home maintenance, elder care, event planning, moving.',
  },
  {
    id: 'accounting',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Accounting super-lens. Absorbs bookkeeping, invoicing, tax prep, payroll, personal budgeting, rental property, insurance tracking.',
  },
  {
    id: 'agriculture',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Agriculture super-lens. Absorbs crop management, livestock, farm equipment, irrigation, harvest/storage, organic certification.',
  },
  {
    id: 'logistics',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Logistics super-lens. Absorbs fleet management, shipping, warehouse, route planning, CDL compliance, moving operations.',
  },
  {
    id: 'education',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Education super-lens. Absorbs classroom, tutoring, school admin, corporate training, driving school, studio management.',
  },
  {
    id: 'legal',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Legal super-lens. Absorbs case management, contract lifecycle, compliance tracking, immigration, IP portfolio.',
  },
  {
    id: 'nonprofit',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Nonprofit super-lens. Absorbs donor management, grant tracking, volunteer coordination, impact reporting, religious org, community organizing.',
  },
  {
    id: 'realestate',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Real Estate super-lens. Absorbs listings, transaction coordination, property management, investing, appraisal.',
  },
  {
    id: 'fitness',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Fitness super-lens. Absorbs personal training, gym management, yoga, sports coaching, athletic recruiting.',
  },
  {
    id: 'creative',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Creative Production super-lens. Absorbs photography, video, podcast, fashion, interior design, print/graphic design.',
  },
  {
    id: 'manufacturing',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Manufacturing super-lens. Absorbs production scheduling, quality control, BOM, equipment maintenance, safety/OSHA.',
  },
  {
    id: 'environment',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Environment super-lens. Absorbs wildlife management, forestry, marine/fisheries, park/trail, environmental monitoring, waste management.',
  },
  {
    id: 'government',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Government super-lens. Absorbs permitting, public works, code enforcement, emergency management, public records, court admin.',
  },
  {
    id: 'aviation',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Aviation & Maritime super-lens. Absorbs flight planning, pilot logbooks, marina management, charter operations.',
  },
  {
    id: 'events',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Events super-lens. Absorbs venue management, touring, festivals, DJ/performer management, theater production.',
  },
  {
    id: 'science',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Science super-lens. Absorbs field data collection, lab management, archaeological sites, geological survey/mining.',
  },
  {
    id: 'security',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Security super-lens. Absorbs physical security, cybersecurity ops, investigations, loss prevention.',
  },
  {
    id: 'services',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Personal Services super-lens. Absorbs salon, cleaning, handyman, daycare, dog walking, tattoo studio.',
  },
  {
    id: 'insurance',
    status: 'product',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Insurance super-lens. Absorbs policy tracking, claims management, risk assessment, benefits administration.',
  },

  // ── Status entries added to satisfy validate-lens-quality registry coverage ──
  // Each domain has a working frontend + backend; classified by whether it stands
  // alone or merges into a parent product lens.

  { id: 'landscaping', status: 'hybrid', mergeTarget: 'home-improvement', postMergeRole: 'mode', rationale: 'Outdoor counterpart of home-improvement; same project/estimate/job model.' },
  { id: 'law-enforcement', status: 'hybrid', mergeTarget: 'law', postMergeRole: 'mode', rationale: 'Investigations + case management overlap entirely with the Law product lens.' },
  { id: 'masonry', status: 'hybrid', mergeTarget: 'trades', postMergeRole: 'mode', rationale: 'Trade specialty; rolls up with carpentry/welding/plumbing.' },
  { id: 'materials', status: 'hybrid', mergeTarget: 'engineering', postMergeRole: 'mode', rationale: 'Materials science is an engineering sub-discipline.' },
  { id: 'mining', status: 'hybrid', mergeTarget: 'geology', postMergeRole: 'mode', rationale: 'Operational extraction of geological resources.' },
  { id: 'ocean', status: 'hybrid', mergeTarget: 'environment', postMergeRole: 'mode', rationale: 'Marine ecosystem analysis is a mode of environmental science.' },
  { id: 'pharmacy', status: 'hybrid', mergeTarget: 'healthcare', postMergeRole: 'mode', rationale: 'Pharmacy operations integrate with patient records.' },
  { id: 'plumbing', status: 'hybrid', mergeTarget: 'trades', postMergeRole: 'mode', rationale: 'Trade specialty.' },
  { id: 'supplychain', status: 'hybrid', mergeTarget: 'logistics', postMergeRole: 'mode', rationale: 'Supply chain operations overlap with logistics.' },
  { id: 'telecommunications', status: 'hybrid', mergeTarget: 'engineering', postMergeRole: 'mode', rationale: 'Network engineering sub-discipline.' },
  { id: 'urban-planning', status: 'hybrid', mergeTarget: 'government', postMergeRole: 'mode', rationale: 'Civic planning under government.' },
  { id: 'veterinary', status: 'hybrid', mergeTarget: 'healthcare', postMergeRole: 'mode', rationale: 'Animal healthcare uses the same patient/diagnosis pipeline.' },
  { id: 'welding', status: 'hybrid', mergeTarget: 'trades', postMergeRole: 'mode', rationale: 'Trade specialty.' },
  { id: 'desert', status: 'hybrid', mergeTarget: 'environment', postMergeRole: 'mode', rationale: 'Biome-specific environmental analysis.' },
  { id: 'animation', status: 'hybrid', mergeTarget: 'film-studios', postMergeRole: 'mode', rationale: 'Animation is a production mode within Film Studios.' },
  { id: 'artistry', status: 'hybrid', mergeTarget: 'art', postMergeRole: 'mode', rationale: 'Skill-tracking specialization of the Art lens.' },
  { id: 'creative-writing', status: 'hybrid', mergeTarget: 'paper', postMergeRole: 'mode', rationale: 'Long-form authoring uses Paper artifacts.' },
  { id: 'film-studios', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Film production super-lens. Absorbs animation, cinematography, editing.' },
  { id: 'game-design', status: 'hybrid', mergeTarget: 'game', postMergeRole: 'mode', rationale: 'Design phase of game development; same artifact set.' },
  { id: 'photography', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Vision-enabled photography product (LLaVA EXIF + composition + gear).' },
  { id: 'poetry', status: 'hybrid', mergeTarget: 'creative-writing', postMergeRole: 'mode', rationale: 'Form-aware mode of creative-writing.' },
  { id: 'astronomy', status: 'hybrid', mergeTarget: 'space', postMergeRole: 'mode', rationale: 'Observational astronomy under the broader Space lens.' },
  { id: 'atlas', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Foundation Atlas — taxonomy + signal cortex; load-bearing for the lattice.' },
  { id: 'history', status: 'hybrid', mergeTarget: 'paper', postMergeRole: 'mode', rationale: 'Primary-source research uses Paper artifacts.' },
  { id: 'linguistics', status: 'hybrid', mergeTarget: 'paper', postMergeRole: 'mode', rationale: 'Linguistic analysis fits the research pipeline.' },
  { id: 'philosophy', status: 'hybrid', mergeTarget: 'reasoning', postMergeRole: 'mode', rationale: 'Argument construction is the Reasoning product lens.' },
  { id: 'robotics', status: 'hybrid', mergeTarget: 'engineering', postMergeRole: 'mode', rationale: 'Robotics is an engineering specialty.' },
  { id: 'space', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Space mission planning + orbital mechanics + payload integration.' },
  { id: 'marketing', status: 'hybrid', mergeTarget: 'creator', postMergeRole: 'mode', rationale: 'Marketing flows in support of creator distribution.' },
  { id: 'mental-health', status: 'hybrid', mergeTarget: 'healthcare', postMergeRole: 'mode', rationale: 'Therapy + assessment fit healthcare patient model.' },
  { id: 'projects', status: 'hybrid', mergeTarget: 'goals', postMergeRole: 'mode', rationale: 'Project tracking is a goals super-lens mode.' },
  { id: 'command-center', status: 'system', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Operations dashboard for live runtime; system lens.' },
  { id: 'crafting', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Recipe substrate (cooking/spell/fighting/blueprint) with tier-pricing marketplace.' },
  { id: 'understanding', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Compounding-knowledge substrate workbench. Parse / compose / evolve / consolidate.' },
  { id: 'message',       status: 'system',  mergeTarget: null, postMergeRole: 'standalone', rationale: 'Direct messaging — Gmail-shape inbox over /api/social/dm/*.' },
  { id: 'ux-suite',      status: 'system',  mergeTarget: null, postMergeRole: 'standalone', rationale: '20 absorbed UX components mounted in a tabbed suite (settings / progress / world / ops / shell).' },
  { id: 'settings', status: 'system', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Cross-platform user preferences; system lens.' },
  { id: 'creator', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Creator hub: royalty streams, tier pricing, creator score, follower graph.' },
  { id: 'federation', status: 'system', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Cross-instance shadow DTU export/import; system lens.' },
  { id: 'black-market', status: 'hybrid', mergeTarget: 'marketplace', postMergeRole: 'mode', rationale: 'Gray-market mode of the marketplace lens; sparks-only currency.' },
  { id: 'genesis', status: 'hybrid', mergeTarget: 'world', postMergeRole: 'mode', rationale: 'Emergent identity feed; surface for the world’s living entities.' },
  { id: 'world-creator/anomalies', status: 'hybrid', mergeTarget: 'world', postMergeRole: 'mode', rationale: 'Public + creator anomaly viewer for created worlds; hybrid mode of the world product lens.' },
  { id: 'root', status: 'system', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Refusal-algebra glyph calculator (client-side); system tool.' },
  // (hub already classified at line 542 above; do not duplicate.)

  // ── Remaining registry entries (round 2) ──

  { id: 'dtus', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'DTU substrate spine — browse, lineage, marketplace, royalty cascade.' },
  { id: 'podcast', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Podcast production: episodes, transcripts, distribution.' },
  { id: 'research', status: 'hybrid', mergeTarget: 'paper', postMergeRole: 'mode', rationale: 'Research workflows fit Paper artifact pipeline.' },
  { id: 'answers', status: 'hybrid', mergeTarget: 'chat', postMergeRole: 'mode', rationale: 'Oracle-backed Q&A surface; integrates with chat context.' },
  { id: 'cri', status: 'system', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Coordinated Reflection Index — system observability + epistemic dashboard.' },
  { id: 'ingest', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Universal ingestion pipeline — file/URL/stream → DTU.' },
  { id: 'travel', status: 'hybrid', mergeTarget: 'lifestyle', postMergeRole: 'mode', rationale: 'Trip planning, itineraries, bookings.' },
  { id: 'fashion', status: 'hybrid', mergeTarget: 'lifestyle', postMergeRole: 'mode', rationale: 'Wardrobe + outfit + style log.' },
  { id: 'cooking', status: 'hybrid', mergeTarget: 'food', postMergeRole: 'mode', rationale: 'Home-cooking mode of the Food product lens.' },
  { id: 'home-improvement', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Home projects super-lens — absorbs DIY, landscaping, repair tracking.' },
  { id: 'parenting', status: 'hybrid', mergeTarget: 'household', postMergeRole: 'mode', rationale: 'Child-rearing mode of household management.' },
  { id: 'pets', status: 'hybrid', mergeTarget: 'household', postMergeRole: 'mode', rationale: 'Pet care + veterinary records integrated with household.' },
  { id: 'sports', status: 'hybrid', mergeTarget: 'fitness', postMergeRole: 'mode', rationale: 'Game/match tracking is a fitness mode.' },
  { id: 'diy', status: 'hybrid', mergeTarget: 'home-improvement', postMergeRole: 'mode', rationale: 'DIY projects fit home-improvement.' },
  { id: 'debate', status: 'hybrid', mergeTarget: 'reasoning', postMergeRole: 'mode', rationale: 'Argument mapping mode of reasoning.' },
  { id: 'mentorship', status: 'hybrid', mergeTarget: 'education', postMergeRole: 'mode', rationale: 'Mentor relationships within education.' },
  { id: 'app-maker', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'No-code/low-code app builder.' },
  { id: 'analytics', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Cross-lens analytics + KPIs surface.' },
  { id: 'bridge', status: 'system', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Cross-domain bridge for cross-lens search + relationships.' },
  { id: 'disputes', status: 'hybrid', mergeTarget: 'law', postMergeRole: 'mode', rationale: 'Conflict resolution flows under law.' },
  { id: 'privacy', status: 'hybrid', mergeTarget: 'security', postMergeRole: 'mode', rationale: 'Privacy controls and audit; hybrid mode of security.' },
  { id: 'wallet', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Concord Coin wallet, transactions, balance, withdrawal.' },
  { id: 'world', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Concordia 3D world — terrain, avatars, combat, dialogue, NPCs.' },
  { id: 'all', status: 'hybrid', mergeTarget: 'hub', postMergeRole: 'mode', rationale: 'Aggregate "all lenses" view; hybrid mode of Hub.' },
  { id: 'automotive', status: 'hybrid', mergeTarget: 'trades', postMergeRole: 'mode', rationale: 'Automotive service trades.' },
  { id: 'carpentry', status: 'hybrid', mergeTarget: 'trades', postMergeRole: 'mode', rationale: 'Trade specialty.' },
  { id: 'construction', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Construction project management super-lens.' },
  { id: 'consulting', status: 'hybrid', mergeTarget: 'services', postMergeRole: 'mode', rationale: 'Consulting engagements.' },
  { id: 'defense', status: 'hybrid', mergeTarget: 'government', postMergeRole: 'mode', rationale: 'Defense ops fit government.' },
  { id: 'electrical', status: 'hybrid', mergeTarget: 'trades', postMergeRole: 'mode', rationale: 'Trade specialty.' },
  { id: 'emergency-services', status: 'hybrid', mergeTarget: 'services', postMergeRole: 'mode', rationale: 'Emergency response services.' },
  { id: 'energy', status: 'hybrid', mergeTarget: 'engineering', postMergeRole: 'mode', rationale: 'Energy systems engineering.' },
  { id: 'engineering', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Engineering disciplines super-lens — absorbs robotics, materials, energy, telecommunications.' },
  { id: 'forestry', status: 'hybrid', mergeTarget: 'agriculture', postMergeRole: 'mode', rationale: 'Forestry as land-management mode.' },
  { id: 'geology', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Geological surveys, mapping, sampling.' },
  { id: 'hr', status: 'product', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Human resources: employees, payroll, performance.' },
  { id: 'hvac', status: 'hybrid', mergeTarget: 'trades', postMergeRole: 'mode', rationale: 'Trade specialty.' },

  // ── Reader lens (self-contained authored content; backend-less by design) ──
  // narrative-walk is a viewer over the 11 authored cinematic JSONs bundled at
  // build time (concord-frontend/content/cinematics/*.json). It has NO API
  // surface of its own — verify-lens-backends reports NO-BACKEND-CALL by design.
  // A reader surfaces authored content; it does not author, persist, or emit a
  // DTU artifact, so it stays a viewer and never advances to product.
  { id: 'narrative-walk', status: 'viewer', mergeTarget: null, postMergeRole: 'standalone', rationale: 'Self-contained authored-narrative reader over the 11 bundled cinematic sequences; backend-less by design (NO-BACKEND-CALL is intentional).' },

  // ═══════════════════════════════════════════════════════════════
  // STATUS-MAP COMPLETENESS — registry lenses added across later sprints.
  // Every registry lens must appear here (validate-lens-quality gate).
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'literary',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'translation',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'quests',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'auction',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'lfg',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'achievements',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'training-room',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'housing',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'announcements',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'detective',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'photos',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'mail',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'spectate',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'courtship',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'fishing',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'creatures',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'garage',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'move-builder',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'codex',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only viewer/reader surface.',
  },
  {
    id: 'reasoning-traces',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only HLR reasoning-trace observability console (Phase Z1); infra surface, not a product upgrade-lane lens.',
  },
  {
    id: 'civic-bonds',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'careers',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'bounties',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'byo-keys',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'classroom',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'code-quality',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'cognition',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'cognitive-replay',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only viewer/reader surface.',
  },
  {
    id: 'crisis-ops',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'death-insurance',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'deities',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'dreams',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'dx-platform',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'event-timeline',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only viewer/reader surface.',
  },
  {
    id: 'expert-mode',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'forecast',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only viewer/reader surface.',
  },
  {
    id: 'forge',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'ledger',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only viewer/reader surface.',
  },
  {
    id: 'foundry',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'gallery',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only viewer/reader surface.',
  },
  {
    id: 'ghost-tracker',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only viewer/reader surface.',
  },
  {
    id: 'goddess',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'inheritance',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'kingdoms',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'maker',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'markets',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'meditation',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'mesh',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'observe',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'ops',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'personas',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'productivity',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'psyops',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'sandbox',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'saved',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'self',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'sentinel',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'sessions',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'social',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'society',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'sponsorship',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'staking',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'sub-worlds',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'sync',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'system',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'tools',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'tournaments',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'wellness',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'world-creator',
    status: 'hybrid',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Functional feature lens (upgrade-lane; CRUD completeness tracked as a warning).',
  },
  {
    id: 'worldmodel',
    status: 'system',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'System/infra console (not a product upgrade-lane lens).',
  },
  {
    id: 'expedition-journal',
    status: 'viewer',
    mergeTarget: null,
    postMergeRole: 'standalone',
    rationale: 'Read-only journal/log viewer over recorded expedition data; no CRUD upgrade-lane.',
  },
];

// ── Derived helpers ─────────────────────────────────────────────

const _statusMap = new Map(LENS_STATUS_MAP.map(e => [e.id, e]));

/** Get status entry for a lens. */
export function getLensStatus(id: string): LensStatusEntry | undefined {
  return _statusMap.get(id);
}

/** Get all lenses with a given status. */
export function getLensesByStatus(status: LensStatus): LensStatusEntry[] {
  return LENS_STATUS_MAP.filter(e => e.status === status);
}

/** Get all lenses that merge into a given target. */
export function getLensesMergingInto(targetId: string): LensStatusEntry[] {
  return LENS_STATUS_MAP.filter(e => e.mergeTarget === targetId);
}

/** Get all standalone product lenses (the ones Concord bets on). */
export function getProductLenses(): LensStatusEntry[] {
  return LENS_STATUS_MAP.filter(e => e.status === 'product' && e.postMergeRole === 'standalone');
}

/** Get all deprecated lenses (scheduled for merge). */
export function getDeprecatedLenses(): LensStatusEntry[] {
  return LENS_STATUS_MAP.filter(e => e.status === 'deprecated');
}

/** Check if a lens is safe to show in public UI (not deprecated, not system). */
export function isPublicLens(id: string): boolean {
  const entry = _statusMap.get(id);
  if (!entry) return false;
  return entry.status === 'product' || entry.status === 'hybrid';
}

/** Summary statistics. */
export function getLensStatusSummary(): Record<LensStatus, number> {
  const counts: Record<LensStatus, number> = { product: 0, hybrid: 0, viewer: 0, system: 0, deprecated: 0 };
  for (const e of LENS_STATUS_MAP) {
    counts[e.status]++;
  }
  return counts;
}
