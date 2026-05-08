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
 */

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

/** Buttons */
const btnBase =
  'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-lattice-void disabled:opacity-50 disabled:pointer-events-none';

const btnPrimary =
  'bg-gradient-to-r from-neon-blue to-cyan-500 text-white font-medium rounded-lg px-4 py-2 shadow-lg shadow-neon-blue/25 hover:shadow-neon-blue/40 hover:brightness-110 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-neon-blue/50 disabled:opacity-50 disabled:cursor-not-allowed';

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

export const ds = {
  panel,
  panelHover,
  panelBare,
  panelFloating,
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
} as const;
