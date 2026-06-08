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
