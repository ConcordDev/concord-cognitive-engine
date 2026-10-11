// Client twin of server/lib/art-dtu-filter.js. The "Art DTUs" rail and
// My art only render rows this predicate keeps.

export interface ArtDtuLike {
  id?: string;
  title?: string;
  domain?: string;
  kind?: string;
  human?: { summary?: string };
  machine?: { kind?: string };
  meta?: { lens?: string; type?: string; createdBy?: string };
  ownerId?: string;
  createdBy?: string;
}

export function isArtDtu(d: ArtDtuLike | null | undefined): boolean {
  if (!d) return false;
  const domain = String(d.domain || d.meta?.lens || '').toLowerCase();
  const kind = String(d.machine?.kind || d.kind || d.meta?.type || '').toLowerCase();
  return domain === 'art' || kind === 'artwork' || kind === 'art';
}

export function filterArtDtus<T>(dtus: T[] | null | undefined): T[] {
  if (!Array.isArray(dtus)) return [];
  return dtus.filter((row) => isArtDtu(row as ArtDtuLike));
}

export function artDtuTitle(d: { title?: string; human?: { summary?: string } }): string {
  return d.title || d.human?.summary || 'Untitled';
}
