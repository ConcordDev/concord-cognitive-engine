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

export const PANEL_AFFINITY: Record<string, string[]> = {
  // Finance gains holdings, accounting depth, and utility-cost context it never
  // had to build — all already exist as panels elsewhere.
  finance: [
    'crypto.portfolio',
    'accounting.budgets',
    'accounting.ratios',
    'energy.billing',
  ],
  // Healthcare gains the self-care half of health: wellness, mental health,
  // training load, and medication adherence/pricing.
  healthcare: [
    'wellness.daily-recommendation',
    'wellness.cbt',
    'fitness.training',
    'pharmacy.adherence',
    'pharmacy.price-lookup',
  ],
  // Code gains review-quality and observability surfaces.
  code: [
    'code-quality.pr-decoration',
    'observe.action',
  ],
};

// Density cap — a destination beyond this many cross-mounted panels has stopped
// curating and started cluttering. Enforced by the registry-integrity test.
export const MAX_PANELS_PER_DESTINATION = 30;

export function panelsForDestination(lensId: string): string[] {
  return PANEL_AFFINITY[lensId] ?? [];
}
