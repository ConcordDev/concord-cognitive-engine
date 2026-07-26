/**
 * TheVault — lens-scoped design tokens.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS SEPARATELY FROM `lib/design-system.ts`
 * ───────────────────────────────────────────────────────────────────────────
 * `lib/design-system.ts` is a DARK-SURFACE system: every one of its class
 * tokens bakes in `text-white` (`ds.heading1` is literally
 * `'text-2xl font-bold text-white'`), and the platform's light mode is inert
 * — `tailwind.config.js` hardcodes the lattice hexes instead of reading the
 * CSS variables, and `app/globals.css` pins `bg-lattice-void text-white` on
 * `body`. Repairing platform theming is a large, separate job.
 *
 * So the Vault is a self-contained LIGHT ISLAND. `components/lens/LensShell`
 * is explicitly headless — it imposes no header, background, padding, or
 * min-height — so a lens legitimately owns 100% of its own visible surface.
 *
 * This file therefore REUSES the platform's rhythm (`SPACING_SCALE` and the
 * `TYPE_SCALE` step sizes, imported below, so the Vault sits on the same
 * 4px/type grid as every other lens) and REPLACES only its color and font
 * layer. It imports no class string from `ds`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE BRIEF THESE TOKENS ENCODE
 * ───────────────────────────────────────────────────────────────────────────
 * Reads like a museum wall label: quiet, authoritative, contextual.
 *   · EXACTLY TWO TYPEFACES — one serif (permanence), one sans (clarity).
 *     There is deliberately no mono role in this file; numerics use the sans
 *     with `tabular-nums` so the Vault never reaches for a third face.
 *   · ALMOST ENTIRELY GRAYSCALE — white, black, warm gray, and ONE accent.
 *   · LIGHT, NOT DARK. Museums aren't black; paper is light. Black is
 *     reserved as ceremonial (the induction moment), never general chrome.
 *   · TEXTURE — subtle grain, letterpress, emboss. Everything feels physical.
 *   · MOTION — still. Very still. A drawer opens. A page turns.
 *
 * The matching CSS lives in `app/globals.css` under the "THEVAULT" banner
 * (all classes namespaced `.vault-*`); the color values below are mirrored
 * into `tailwind.config.js` under `colors.vault` so the `text-vault-ink` /
 * `bg-vault-paper` utilities referenced here actually resolve.
 */

import { SPACING_SCALE, TYPE_SCALE, type SpacingStep } from '@/lib/design-system';

/* ═══════════════════════════════════════════════════════════════════════
   COLOR — grayscale + one accent
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Raw hex values. Mirrored in `tailwind.config.js` `colors.vault` — change
 * both together (the test in `tests/vault-tokens.test.tsx` pins that the
 * Tailwind class names built from these stay in sync with these values).
 */
export const VAULT_COLOR = {
  /** Base wall surface — warm cotton white, not pure white. */
  paper: '#FAF8F4',
  /** The label / certificate stock itself, sitting on the wall. */
  card: '#FFFFFF',
  /** Recessed well, drawer interior. */
  sunk: '#F1EDE5',

  /** Primary text — warm near-black. Never pure #000; ink on paper isn't. */
  ink: '#1A1815',
  /** Secondary text. */
  graphite: '#4A4642',
  /** Tertiary text / metadata. Still clears AA on all three papers. */
  gray: '#6E6860',

  /** Decorative hairline. NOT a control border — see VAULT_CONTRAST. */
  rule: '#DED8CE',

  /**
   * VAULT GOLD — the single accent. Deliberately desaturated and dark:
   * aged, oxidized brass rather than gilt. Not shiny, not metallic.
   * Used sparingly; if everything is gold, nothing feels important.
   */
  brass: '#7E6234',
  /** Brass at border weight — non-text use only (clears the 3:1 UI minimum). */
  brassLine: '#9A7B4F',
  /** Brass ON the ceremonial black only — unreadable on paper (1.9:1). */
  brassLeaf: '#C2A25E',

  /**
   * Ceremonial black. RESERVED for the induction moment — deliberately not
   * part of the everyday surface set. Black chrome would break the brief.
   */
  ceremonial: '#12100E',
} as const;

/**
 * Measured WCAG 2.x contrast ratios (sRGB relative luminance), computed
 * against each paper rather than asserted. Recorded here so a future change
 * to any value can be checked instead of guessed.
 *
 * NOTE ON THE PRE-EXISTING `accent-warm` TOKEN (#E8A44C in
 * `tailwind.config.js`): it was unclaimed by any component and looked like a
 * free brass. It is not. It is a DARK-SURFACE amber and measures 2.01:1
 * against `paper` — it fails WCAG for text and for UI borders alike, and
 * reads orange-highlighter rather than archival. `brass` above is a
 * separately-derived value; `accent-warm` is left untouched for the dark
 * surfaces it was designed for.
 */
export const VAULT_CONTRAST = {
  /** [onPaper, onCard, onSunk] */
  ink: [16.7, 17.72, 15.17],
  graphite: [8.82, 9.35, 8.01],
  gray: [5.19, 5.51, 4.72],
  brass: [5.37, 5.7, 4.88],
  brassLine: [3.72, 3.95, 3.38],
  rule: [1.34, 1.42, 1.21],
  /** For reference — the rejected candidate. */
  accentWarmRejected: [2.01, 2.13, 1.83],
} as const;

/** Minimum ratio for normal-size body text (WCAG 1.4.3 AA). */
export const AA_TEXT_MIN = 4.5;
/** Minimum ratio for borders, focus rings, and other non-text UI (WCAG 1.4.11). */
export const AA_NONTEXT_MIN = 3;

/**
 * Roles that may legally carry normal-size text on paper. `rule` and
 * `brassLine` are intentionally absent — they are non-text only.
 */
export const VAULT_TEXT_ROLES = ['ink', 'graphite', 'gray', 'brass'] as const;

/* ═══════════════════════════════════════════════════════════════════════
   TYPE — exactly two faces
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The two families, as Tailwind utilities.
 *
 * `font-vault` is a DISTINCT Tailwind key, not an override of `serif`:
 * `font-serif` is relied on by 17 call sites across 12 other files and still
 * resolves to Tailwind's default Georgia stack, unchanged. See the comment in
 * `tailwind.config.js`.
 *
 * `font-sans` is the platform's already-loaded DM Sans. Reusing it keeps the
 * Vault at exactly two faces AND adds zero font payload. If the sans ever
 * needs to become a more neutral grotesque, this is the single line to
 * repoint — nothing below hardcodes a family.
 */
export const VAULT_FONT = {
  /** Source Serif 4 — permanence, authority. */
  serif: 'font-vault',
  /** DM Sans — clarity. */
  sans: 'font-sans',
} as const;

export type VaultTypeRole =
  | 'title'
  | 'subtitle'
  | 'sectionTitle'
  | 'body'
  | 'bodySm'
  | 'attribution'
  | 'label'
  | 'caption'
  | 'accession';

export interface VaultTypeToken {
  /** Which of the two faces. */
  family: 'serif' | 'sans';
  /** rem — taken VERBATIM from `TYPE_SCALE` so the Vault shares the platform grid. */
  fontSize: string;
  /** rem. Matches `TYPE_SCALE` except where `leadingAdjusted` is true. */
  lineHeight: string;
  fontWeight: number;
  /** Ready-made Tailwind utility string. Light-surface colors only. */
  className: string;
  /**
   * True where leading was opened past the `TYPE_SCALE` pairing. Only the
   * long-form serif reading roles do this: a serif at 16px/24px is cramped
   * for sustained reading, and museum body text is generously leaded. Sizes
   * are never adjusted — only leading, and only here.
   */
  leadingAdjusted?: true;
}

/** Pull the step size straight off the platform scale — never retyped. */
const step = (k: keyof typeof TYPE_SCALE) => ({
  fontSize: TYPE_SCALE[k].fontSize,
  lineHeight: TYPE_SCALE[k].lineHeight,
});

export const VAULT_TYPE: Record<VaultTypeRole, VaultTypeToken> = {
  /** The object's name. The one line that carries a page. */
  title: {
    family: 'serif',
    ...step('display'),
    fontWeight: 400,
    className: 'font-vault text-4xl font-normal tracking-[-0.01em] text-vault-ink',
  },
  /** Secondary naming line. */
  subtitle: {
    family: 'serif',
    ...step('heading1'),
    fontWeight: 400,
    className: 'font-vault text-2xl font-normal text-vault-ink',
  },
  /** Section heads within a label. */
  sectionTitle: {
    family: 'serif',
    ...step('heading3'),
    fontWeight: 600,
    className: 'font-vault text-lg font-semibold text-vault-ink',
  },
  /** Long-form reading text — the wall label's paragraph. */
  body: {
    family: 'serif',
    fontSize: TYPE_SCALE.body.fontSize,
    lineHeight: '1.75rem',
    fontWeight: 400,
    className: 'font-vault text-base leading-[1.75rem] text-vault-ink',
    leadingAdjusted: true,
  },
  bodySm: {
    family: 'serif',
    fontSize: TYPE_SCALE.bodySm.fontSize,
    lineHeight: '1.5rem',
    fontWeight: 400,
    className: 'font-vault text-sm leading-[1.5rem] text-vault-graphite',
    leadingAdjusted: true,
  },
  /** "Artist, date, medium" — the sans line under the serif name. */
  attribution: {
    family: 'sans',
    ...step('bodySm'),
    fontWeight: 400,
    className: 'font-sans text-sm text-vault-graphite',
  },
  /** The small tracked metadata KEY on a wall label ("PROVENANCE"). */
  label: {
    family: 'sans',
    ...step('overline'),
    fontWeight: 600,
    className: 'font-sans text-xs font-semibold uppercase tracking-[0.14em] text-vault-gray',
  },
  caption: {
    family: 'sans',
    ...step('caption'),
    fontWeight: 400,
    className: 'font-sans text-xs text-vault-gray',
  },
  /**
   * Accession numbers, dates, counts. Sans with `tabular-nums` — the Vault
   * gets figure alignment without ever loading a third typeface.
   */
  accession: {
    family: 'sans',
    ...step('caption'),
    fontWeight: 500,
    className: 'font-sans text-xs font-medium tabular-nums tracking-[0.04em] text-vault-gray',
  },
};

/* ═══════════════════════════════════════════════════════════════════════
   SPACING — the platform 4px grid, read straight off SPACING_SCALE
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Named rhythm roles mapped onto the shared `SPACING_SCALE` steps. Museum
 * layout is generous, so the Vault reaches for the upper steps by default —
 * but the numbers themselves are the platform's, never re-derived.
 */
export const VAULT_RHYTHM = {
  /** Gap between a metadata key and its value. */
  labelToValue: 'xs',
  /** Gap between stacked metadata rows. */
  rowGap: 'sm',
  /** Padding inside a plate. */
  platePad: 'lg',
  /** Gap between plates. */
  plateGap: 'xl',
  /** Gap between sections of the wall. */
  sectionGap: '2xl',
  /** Outer margin of the wall itself. */
  wallPad: '3xl',
} as const satisfies Record<string, SpacingStep>;

export type VaultRhythmRole = keyof typeof VAULT_RHYTHM;

/** Resolve a rhythm role to the shared platform spacing token. */
export function vaultSpace(role: VaultRhythmRole) {
  return SPACING_SCALE[VAULT_RHYTHM[role]];
}

/* ═══════════════════════════════════════════════════════════════════════
   TEXTURE — class names for the CSS in app/globals.css
   ═══════════════════════════════════════════════════════════════════════ */

export const VAULT_TEXTURE = {
  /** Root marker. Required on the lens root — the focus + stillness
   *  overrides in globals.css are all scoped under it. */
  surface: 'vault-surface',
  /** Warm paper base + SVG fractalNoise grain overlay. */
  paper: 'vault-paper',
  /** Brighter card stock, finer tooth. */
  paperCard: 'vault-paper vault-paper-card',
  /** Recessed well / drawer interior, coarser tooth. */
  paperSunk: 'vault-paper vault-paper-sunk',
  /** Type pressed into the sheet. */
  letterpress: 'vault-letterpress',
  /** Deeper strike, for display lines only. */
  letterpressDeep: 'vault-letterpress-deep',
  /** Plate raised off the wall. */
  emboss: 'vault-emboss',
  /** Pressed in — inset field. */
  deboss: 'vault-deboss',
  /** Decorative hairline color (non-text). */
  rule: 'vault-rule',
  /** Border color that clears the 3:1 non-text minimum — use on controls. */
  ruleStrong: 'vault-rule-strong',
  /** Composed: card stock + hairline + raised. */
  plate: 'vault-plate',
} as const;

/* ═══════════════════════════════════════════════════════════════════════
   MOTION — still. very still.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The same zero-overshoot expo-out curve the Concordia HUDs already use, at
 * longer durations and shorter travel: things settle, they never arrive.
 * Nothing bounces, spins, or slides dramatically.
 *
 * Both accessibility paths are covered: `html.a11y-reduce-motion *` (the
 * in-app toggle, pre-existing) and a real `prefers-reduced-motion: reduce`
 * media query added alongside these keyframes.
 */
export const VAULT_MOTION = {
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  duration: {
    /** Control color change. Nothing moves. */
    control: 160,
    /** A page turns / a label settles. */
    reveal: 420,
    /** A drawer opens — content wipes down under a clip-path edge. */
    drawer: 520,
    /** The vault unlocks. Induction moment only. */
    ceremonial: 880,
  },
  class: {
    reveal: 'vault-reveal',
    drawer: 'vault-drawer',
    ceremonial: 'vault-ceremonial',
  },
} as const;

/* ═══════════════════════════════════════════════════════════════════════
   COMPOSED CLASS STRINGS — the `ds`-shaped convenience layer
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Import as `import { vault } from '@/lib/vault/tokens'`.
 * Every string here is light-surface only and contains no `text-white`.
 */
export const vault = {
  /** The lens root. Carries the surface marker, the grain, and ink default. */
  wall: 'vault-surface vault-paper min-h-screen text-vault-ink',
  /** A museum label / certificate plate. */
  plate: 'vault-plate rounded-sm p-6',
  /** A recessed field (search input well, drawer interior). */
  well: 'vault-paper vault-paper-sunk vault-deboss rounded-sm p-4',
  /** Horizontal hairline divider. */
  divider: 'border-0 border-t border-vault-rule',

  // Type
  title: VAULT_TYPE.title.className,
  titlePressed: `${VAULT_TYPE.title.className} vault-letterpress-deep`,
  subtitle: VAULT_TYPE.subtitle.className,
  sectionTitle: VAULT_TYPE.sectionTitle.className,
  body: VAULT_TYPE.body.className,
  bodySm: VAULT_TYPE.bodySm.className,
  attribution: VAULT_TYPE.attribution.className,
  label: VAULT_TYPE.label.className,
  caption: VAULT_TYPE.caption.className,
  accession: VAULT_TYPE.accession.className,

  /** Sparing accent. If everything is gold, nothing feels important. */
  accent: 'text-vault-brass',

  /**
   * Quiet control. Brass hairline, ink label, no fill — a button on a
   * museum label is an instruction, not a call to action. Color-only
   * transition (the stillness override in globals.css strips transform).
   */
  button:
    'inline-flex items-center justify-center rounded-sm border border-vault-brassLine ' +
    'bg-transparent px-4 py-2 font-sans text-sm font-medium text-vault-ink ' +
    'hover:bg-vault-sunk disabled:opacity-40 disabled:pointer-events-none',

  /** The one emphasized action per surface — brass fill, paper label. */
  buttonAccent:
    'inline-flex items-center justify-center rounded-sm border border-vault-brass ' +
    'bg-vault-brass px-4 py-2 font-sans text-sm font-medium text-vault-paper ' +
    'hover:bg-vault-brassLine disabled:opacity-40 disabled:pointer-events-none',

  /** Text field sunk into the sheet. */
  input:
    'w-full rounded-sm border border-vault-rule bg-vault-card px-3 py-2 ' +
    'font-sans text-sm text-vault-ink placeholder:text-vault-gray vault-deboss',
} as const;

export default vault;
