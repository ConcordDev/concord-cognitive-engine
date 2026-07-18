/**
 * FE-020: Design system tokens and reusable class patterns.
 *
 * Instead of repeating identical Tailwind class strings across lenses,
 * import these composable tokens. This prevents visual drift as the
 * lens count grows.
 *
 * Usage:
 *   import { ds } from '@/lib/design-system';
 *   <div className={ds.panel}>...</div>
 *   <button className={ds.btnPrimary}>Save</button>
 *
 * This file also exports named token sets consumed by `components/ui/*`
 * (ErrorState / EmptyState / StatusDot and friends) and by
 * `lib/hooks/useDensity.ts`:
 *   import { TYPE_SCALE, SPACING_SCALE, DENSITY_TOKENS, STATUS_TOKENS } from '@/lib/design-system';
 *
 * Fonts: this file does NOT declare any font — it reuses the two faces
 * already wired via `next/font/google` in `app/layout.tsx`
 * (`--font-dm-sans`, `--font-jetbrains-mono`), which `tailwind.config.js`
 * maps onto `font-sans` / `font-mono`. Every class string below that needs
 * monospace uses the plain `font-mono` utility for that reason — never a
 * duplicate `font-family` declaration.
 */
import type { CSSProperties } from 'react';

/** Panel / Card — the standard container used by most lenses. */
const panel =
  'bg-lattice-surface border border-lattice-border rounded-xl p-4 shadow-lattice-sm';

const panelHover =
  'bg-lattice-surface border border-lattice-border rounded-xl p-4 shadow-lattice-sm hover:shadow-lattice-md hover:border-white/15 transition-all duration-150 cursor-pointer';

/**
 * Panel without padding — for components that manage their own inner
 * padding (typically game-UI overlays, world-lens HUDs, or absorbed
 * components with custom internal layout). Same surface tokens as
 * `panel` so they sit cleanly next to each other; no `p-4`, slightly
 * smaller `rounded-lg` to match overlay aesthetic.
 */
const panelBare =
  'bg-lattice-surface border border-lattice-border rounded-lg shadow-lattice-sm';

/**
 * Panel for floating overlays / popovers / HUD chrome — translucent
 * with backdrop-blur so the world-lens 3D scene shows faintly behind
 * it. Use for in-game panels mounted over the canvas.
 */
const panelFloating =
  'bg-lattice-surface/90 backdrop-blur-sm border border-lattice-border rounded-lg shadow-lattice-md';

/**
 * World-lens HUD chrome — the canonical dark, THEME-INDEPENDENT panel for
 * overlays floating over the Concordia 3D scene. Unlike `panelFloating` (which
 * uses `lattice-surface` and therefore flips to white in light theme), a HUD
 * over a 3D world must stay dark in both themes, so it uses a fixed
 * `bg-black/80`. This is the idiom the core world-lens HUDs (AbilityCooldownHud,
 * CharacterSheetPanel, TargetNameplate) already share; `hudPanel`/`hudPill`
 * make it the single source of truth so sibling HUDs stop drifting
 * (bg-zinc vs bg-black, blur-sm vs blur-md, rounded-lg vs rounded-xl).
 * Add a semantic accent by overriding just the border color at the call site,
 * e.g. `${ds.hudPanel} border-amber-500/40`.
 */
const hudPanel =
  'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg shadow-lg';

/** HUD pill — the compact rounded-full variant for status chips / summon buttons. */
const hudPill =
  'bg-black/80 backdrop-blur-sm border border-white/10 rounded-full shadow-lg';

/** Buttons */
const btnBase =
  'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-lattice-void disabled:opacity-50 disabled:pointer-events-none';

// Flat, high-contrast primary — retired the neon gradient + glow shadow (a
// dated cyberpunk tell, per docs/PREMIUM_UI_AUDIT.md P1). A solid bright accent
// with a DARK label reads restrained and premium (Linear-style) and clears WCAG
// contrast that white-on-cyan did not. Motion is a plain color transition.
const btnPrimary =
  'bg-neon-blue text-lattice-void font-semibold rounded-lg px-4 py-2 hover:bg-neon-blue/90 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-neon-blue/50 focus:ring-offset-2 focus:ring-offset-lattice-void disabled:opacity-50 disabled:cursor-not-allowed';

const btnSecondary =
  'bg-lattice-elevated text-gray-200 font-medium rounded-lg px-4 py-2 border border-lattice-border hover:border-white/20 hover:bg-white/[0.08] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50 disabled:cursor-not-allowed';

const btnDanger =
  `${btnBase} px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 focus:ring-red-500`;

const btnGhost =
  `${btnBase} px-3 py-2 text-gray-400 hover:text-white hover:bg-lattice-elevated`;

const btnSmall =
  `${btnBase} px-3 py-1.5 text-sm`;

const btnNeon = (color: 'blue' | 'purple' | 'cyan' | 'green' | 'pink' = 'blue') =>
  `${btnBase} px-4 py-2 bg-neon-${color}/20 text-neon-${color} border border-neon-${color}/50 hover:bg-neon-${color}/30 focus:ring-neon-${color}`;

/** Inputs */
const input =
  'w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-white placeholder:text-gray-500 outline-none focus:border-neon-blue transition-colors';

const textarea = `${input} resize-none`;

const select = input;

/** Labels & text */
const label = 'block text-sm text-gray-400 mb-1';
const heading1 = 'text-2xl font-bold text-white';
const heading2 = 'text-xl font-semibold text-white';
const heading3 = 'text-lg font-semibold text-white';
const textMuted = 'text-sm text-gray-400';
/**
 * Canonical BODY-COPY style — multi-sentence prose on dark surfaces.
 * gray-300 clears WCAG AA (≥4.5:1) on lattice-void with comfortable margin (~12:1);
 * gray-400 (textMuted, ~7.5:1) stays the muted/meta tone.
 */
const textBody = 'text-gray-300';
const textMono = 'font-mono text-sm';

/** Status badges */
const badge = (color: string) =>
  `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-${color}/20 text-${color}`;

/** Layout helpers */
const pageContainer = 'p-6 space-y-6';
const sectionHeader = 'flex items-center justify-between';
const grid2 = 'grid grid-cols-1 md:grid-cols-2 gap-4';
const grid3 = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
const grid4 = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4';

/** Tab navigation */
const tabBar =
  'flex gap-1 border-b border-lattice-border px-4 overflow-x-auto no-scrollbar';

const tabActive = (color: string = 'neon-blue') =>
  `flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px text-${color} border-${color}`;

const tabInactive =
  'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px text-gray-400 border-transparent hover:text-white hover:border-gray-600 transition-colors';

/** Focus ring utility — visible focus for keyboard navigation */
const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue focus-visible:ring-offset-2 focus-visible:ring-offset-lattice-void';

/** Overlays */
const modalBackdrop = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-50';
const modalContainer =
  'fixed inset-0 z-50 flex items-center justify-center p-4';
const modalPanel =
  'bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden w-full';

/* ═══════════════════════════════════════════════════════════════════════
   TYPE SCALE — proportional (DM Sans / `font-sans`) headings + body, and a
   JetBrains Mono (`font-mono`) hierarchy for data-dense HUD / telemetry /
   tabular contexts (stat readouts, code, DTU ids, timestamps). Built
   entirely from Tailwind's default scale — no arbitrary `[...]` values —
   so every class here is exactly as JIT-safe as the pre-existing tokens
   above (each individual utility, e.g. `text-2xl`, `font-mono`,
   `tabular-nums`, is already used directly across hundreds of scanned
   `app/**`/`components/**` files, which is what makes tokens defined in
   this un-scanned `lib/` file render correctly in practice — see
   `tailwind.config.js` `content`).
   ═══════════════════════════════════════════════════════════════════════ */

export type TypeStep =
  | 'display' | 'heading1' | 'heading2' | 'heading3' | 'heading4'
  | 'body' | 'bodySm' | 'caption' | 'overline'
  | 'monoMicro' | 'monoXs' | 'monoSm' | 'monoBase' | 'monoLg' | 'monoXl' | 'monoDisplay' | 'monoStat';

export interface TypeStepToken {
  /** Font-size, rem — matches the Tailwind step the className is built from. */
  fontSize: string;
  /** Line-height, rem (Tailwind's default pairing for that font-size step). */
  lineHeight: string;
  fontWeight: number;
  fontFamily: 'sans' | 'mono';
  /** Ready-made Tailwind utility string — the actual class to apply. */
  className: string;
}

const display = 'text-4xl font-bold text-white tracking-tight';
const heading4 = 'text-base font-semibold text-white';
const caption = 'text-xs text-gray-500';
const overline = 'text-xs font-semibold uppercase tracking-widest text-gray-500';

/** JetBrains Mono hierarchy — HUD counters, DTU/entity ids, code, timestamps, tabular data. */
const monoMicro = 'font-mono text-xs uppercase tracking-widest text-gray-500';
const monoXs = 'font-mono text-xs tracking-tight text-gray-400';
const monoSm = 'font-mono text-sm tracking-tight text-gray-300';
const monoBase = 'font-mono text-base text-gray-200';
const monoLg = 'font-mono text-lg text-white';
const monoXl = 'font-mono text-2xl font-semibold text-white';
const monoDisplay = 'font-mono text-4xl font-bold text-white tabular-nums';
/** Numeric stat readout (KPI tiles, HUD counters) — `tabular-nums` keeps digits from jittering as they tick. */
const monoStat = 'font-mono text-2xl font-bold tabular-nums text-white';

export const TYPE_SCALE: Record<TypeStep, TypeStepToken> = {
  display:     { fontSize: '2.25rem',  lineHeight: '2.5rem',  fontWeight: 700, fontFamily: 'sans', className: display },
  heading1:    { fontSize: '1.5rem',   lineHeight: '2rem',    fontWeight: 700, fontFamily: 'sans', className: heading1 },
  heading2:    { fontSize: '1.25rem',  lineHeight: '1.75rem', fontWeight: 600, fontFamily: 'sans', className: heading2 },
  heading3:    { fontSize: '1.125rem', lineHeight: '1.75rem', fontWeight: 600, fontFamily: 'sans', className: heading3 },
  heading4:    { fontSize: '1rem',     lineHeight: '1.5rem',  fontWeight: 600, fontFamily: 'sans', className: heading4 },
  body:        { fontSize: '1rem',     lineHeight: '1.5rem',  fontWeight: 400, fontFamily: 'sans', className: textBody },
  bodySm:      { fontSize: '0.875rem', lineHeight: '1.25rem', fontWeight: 400, fontFamily: 'sans', className: textMuted },
  caption:     { fontSize: '0.75rem',  lineHeight: '1rem',    fontWeight: 400, fontFamily: 'sans', className: caption },
  overline:    { fontSize: '0.75rem',  lineHeight: '1rem',    fontWeight: 600, fontFamily: 'sans', className: overline },
  monoMicro:   { fontSize: '0.75rem',  lineHeight: '1rem',    fontWeight: 500, fontFamily: 'mono', className: monoMicro },
  monoXs:      { fontSize: '0.75rem',  lineHeight: '1rem',    fontWeight: 400, fontFamily: 'mono', className: monoXs },
  monoSm:      { fontSize: '0.875rem', lineHeight: '1.25rem', fontWeight: 400, fontFamily: 'mono', className: monoSm },
  monoBase:    { fontSize: '1rem',     lineHeight: '1.5rem',  fontWeight: 400, fontFamily: 'mono', className: monoBase },
  monoLg:      { fontSize: '1.125rem', lineHeight: '1.75rem', fontWeight: 400, fontFamily: 'mono', className: monoLg },
  monoXl:      { fontSize: '1.5rem',   lineHeight: '2rem',    fontWeight: 600, fontFamily: 'mono', className: monoXl },
  monoDisplay: { fontSize: '2.25rem',  lineHeight: '2.5rem',  fontWeight: 700, fontFamily: 'mono', className: monoDisplay },
  monoStat:    { fontSize: '1.5rem',   lineHeight: '2rem',    fontWeight: 700, fontFamily: 'mono', className: monoStat },
};

/* ═══════════════════════════════════════════════════════════════════════
   SPACING SCALE — mirrors the `--space-*` custom properties already
   declared in `app/globals.css` `:root` (same 4px-based scale; change the
   px value there and update this object to match — it is not derived
   automatically). Exposed here so non-CSS consumers (canvas/SVG layout,
   Three.js HUD placement, the density math below) can read the same
   numbers JS-side without parsing computed styles at runtime.
   ═══════════════════════════════════════════════════════════════════════ */

export type SpacingStep = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

export interface SpacingToken {
  /** Pixel value — matches the `--space-*` custom property in globals.css. */
  px: number;
  /** Rem value at the default 16px root. */
  rem: string;
  /** The CSS custom property to reference directly, e.g. `padding: var(--space-md)`. */
  cssVar: string;
  /** Tailwind spacing-scale key that resolves to the same px value (e.g. `p-4` == 16px == `md`). */
  tailwindKey: string;
}

export const SPACING_SCALE: Record<SpacingStep, SpacingToken> = {
  xs:    { px: 4,  rem: '0.25rem', cssVar: 'var(--space-xs)',  tailwindKey: '1' },
  sm:    { px: 8,  rem: '0.5rem',  cssVar: 'var(--space-sm)',  tailwindKey: '2' },
  md:    { px: 16, rem: '1rem',    cssVar: 'var(--space-md)',  tailwindKey: '4' },
  lg:    { px: 24, rem: '1.5rem',  cssVar: 'var(--space-lg)',  tailwindKey: '6' },
  xl:    { px: 32, rem: '2rem',    cssVar: 'var(--space-xl)',  tailwindKey: '8' },
  '2xl': { px: 48, rem: '3rem',    cssVar: 'var(--space-2xl)', tailwindKey: '12' },
  '3xl': { px: 64, rem: '4rem',    cssVar: 'var(--space-3xl)', tailwindKey: '16' },
};

export const SPACING_STEPS: SpacingStep[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];

/** The 44px minimum tap target already defined as `--tap-target` in globals.css (WCAG 2.5.5 / iOS HIG). */
export const TAP_TARGET_PX = 44;

/* ═══════════════════════════════════════════════════════════════════════
   DENSITY TOKENS — Low / Medium / High information density as first-class
   values, not an afterthought. Concord is a cognitive-OS cockpit with HUDs,
   telemetry tables, and multi-panel lenses: "High" is the power-user /
   dense mode, "Low" is the comfortable / accessibility-leaning mode,
   "Medium" is the current default baseline every lens already ships at
   (all multipliers below are 1 at medium — adopting density is additive,
   it changes nothing until a consumer opts in).
   Consume via the `useDensity()` hook in `lib/hooks/useDensity.ts` (applies
   `data-density` + the `--density-*` CSS custom properties globally to
   `<html>`), or read `DENSITY_TOKENS[level]` / call `densityStyle(level)`
   directly for one-off scoped math on a single subtree.
   ═══════════════════════════════════════════════════════════════════════ */

export type DensityLevel = 'low' | 'medium' | 'high';

export interface DensityToken {
  label: string;
  description: string;
  /** Multiplies the `--space-*` scale above. 1 = medium (baseline). */
  spacingMultiplier: number;
  /** Multiplies base font-size. 1 = medium (baseline). */
  fontSizeMultiplier: number;
  /** Multiplies base line-height ratio. 1 = medium (baseline). */
  lineHeightMultiplier: number;
  /** Concrete recommended list/table row height, px. */
  rowHeightPx: number;
  /** Concrete recommended flex/grid gap, px. */
  gapPx: number;
  /** Concrete recommended container padding, px. */
  paddingPx: number;
}

export const DENSITY_TOKENS: Record<DensityLevel, DensityToken> = {
  low: {
    label: 'Low',
    description: 'Comfortable — generous spacing and larger type. Best for reading-heavy or accessibility-first sessions.',
    spacingMultiplier: 1.35,
    fontSizeMultiplier: 1.08,
    lineHeightMultiplier: 1.15,
    rowHeightPx: 40,
    gapPx: 16,
    paddingPx: 20,
  },
  medium: {
    label: 'Medium',
    description: 'Balanced — the default across lenses today.',
    spacingMultiplier: 1,
    fontSizeMultiplier: 1,
    lineHeightMultiplier: 1,
    rowHeightPx: 32,
    gapPx: 12,
    paddingPx: 16,
  },
  high: {
    label: 'High',
    description: 'Dense — cockpit/telemetry mode. Maximizes on-screen information for HUDs, tables, and multi-panel lenses.',
    spacingMultiplier: 0.7,
    fontSizeMultiplier: 0.9,
    lineHeightMultiplier: 0.85,
    rowHeightPx: 24,
    gapPx: 6,
    paddingPx: 8,
  },
};

export const DENSITY_LEVELS: DensityLevel[] = ['low', 'medium', 'high'];
export const DEFAULT_DENSITY: DensityLevel = 'medium';

/** CSS custom-property names a density level's multipliers are written onto. Consume in any stylesheet, e.g. `padding: calc(var(--space-md) * var(--density-space, 1))`. */
export const DENSITY_CSS_VARS = {
  space: '--density-space',
  fontSize: '--density-font',
  lineHeight: '--density-line',
  rowHeight: '--density-row-h',
  gap: '--density-gap',
  padding: '--density-padding',
} as const;

/**
 * Plain CSS custom-property map for a density level — spread onto an
 * element's inline `style` for scoped density, or apply to
 * `document.documentElement.style` for a global switch (this is what
 * `useDensity()` in `lib/hooks/useDensity.ts` does).
 */
export function densityCssVars(level: DensityLevel): Record<string, string> {
  const t = DENSITY_TOKENS[level];
  return {
    [DENSITY_CSS_VARS.space]: String(t.spacingMultiplier),
    [DENSITY_CSS_VARS.fontSize]: String(t.fontSizeMultiplier),
    [DENSITY_CSS_VARS.lineHeight]: String(t.lineHeightMultiplier),
    [DENSITY_CSS_VARS.rowHeight]: `${t.rowHeightPx}px`,
    [DENSITY_CSS_VARS.gap]: `${t.gapPx}px`,
    [DENSITY_CSS_VARS.padding]: `${t.paddingPx}px`,
  };
}

/**
 * Same map as `densityCssVars`, typed as `CSSProperties` for direct use in
 * a React `style` prop (TypeScript can't type arbitrary custom-property
 * keys natively against `CSSProperties`, hence the cast at the boundary).
 */
export function densityStyle(level: DensityLevel): CSSProperties {
  return densityCssVars(level) as CSSProperties;
}

/* ═══════════════════════════════════════════════════════════════════════
   STATUS TOKENS — semantic color for success / warning / error / info /
   pending, consumed by ErrorState / EmptyState / StatusDot and similar
   feedback components.
   `success`/`warning`/`error`/`info` mirror the `--status-*` custom
   properties (`app/globals.css` `:root`) and the `status.*` Tailwind color
   (`tailwind.config.js`) that already back the pre-compiled
   `.status-dot.success|warning|error|info` rules in globals.css — reuse
   `dotClassName` for those, it costs nothing extra and is guaranteed to
   render (it's real CSS already emitted by the build, not a JIT-scanned
   className).
   `pending` has NO existing CSS var or compiled `.status-dot` rule — an
   honest gap, flagged rather than silently assumed. It ships as a literal
   hex + inline styles (`dotStyle`/`bgStyle`/`borderStyle`/`textStyle`),
   which render correctly regardless, until a `--status-pending` var and a
   `.status-dot.pending { @apply bg-status-pending; }` rule are added to
   `app/globals.css` (+ a matching `status.pending` color in
   `tailwind.config.js`) as a follow-up. Every field below is a real,
   renderable value — nothing here is a placeholder.
   ═══════════════════════════════════════════════════════════════════════ */

export type StatusKind = 'success' | 'warning' | 'error' | 'info' | 'pending';

export interface StatusToken {
  kind: StatusKind;
  label: string;
  /** Hex value. success/warning/error/info match `--status-*` in globals.css exactly. */
  color: string;
  /**
   * CSS var reference (with hex fallback), safe to use directly in an
   * inline `style` — bypasses Tailwind's content-glob scan entirely.
   * `pending` has no backing var so this is just the literal hex.
   */
  cssVar: string;
  /**
   * Pre-compiled class pair from `app/globals.css` (`.status-dot` +
   * `.status-dot.<kind>`) — apply verbatim on the dot element:
   * `<span className={token.dotClassName} />`. `null` for `pending`
   * (no compiled rule yet — use `dotStyle` instead).
   */
  dotClassName: string | null;
  /** Inline-style fallback for the dot; works for every kind including `pending`. */
  dotStyle: CSSProperties;
  /** ~10%-alpha background tint, for badges/panels. */
  bgStyle: CSSProperties;
  /** ~30%-alpha border tint. */
  borderStyle: CSSProperties;
  /** Solid text color. */
  textStyle: CSSProperties;
  /** True for statuses that represent in-flight work (pending) — pair with the consumer's own `animate-pulse` if a pulsing indicator is desired. */
  pulse: boolean;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildStatusToken(
  kind: StatusKind,
  label: string,
  color: string,
  dotClassName: string | null,
  pulse: boolean,
): StatusToken {
  return {
    kind,
    label,
    color,
    cssVar: dotClassName ? `var(--status-${kind}, ${color})` : color,
    dotClassName,
    dotStyle: { width: 8, height: 8, borderRadius: 9999, display: 'inline-block', backgroundColor: color },
    bgStyle: { backgroundColor: hexToRgba(color, 0.1) },
    borderStyle: { borderColor: hexToRgba(color, 0.3) },
    textStyle: { color },
    pulse,
  };
}

export const STATUS_TOKENS: Record<StatusKind, StatusToken> = {
  success: buildStatusToken('success', 'Success', '#22c55e', 'status-dot success', false),
  warning: buildStatusToken('warning', 'Warning', '#f59e0b', 'status-dot warning', false),
  error:   buildStatusToken('error',   'Error',   '#ef4444', 'status-dot error',   false),
  info:    buildStatusToken('info',    'Info',    '#3b82f6', 'status-dot info',    false),
  pending: buildStatusToken('pending', 'Pending', '#94a3b8', null,                 true),
};

export const STATUS_KINDS: StatusKind[] = ['success', 'warning', 'error', 'info', 'pending'];

/** Look up a status token by kind — equivalent to `STATUS_TOKENS[kind]`, provided for call-site readability. */
export function statusToken(kind: StatusKind): StatusToken {
  return STATUS_TOKENS[kind];
}

export const ds = {
  panel,
  panelHover,
  panelBare,
  panelFloating,
  hudPanel,
  hudPill,
  btnBase,
  btnPrimary,
  btnSecondary,
  btnDanger,
  btnGhost,
  btnSmall,
  btnNeon,
  input,
  textarea,
  select,
  label,
  heading1,
  heading2,
  heading3,
  textMuted,
  textBody,
  textMono,
  badge,
  pageContainer,
  sectionHeader,
  grid2,
  grid3,
  grid4,
  tabBar,
  tabActive,
  tabInactive,
  focusRing,
  modalBackdrop,
  modalContainer,
  modalPanel,
  // Type scale additions (heading1/2/3, textMuted, textBody, textMono above are unchanged).
  display,
  heading4,
  caption,
  overline,
  monoMicro,
  monoXs,
  monoSm,
  monoBase,
  monoLg,
  monoXl,
  monoDisplay,
  monoStat,
  typeScale: TYPE_SCALE,
  // Spacing scale.
  spacing: SPACING_SCALE,
  spacingSteps: SPACING_STEPS,
  tapTarget: TAP_TARGET_PX,
  // Density — Low/Medium/High information density.
  density: DENSITY_TOKENS,
  densityLevels: DENSITY_LEVELS,
  defaultDensity: DEFAULT_DENSITY,
  densityCssVars,
  densityStyle,
  // Semantic status color — success/warning/error/info/pending.
  status: STATUS_TOKENS,
  statusKinds: STATUS_KINDS,
  statusToken,
} as const;
