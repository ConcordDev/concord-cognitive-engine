/**
 * Permanent aliases from a lens tabLabel to its canonical route.
 *
 * Absorbed lenses keep their own path (`/lenses/thread`, `/lenses/fractal`)
 * while the parent nav shows a tabLabel (`Threads`, `Visuals`). People type
 * the label: `/lenses/threads`, `/lenses/visuals`. Those are not lens ids.
 * A 308 sends them to the registry path.
 *
 * TAB_LABEL_REDIRECTS is that map. It must stay equal to
 * redirectsForTabLabels(LENS_REGISTRY) — the unit test is the lock, so this
 * file can be imported from middleware without pulling the icon registry
 * into the edge bundle.
 */

export interface TabLabelRedirect {
  source: string;
  destination: string;
}

/** `/lenses/<slug>` for a tabLabel. Empty when the label has no slug characters. */
export function tabLabelRoute(tabLabel: string): string {
  const slug = tabLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `/lenses/${slug}` : '';
}

/**
 * Aliases whose tabLabel slug is not already the lens path and not some
 * other lens's path. The first lens wins if two labels slug to one source.
 */
export function redirectsForTabLabels(
  lenses: readonly { path: string; tabLabel?: string }[],
): TabLabelRedirect[] {
  const paths = new Set(lenses.map((lens) => lens.path));
  const seen = new Set<string>();
  const out: TabLabelRedirect[] = [];
  for (const lens of lenses) {
    if (!lens.tabLabel || !lens.path) continue;
    const source = tabLabelRoute(lens.tabLabel);
    if (!source || source === lens.path || paths.has(source) || seen.has(source)) continue;
    seen.add(source);
    out.push({ source, destination: lens.path });
  }
  return out;
}

/** tabLabel slug → canonical lens path. Locked to LENS_REGISTRY by test. */
export const TAB_LABEL_REDIRECTS: readonly TabLabelRedirect[] = [
  { source: '/lenses/threads', destination: '/lenses/thread' },
  { source: '/lenses/governance', destination: '/lenses/council' },
  { source: '/lenses/anonymous', destination: '/lenses/anon' },
  { source: '/lenses/study', destination: '/lenses/srs' },
  { source: '/lenses/entities', destination: '/lenses/entity' },
  { source: '/lenses/ecosystem', destination: '/lenses/eco' },
  { source: '/lenses/visuals', destination: '/lenses/fractal' },
  { source: '/lenses/simulation', destination: '/lenses/sim' },
  { source: '/lenses/concordia-world-ledger-game-world', destination: '/lenses/ledger' },
];
