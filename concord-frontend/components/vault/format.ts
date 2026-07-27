/**
 * TheVault — display formatting. Pure functions, no React, no fetching.
 *
 * Every one of these returns `null` for an absent or unusable value rather
 * than a stand-in string, so a caller can render NOTHING instead of rendering
 * a dash that reads like a measured absence. That is the whole reason they
 * exist as a separate module: the "no substrate → no pixels" rule is easier
 * to keep when the formatter itself refuses to fabricate.
 */

/**
 * Long-form month names. The Vault has to still read correctly printed on
 * paper in 2050 (the brief's own test), so dates are spelled out rather than
 * rendered as a locale-dependent numeric that means 03/04 in two countries.
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * `admittedAt` (unix SECONDS, per `unixepoch()` in the backend) → "14 March 2026".
 *
 * UTC deliberately: an admission date is an archival fact, and the same record
 * must not read as a different day depending on where it is being read.
 * Returns null for null/0/NaN/negative — the caller renders nothing.
 */
export function formatAdmissionDate(unixSeconds: number | null | undefined): string | null {
  if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  const d = new Date(unixSeconds * 1000);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The backend's `WORK_KINDS` enum → its wall-label spelling.
 *
 * A value NOT in the enum is returned de-underscored rather than swallowed or
 * mapped to "Other": the archive shows what the record actually says.
 */
const DISCIPLINE_NAMES: Record<string, string> = {
  writing: 'Writing',
  music: 'Music',
  visual: 'Visual',
  moving_image: 'Moving image',
  code: 'Code',
  performance: 'Performance',
  other: 'Other',
};

export function formatDiscipline(workKind: string | null | undefined): string | null {
  const k = typeof workKind === 'string' ? workKind.trim() : '';
  if (!k) return null;
  if (DISCIPLINE_NAMES[k]) return DISCIPLINE_NAMES[k];
  const spaced = k.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The disciplines admission is filed under, in the backend's own order. */
export const DISCIPLINE_KINDS: readonly string[] = [
  'writing', 'music', 'visual', 'moving_image', 'code', 'performance', 'other',
];

/**
 * `founding_curator` / `guest_curator` → their spelling. An unrecognised role
 * returns null: attribution is permanent and load-bearing (spec §6), so a role
 * we cannot name is left unrendered rather than guessed at.
 */
export function formatCuratorRole(role: string | null | undefined): string | null {
  const r = typeof role === 'string' ? role.trim() : '';
  if (r === 'founding_curator') return 'Founding curator';
  if (r === 'guest_curator') return 'Guest curator';
  return null;
}

/**
 * A drawer's position in the cabinet — "No. 003".
 *
 * This is a PLACE indicator, not a metric: it says where you are standing in
 * an ordered collection (the brief's "no infinite feed" requirement — if you
 * cannot tell where you are, the browse surface is wrong). It counts drawers,
 * never attention.
 */
export function accessionOrdinal(oneBasedIndex: number): string {
  const n = Number.isFinite(oneBasedIndex) && oneBasedIndex > 0 ? Math.floor(oneBasedIndex) : 0;
  return `No. ${String(n).padStart(3, '0')}`;
}
