import { getLensById } from '@/lib/lens-registry';

/**
 * Labels that are not a DTU class a chip can navigate to.
 * "unknown" is the old pulse fallback and the SQL lens_id column default,
 * not a classification. "general.note" is the seed extractor's no-match
 * token. The server reports a missing class as "unclassified".
 */
const NON_CLASSES = new Set(['unknown', 'unclassified', 'general.note']);

export const UNCLASSIFIED_CHIP_LABEL = 'unclassified';

function chipKey(domain: string): string {
  return (domain || '').trim().toLowerCase();
}

/** Honest chip text. The synthetic "unknown" bucket reads as unclassified. */
export function domainChipLabel(domain: string): string {
  const raw = (domain || '').trim();
  if (!raw || NON_CLASSES.has(chipKey(raw))) return UNCLASSIFIED_CHIP_LABEL;
  return getLensById(raw)?.name || raw;
}

/**
 * Where a Substrate Pulse domain chip may navigate.
 *
 * A chip links only when the classification is itself a lens id in the
 * registry (that lens's real path). DTU classes such as "combat",
 * "document", "historical.world", and the unclassified bucket are not
 * lens ids — returning null tells the panel to render plain text.
 * Never synthesize `/lenses/${domain}`; that path 404s.
 */
export function domainChipHref(domain: string): string | null {
  const raw = (domain || '').trim();
  if (!raw || NON_CLASSES.has(chipKey(raw))) return null;
  const lens = getLensById(raw);
  if (!lens?.path || !lens.path.startsWith('/')) return null;
  return lens.path;
}
