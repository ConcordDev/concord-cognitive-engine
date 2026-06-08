// concord-frontend/lib/panel-affinity.ts
//
// Curation, not completeness. This map decides which cross-lens panels genuinely
// DEEPEN each destination — the difference between "depth by composition" and the
// Starfield-density trap (16 panels that feel like 16 apps). A panel only earns a
// slot here if it's relevant to the destination's actual workflow; dumping all
// panels into every lens is explicitly the failure mode this map prevents.
//
// Keys are destination lens ids (lib/lens-registry); values are panel ids
// (lib/panel-registry). Both sides are validated by the registry-integrity test.

// Curated cross-domain panels per destination. Every id here is a panel from a
// DIFFERENT lens than the destination (true recombination) and resolves in
// lib/panel-registry. Destinations not listed simply have no cross-mounts yet
// (their own rich page is the depth) — that's fine.
export const PANEL_AFFINITY: Record<string, string[]> = {
  // ── Core 6 ──
  chat: ['research.academic-search'],
  board: ['projects.portfolio'],
  graph: ['research.academic-search'],
  code: ['code-quality.pr-decoration', 'observe.action'],
  studio: ['music.library', 'music.radio'],
  // world — its own in-world HUD PanelHost; no cross-mounts here.

  // ── Work ──
  finance: ['crypto.portfolio', 'accounting.budgets', 'accounting.ratios', 'energy.billing'],
  accounting: ['finance.accounts', 'crypto.portfolio'],
  healthcare: [
    'wellness.daily-recommendation', 'wellness.cbt', 'fitness.training',
    'pharmacy.adherence', 'pharmacy.price-lookup',
  ],
  legal: ['research.academic-search', 'council.theater'],
  projects: ['finance.accounts', 'marketplace.orders'],
  analytics: ['observe.action', 'finance.accounts'],
  marketplace: ['creator.revenue', 'crypto.portfolio'],

  // ── Create ──
  music: ['food.discover'],
  whiteboard: ['research.academic-search'],
  creator: ['marketplace.listings', 'marketplace.orders'],
  crypto: ['accounting.ratios', 'finance.accounts'],

  // ── Knowledge ──
  research: ['astronomy.targets'],
  lab: ['astronomy.targets'],
  agents: ['observe.action'],

  // ── Comms ──
  message: ['council.theater'],
  social: ['creator.audience', 'creator.revenue'],
  council: ['legal.matters', 'message.directory'],
};

// Density cap — a destination beyond this many cross-mounted panels has stopped
// curating and started cluttering. Enforced by the registry-integrity test.
export const MAX_PANELS_PER_DESTINATION = 30;

export function panelsForDestination(lensId: string): string[] {
  return PANEL_AFFINITY[lensId] ?? [];
}
