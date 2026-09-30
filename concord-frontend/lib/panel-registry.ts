// concord-frontend/lib/panel-registry.ts
//
// Global panel registry — makes Concord's existing self-contained panels
// addressable by a stable dotted id ("domain.panel") and mountable in ANY lens,
// not just the page they were authored in. This is the "parts bin" that turns
// ~235 tool-lenses into features-of-destinations without building anything new.
//
// THE LOAD-BEARING RULE: every component is referenced through a LAZY `load`
// thunk (`() => import(...)`), never a top-level import. A static import here
// would pull all registered panels into every bundle. The thunk lets the host
// code-split each panel and fetch it only when actually mounted.
//
// Eligibility: only register panels that are SELF-CONTAINED — they fetch their
// own data via `lensRun` and take no props (or only an optional `onChange`).
// Panels that need a lens-specific id (e.g. `patientId`) are intentionally NOT
// here; they can't be cross-mounted without their home page's context.

import type { ComponentType } from 'react';

export interface PanelEntry {
  /** Stable dotted id: "<sourceDomain>.<panel>" e.g. "finance.accounts". */
  id: string;
  /** Human label shown in the command palette + cross-mount tab strip. */
  label: string;
  /** LAZY loader — `() => import('@/components/...')`, normalized to { default }. */
  load: () => Promise<{ default: ComponentType<unknown> }>;
  /** 'global' = cross-mountable anywhere; 'world' = world-HUD-scoped (future). */
  scope: 'global' | 'world';
  /** Search keywords for the command palette. */
  keywords?: string[];
  /** One-line description for the palette. */
  description?: string;
}

// Normalize a (possibly named) export to the { default } shape React.lazy wants,
// while keeping the dynamic import lazy (the import() runs only when invoked).
function lazyNamed(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
): () => Promise<{ default: ComponentType<unknown> }> {
  return () =>
    loader().then((m) => ({
      default: (m[exportName] ?? m.default) as ComponentType<unknown>,
    }));
}

// ── Registry ────────────────────────────────────────────────────────────────
// Seeded with verified self-contained panels (no-prop or onChange-only) drawn
// from the cross-mount-candidate domains. Grow incrementally — every addition
// must be confirmed self-contained (see eligibility note above).
export const PANEL_REGISTRY: Record<string, PanelEntry> = {
  // — finance-adjacent (money / holdings / ratios / utility cost) —
  'crypto.portfolio': {
    id: 'crypto.portfolio', label: 'Crypto Portfolio', scope: 'global',
    keywords: ['crypto', 'wallet', 'holdings', 'portfolio', 'coins'],
    description: 'Your crypto holdings and balances',
    load: lazyNamed(() => import('@/components/crypto/PortfolioPanel'), 'PortfolioPanel'),
  },
  'accounting.budgets': {
    id: 'accounting.budgets', label: 'Budgets', scope: 'global',
    keywords: ['budget', 'accounting', 'variance', 'spend'],
    description: 'Budget vs. actual by account',
    load: lazyNamed(() => import('@/components/accounting/AcBudgetsPanel'), 'AcBudgetsPanel'),
  },
  'accounting.ratios': {
    id: 'accounting.ratios', label: 'Financial Ratios', scope: 'global',
    keywords: ['ratios', 'accounting', 'liquidity', 'solvency'],
    description: 'Liquidity, solvency and profitability ratios',
    load: lazyNamed(() => import('@/components/accounting/AcRatiosPanel'), 'AcRatiosPanel'),
  },
  'energy.billing': {
    id: 'energy.billing', label: 'Energy Costs', scope: 'global',
    keywords: ['energy', 'bill', 'electricity', 'utility', 'cost'],
    description: 'Energy billing and cost breakdown',
    load: lazyNamed(() => import('@/components/energy/EnergyBillingPanel'), 'EnergyBillingPanel'),
  },
  'markets.depth-chart': {
    id: 'markets.depth-chart', label: 'Order Book Depth', scope: 'global',
    keywords: ['order book', 'depth', 'markets', 'prediction', 'trading', 'bids'],
    description: 'Real resting-order depth for an open prediction market',
    load: () => import('@/components/markets/PredictionDepthPanel'),
  },
  'finance.ticker-tape': {
    id: 'finance.ticker-tape', label: 'Live Price Ticker', scope: 'global',
    keywords: ['ticker', 'tape', 'prices', 'live', 'crypto'],
    description: 'Scrolling live crypto price tape',
    // TickerTape takes an optional `className` for its direct mount in
    // finance/page.tsx, so its default export isn't structurally a bare
    // ComponentType<unknown> — cast explicitly (same as lazyNamed does).
    load: () => import('@/components/finance/TickerTape').then((m) => ({ default: m.default as unknown as ComponentType<unknown> })),
  },

  // — healthcare-adjacent (self-care / wellness / pharmacy / fitness) —
  'wellness.daily-recommendation': {
    id: 'wellness.daily-recommendation', label: 'Daily Wellness', scope: 'global',
    keywords: ['wellness', 'recommendation', 'recovery', 'mood', 'daily'],
    description: "Today's recovery-band recommendation",
    load: lazyNamed(() => import('@/components/wellness/DailyRecommendationPanel'), 'DailyRecommendationPanel'),
  },
  'wellness.cbt': {
    id: 'wellness.cbt', label: 'CBT Prompts', scope: 'global',
    keywords: ['cbt', 'therapy', 'mental', 'reframe', 'mood'],
    description: 'Cognitive-reframe prompts and records',
    load: lazyNamed(() => import('@/components/wellness/CBTPanel'), 'CBTPanel'),
  },
  'fitness.training': {
    id: 'fitness.training', label: 'Training Load', scope: 'global',
    keywords: ['fitness', 'training', 'strava', 'load', 'workout'],
    description: 'Training load and readiness',
    load: lazyNamed(() => import('@/components/fitness/StravaTrainingPanel'), 'StravaTrainingPanel'),
  },
  'pharmacy.adherence': {
    id: 'pharmacy.adherence', label: 'Rx Adherence', scope: 'global',
    keywords: ['pharmacy', 'medication', 'adherence', 'rx', 'streak'],
    description: 'Medication adherence calendar and streaks',
    load: lazyNamed(() => import('@/components/pharmacy/RxAdherencePanel'), 'RxAdherencePanel'),
  },
  'pharmacy.price-lookup': {
    id: 'pharmacy.price-lookup', label: 'Rx Price Lookup', scope: 'global',
    keywords: ['pharmacy', 'price', 'drug', 'cost', 'rx'],
    description: 'Compare medication prices',
    load: lazyNamed(() => import('@/components/pharmacy/RxPriceLookupPanel'), 'RxPriceLookupPanel'),
  },

  // — code-adjacent (dev tooling) —
  'code-quality.pr-decoration': {
    id: 'code-quality.pr-decoration', label: 'PR Quality', scope: 'global',
    keywords: ['code', 'quality', 'pr', 'review', 'lint'],
    description: 'Pull-request quality verdict',
    load: lazyNamed(() => import('@/components/code-quality/PRDecorationPanel'), 'PRDecorationPanel'),
  },
  'observe.action': {
    id: 'observe.action', label: 'Observability', scope: 'global',
    keywords: ['observe', 'telemetry', 'monitor', 'metrics', 'trace'],
    description: 'Monitors, traces and on-call status',
    load: lazyNamed(() => import('@/components/observe/ObserveActionPanel'), 'ObserveActionPanel'),
  },

  // — generally-useful, summonable anywhere —
  'astronomy.targets': {
    id: 'astronomy.targets', label: 'Astronomy Targets', scope: 'global',
    keywords: ['astronomy', 'targets', 'observation', 'sky', 'stars'],
    description: 'Observation target list and catalog',
    load: lazyNamed(() => import('@/components/astronomy/AstroTargetsPanel'), 'AstroTargetsPanel'),
  },
  'food.discover': {
    id: 'food.discover', label: 'Food Discovery', scope: 'global',
    keywords: ['food', 'restaurant', 'discover', 'yelp', 'eat'],
    description: 'Discover nearby food and restaurants',
    load: lazyNamed(() => import('@/components/food/YelpDiscoverPanel'), 'YelpDiscoverPanel'),
  },

  // — destination-tier cross-mounts (verified self-contained: no-prop / onChange-only) —
  'finance.accounts': {
    id: 'finance.accounts', label: 'Accounts', scope: 'global',
    keywords: ['finance', 'accounts', 'balances', 'bank', 'networth'],
    description: 'Linked accounts and balances',
    load: lazyNamed(() => import('@/components/finance/AccountsPanel'), 'AccountsPanel'),
  },
  'music.library': {
    id: 'music.library', label: 'Music Library', scope: 'global',
    keywords: ['music', 'library', 'tracks', 'songs'],
    description: 'Your track library',
    load: lazyNamed(() => import('@/components/music/MusicLibraryPanel'), 'MusicLibraryPanel'),
  },
  'music.radio': {
    id: 'music.radio', label: 'Radio', scope: 'global',
    keywords: ['music', 'radio', 'stream', 'station'],
    description: 'Radio and streaming',
    load: lazyNamed(() => import('@/components/music/MusicRadioPanel'), 'MusicRadioPanel'),
  },
  'research.academic-search': {
    id: 'research.academic-search', label: 'Academic Search', scope: 'global',
    keywords: ['research', 'papers', 'academic', 'search', 'scholar'],
    description: 'Search academic papers',
    load: lazyNamed(() => import('@/components/research/AcademicSearchPanel'), 'AcademicSearchPanel'),
  },
  'projects.portfolio': {
    id: 'projects.portfolio', label: 'Project Portfolio', scope: 'global',
    keywords: ['projects', 'portfolio', 'tasks', 'gantt'],
    description: 'Project portfolio overview',
    load: lazyNamed(() => import('@/components/projects/PjPortfolioPanel'), 'PjPortfolioPanel'),
  },
  'legal.matters': {
    id: 'legal.matters', label: 'Legal Matters', scope: 'global',
    keywords: ['legal', 'matters', 'cases', 'law'],
    description: 'Open legal matters',
    load: lazyNamed(() => import('@/components/legal/MattersPanel'), 'MattersPanel'),
  },
  'marketplace.listings': {
    id: 'marketplace.listings', label: 'Listings', scope: 'global',
    keywords: ['marketplace', 'listings', 'shop', 'sell'],
    description: 'Marketplace listings',
    load: lazyNamed(() => import('@/components/marketplace/ListingsPanel'), 'ListingsPanel'),
  },
  'marketplace.orders': {
    id: 'marketplace.orders', label: 'Orders', scope: 'global',
    keywords: ['marketplace', 'orders', 'sales', 'fulfilment'],
    description: 'Orders and fulfilment',
    load: lazyNamed(() => import('@/components/marketplace/OrdersPanel'), 'OrdersPanel'),
  },
  'creator.revenue': {
    id: 'creator.revenue', label: 'Creator Revenue', scope: 'global',
    keywords: ['creator', 'revenue', 'earnings', 'royalties'],
    description: 'Creator revenue and payouts',
    load: lazyNamed(() => import('@/components/creator/CrtRevenuePanel'), 'CrtRevenuePanel'),
  },
  'creator.audience': {
    id: 'creator.audience', label: 'Audience', scope: 'global',
    keywords: ['creator', 'audience', 'followers', 'demographics'],
    description: 'Audience analytics',
    load: lazyNamed(() => import('@/components/creator/CrtAudiencePanel'), 'CrtAudiencePanel'),
  },
  'council.theater': {
    id: 'council.theater', label: 'Council Theater', scope: 'global',
    keywords: ['council', 'governance', 'debate', 'sessions'],
    description: 'Live council sessions',
    load: lazyNamed(() => import('@/components/council/CouncilTheaterPanel'), 'CouncilTheaterPanel'),
  },
  'message.directory': {
    id: 'message.directory', label: 'Directory', scope: 'global',
    keywords: ['message', 'directory', 'contacts', 'people'],
    description: 'People directory',
    load: lazyNamed(() => import('@/components/message/DirectoryPanel'), 'DirectoryPanel'),
  },

  // — ConKay cockpit panel lane (F1, docs/NEXT_ARC_PLAN.md Wave 1 / K2) —
  'conkay.telemetry': {
    id: 'conkay.telemetry', label: 'System Work', scope: 'global',
    keywords: ['conkay', 'telemetry', 'macro', 'backend', 'work'],
    description: 'Recent real macro:completed backend runs',
    load: lazyNamed(() => import('@/components/conkay/panels/ConKayTelemetryPanel'), 'ConKayTelemetryPanel'),
  },
  'conkay.macro-library': {
    id: 'conkay.macro-library', label: 'Macro Library', scope: 'global',
    keywords: ['conkay', 'macro', 'library', 'actions', 'lens-actions'],
    description: 'Real registered macros for the active domain (live / AI-backed / compute)',
    load: lazyNamed(() => import('@/components/conkay/panels/MacroLibraryPanel'), 'MacroLibraryPanel'),
  },
  'conkay.provenance': {
    id: 'conkay.provenance', label: 'DTU Provenance', scope: 'global',
    keywords: ['conkay', 'provenance', 'verify', 'citation', 'dtu', 'graph'],
    description: 'The real reason.verify verdict + the DTU refs it checked',
    load: lazyNamed(() => import('@/components/conkay/panels/ProvenancePanel'), 'ProvenancePanel'),
  },
  'conkay.forward-sim': {
    id: 'conkay.forward-sim', label: 'Forward Sim', scope: 'global',
    keywords: ['conkay', 'forward', 'sim', 'fea', 'simulation', 'stage', 'progress'],
    description: 'Real FEA solve stages (assembling → solving → postprocess) + the computed preview',
    load: lazyNamed(() => import('@/components/conkay/panels/ForwardSimPanel'), 'ForwardSimPanel'),
  },
  'conkay.artifact-viewer': {
    id: 'conkay.artifact-viewer', label: 'Artifact Viewer', scope: 'global',
    keywords: ['conkay', 'artifact', '3d', 'render', 'ar', 'fea', 'foundry', 'forge', 'building', 'inspect'],
    description: 'The last real macro artifact (ar.render / runFEA / foundry.preview / forge.sandbox) as interactive 3D',
    load: lazyNamed(() => import('@/components/conkay/panels/ArtifactViewerPanel'), 'ArtifactViewerPanel'),
  },
  'conkay.orchestration-trace': {
    id: 'conkay.orchestration-trace', label: 'Orchestration Trace', scope: 'global',
    keywords: ['conkay', 'orchestration', 'trace', 'plan', 'steps', 'tool calls', 'mission control'],
    description: "The current run's ordered real tool-call sequence, live status, and receipts",
    load: lazyNamed(() => import('@/components/conkay/panels/OrchestrationTracePanel'), 'OrchestrationTracePanel'),
  },
  // A4 — the free-form agent-loop's mission-control plan. DISTINCT source from
  // orchestration-trace above (which mirrors the macro:* SOCKET lifecycle of
  // client-initiated runs): this reads `conkayRunStore`, fed ONLY by the real
  // `tool_call` SSE events the overlay's free-form agent loop receives.
  'conkay.mission-control': {
    id: 'conkay.mission-control', label: 'Mission Control', scope: 'global',
    keywords: ['conkay', 'mission control', 'plan', 'tool calls', 'agent', 'steps', 'trace'],
    description: "The free-form agent run's ordered real tool calls, in execution order, with receipts",
    load: lazyNamed(() => import('@/components/conkay/ConKayMissionControl'), 'ConKayMissionControl'),
  },
  'conkay.connector-status': {
    id: 'conkay.connector-status', label: 'Connector Status', scope: 'global',
    keywords: ['conkay', 'connector', 'integrations', 'oauth', 'connected', 'needs auth'],
    description: 'Your own connector status — Connected vs Needs auth, per app',
    load: lazyNamed(() => import('@/components/conkay/panels/ConnectorStatusPanel'), 'ConnectorStatusPanel'),
  },
  // Beyond-Denial unit #2 — persistent cross-session memory. Lists/pins/
  // forgets the real conversation_memory / conversation_memory_hyper DTUs
  // the rolling-window compressor (server/lib/conversation-memory.js) already
  // writes, via the conkay.memory_list/pin/forget macros.
  'conkay.memory': {
    id: 'conkay.memory', label: 'Memory', scope: 'global',
    keywords: ['conkay', 'memory', 'conversation', 'recall', 'cross-session', 'dtu'],
    description: 'Your real cross-session conversation memory — pin or forget any of it',
    load: lazyNamed(() => import('@/components/conkay/ConKayMemoryPanel'), 'ConKayMemoryPanel'),
  },
  // V1.2 Wave B (Deep ConKay Agency) — the "project" linking layer. Ties a
  // durable goal tree, its marathon session(s), and a relevance-scoped pull
  // from the same conversation memory `conkay.memory` above surfaces into
  // one addressable, resumable unit (server/lib/project-thread.js, mig 378,
  // via the agent_projects.* macros). Direct sibling of conkay.memory —
  // same self-contained/no-required-props shape.
  'conkay.projects': {
    id: 'conkay.projects', label: 'Projects', scope: 'global',
    keywords: ['conkay', 'projects', 'goal', 'marathon', 'resume', 'continuity'],
    description: 'Named threads tying a goal tree + marathon runs + relevant memory into one resumable place',
    load: lazyNamed(() => import('@/components/conkay/ConKayProjectPanel'), 'ConKayProjectPanel'),
  },

  'conkay.feature-tree': {
    id: 'conkay.feature-tree', label: 'Feature Tree', scope: 'global',
    keywords: ['conkay', 'feature', 'tree', 'occ', 'cad', 'solidworks', 'brep'],
    description: 'OCC feature-tree authoring UI — list/add/undo/rebuild (not SolidWorks UI parity)',
    load: lazyNamed(() => import('@/components/conkay/panels/FeatureTreePanel'), 'FeatureTreePanel'),
  },
  'conkay.erp-bom': {
    id: 'conkay.erp-bom', label: 'ERP BOM', scope: 'global',
    keywords: ['conkay', 'bom', 'erp', 'part number', 'csv', 'rollup', 'vendor'],
    description: 'ERP-shaped BOM export LIVE — part numbers, mass/volume, vendor stubs, CSV+JSON (not SAP/Oracle)',
    load: lazyNamed(() => import('@/components/conkay/panels/ErpBomPanel'), 'ErpBomPanel'),
  },

  // The ConKay cockpit panels (F1/F4/F5/F7/F9/A4/A3) are now registered.
  // ConKayCockpit's panel slots treat an unregistered id as "render nothing"
  // (honest, not a crash), so cockpit callers may reference future ids ahead
  // of time and the lane will simply skip them until each unit lands.
};

export function getPanelById(id: string): PanelEntry | undefined {
  return PANEL_REGISTRY[id];
}

export function allPanels(): PanelEntry[] {
  return Object.values(PANEL_REGISTRY);
}

/** Case-insensitive substring search over id / label / keywords. */
export function searchPanels(query: string): PanelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return allPanels().filter((p) => {
    if (p.id.toLowerCase().includes(q)) return true;
    if (p.label.toLowerCase().includes(q)) return true;
    return (p.keywords ?? []).some((k) => k.toLowerCase().includes(q));
  });
}
