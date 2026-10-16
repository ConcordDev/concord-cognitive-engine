// concord-frontend/lib/lens-hosts.ts
//
// Phase 3 lens folds (PHASE3-DECISIONS.md): the generic "host lens" layer.
// A HOST is a real lens that groups other real lenses ("children") the way a
// destination groups its absorbs — but hosts are ordinary lenses, not
// promoted destinations. Promotion is presentation only: nothing is removed
// from the lens registry, so ConKay and the macro system still reach every
// child by its own route.
//
// Admin guard: a host child must not be a SOVEREIGN_LENS nor carry an admin
// gate in its page. getHostChildren() enforces the id half (ADMIN_GATED_LENS_IDS,
// core-absorbed ids live under CoreLensNav) and tests/lib/lens-hosts.test.ts
// scans each child page.tsx for admin gates (AdminRequiredState / requireRole /
// useRequireAdmin / isAdmin) so the two halves can't drift apart.

import { getParentCoreLens, SOVEREIGN_LENSES } from '@/lib/lens-registry';

/** Host lens id → ids of the real lenses grouped under it. */
export const LENS_HOSTS: Readonly<Record<string, readonly string[]>> = {
  'creative-writing': ['narrative-walk'],
  understanding: ['transfer'],
  bridge: ['concord-link-frontier'],
  'world-creator': ['genesis', 'creatures', 'sandbox'],
  platform: ['integrations', 'offline', 'sync', 'mesh'],
  reflection: ['metacognition', 'metalearning', 'affect', 'attention'],
};

/**
 * Lens ids that never appear as host children (nor destination members): their
 * pages are admin-gated or sovereign-only, so a member-facing workspace tab
 * bar must not surface them. Defense-in-depth — the page's own gate is the
 * boundary — but a tab that 403s for members is a broken tab.
 */
export const ADMIN_GATED_LENS_IDS: ReadonlySet<string> = new Set<string>([
  'crisis-ops',
  'repair-telemetry',
  'ops',
  'queue',
  'psyops',
  'defense',
  'law-enforcement',
  'observe',
  'dx-platform',
  // Sovereign lenses (admin/command-center) are admin-gated by definition.
  ...SOVEREIGN_LENSES,
]);

/** The host whose workspace the given lens belongs to (undefined for hosts themselves and ungrouped lenses). */
export function getHostForLens(lensId: string): string | undefined {
  for (const [hostId, children] of Object.entries(LENS_HOSTS)) {
    if (children.includes(lensId)) return hostId;
  }
  return undefined;
}

/**
 * Children of a host that may appear in a member-facing tab bar: admin-gated
 * ids are filtered out (see ADMIN_GATED_LENS_IDS) and so are ids already
 * absorbed into a core lens (those live under CoreLensNav). Unlisted hosts
 * yield an empty list.
 */
export function getHostChildren(hostId: string): readonly string[] {
  const children = LENS_HOSTS[hostId] ?? [];
  return children.filter((id) => !ADMIN_GATED_LENS_IDS.has(id) && !getParentCoreLens(id));
}