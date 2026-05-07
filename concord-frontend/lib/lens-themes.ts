/**
 * SPEC-49: Lens Theme Configuration
 * Domain-specific visual identity for each lens view.
 *
 * Each lens gets a unique accent palette, preferred layout, and empty-state
 * messaging so the UI feels like a purpose-built app rather than a generic
 * CRUD shell.
 *
 * Usage:
 *   import { useLensTheme } from '@/lib/lens-themes';
 *   const theme = useLensTheme('music');
 *   <div data-lens-theme="music" className={theme.classes.root}>...</div>
 */

import { useMemo } from 'react';

export interface LensTheme {
  id: string;
  accent: string;         // primary Tailwind color class
  accentBg: string;       // bg- variant
  accentBorder: string;   // border- variant
  accentText: string;     // text- variant
  fontFamily?: string;    // optional override font class
  darkMode: boolean;
  /** Preferred layout mode for this lens */
  layout: 'grid' | 'list' | 'timeline' | 'canvas' | 'dashboard' | 'feed' | 'masonry';
  /** Whether to prefer dark backgrounds */
  darkPreference: boolean;
  /** Lucide icon name for empty state */
  emptyStateIcon: string;
  /** Message shown when no data */
  emptyStateMessage: string;
}

/** Helper to add default new fields to legacy entries that lack them */
function withDefaults(t: Omit<LensTheme, 'layout' | 'darkPreference' | 'emptyStateIcon' | 'emptyStateMessage'> & Partial<LensTheme>): LensTheme {
  return {
    layout: 'list',
    darkPreference: t.darkMode,
    emptyStateIcon: 'layers',
    emptyStateMessage: 'Nothing here yet. Create your first item.',
    ...t,
  };
}

export const lensThemes: Record<string, LensTheme> = {
  // ── Priority A ──────────────────────────────────────────────────
  music: {
    id: 'music',
    accent: 'purple-500',
    accentBg: 'bg-purple-500/20',
    accentBorder: 'border-indigo-500/30',
    accentText: 'text-purple-400',
    darkMode: true,
    layout: 'grid',
    darkPreference: true,
    emptyStateIcon: 'music',
    emptyStateMessage: 'Your library is empty. Upload a track or explore trending music.',
  },
  feed: {
    id: 'feed',
    accent: 'blue-500',
    accentBg: 'bg-blue-500/15',
    accentBorder: 'border-pink-500/20',
    accentText: 'text-blue-400',
    darkMode: true,
    layout: 'feed',
    darkPreference: true,
    emptyStateIcon: 'rss',
    emptyStateMessage: 'Nothing in your feed yet. Follow creators to see their posts.',
  },
  marketplace: {
    id: 'marketplace',
    accent: 'amber-500',
    accentBg: 'bg-amber-500/15',
    accentBorder: 'border-orange-500/30',
    accentText: 'text-amber-400',
    darkMode: true,
    layout: 'grid',
    darkPreference: true,
    emptyStateIcon: 'store',
    emptyStateMessage: 'The marketplace is empty. Be the first to list something.',
  },
  studio: {
    id: 'studio',
    accent: 'violet-600',
    accentBg: 'bg-violet-600/20',
    accentBorder: 'border-violet-500/30',
    accentText: 'text-violet-400',
    darkMode: true,
    layout: 'canvas',
    darkPreference: true,
    emptyStateIcon: 'sliders',
    emptyStateMessage: 'No project open. Create a new session to start producing.',
  },
  trades: {
    id: 'trades',
    accent: 'teal-500',
    accentBg: 'bg-teal-500/15',
    accentBorder: 'border-slate-500/30',
    accentText: 'text-teal-400',
    darkMode: true,
    layout: 'list',
    darkPreference: true,
    emptyStateIcon: 'hard-hat',
    emptyStateMessage: 'No jobs yet. Create your first estimate or job to get started.',
  },
  forum: {
    id: 'forum',
    accent: 'orange-500',
    accentBg: 'bg-orange-500/15',
    accentBorder: 'border-amber-700/30',
    accentText: 'text-orange-400',
    darkMode: true,
    layout: 'list',
    darkPreference: true,
    emptyStateIcon: 'message-square',
    emptyStateMessage: 'No threads yet. Start a discussion or join a community.',
  },
  chat: {
    id: 'chat',
    accent: 'blue-500',
    accentBg: 'bg-gradient-to-br from-blue-500/20 to-cyan-500/10',
    accentBorder: 'border-blue-500/30',
    accentText: 'text-blue-400',
    darkMode: true,
    layout: 'list',
    darkPreference: true,
    emptyStateIcon: 'message-circle',
    emptyStateMessage: 'Start a conversation with Concord.',
  },
  // ── Priority B ──────────────────────────────────────────────────
  code: withDefaults({
    id: 'code',
    accent: 'green-400',
    accentBg: 'bg-green-500/20',
    accentBorder: 'border-green-500/30',
    accentText: 'text-green-400',
    fontFamily: 'font-mono',
    darkMode: true,
    emptyStateIcon: 'code',
    emptyStateMessage: 'No code files open. Import a repo or create a new file.',
  }),
  graph: withDefaults({
    id: 'graph',
    accent: 'cyan-400',
    accentBg: 'bg-cyan-500/20',
    accentBorder: 'border-cyan-500/30',
    accentText: 'text-cyan-400',
    darkMode: true,
    layout: 'canvas',
    emptyStateIcon: 'network',
    emptyStateMessage: 'Your knowledge graph is empty. Add nodes to get started.',
  }),
  healthcare: withDefaults({
    id: 'healthcare',
    accent: 'blue-500',
    accentBg: 'bg-blue-500/10',
    accentBorder: 'border-blue-200/20',
    accentText: 'text-blue-400',
    darkMode: false,
    layout: 'dashboard',
    emptyStateIcon: 'heart-pulse',
    emptyStateMessage: 'No health records. Connect your data sources.',
  }),
  finance: withDefaults({
    id: 'finance',
    accent: 'emerald-400',
    accentBg: 'bg-emerald-500/10',
    accentBorder: 'border-emerald-500/20',
    accentText: 'text-emerald-400',
    fontFamily: 'font-mono',
    darkMode: true,
    layout: 'dashboard',
    emptyStateIcon: 'trending-up',
    emptyStateMessage: 'No financial data. Connect accounts or add transactions.',
  }),
  education: withDefaults({
    id: 'education',
    accent: 'amber-400',
    accentBg: 'bg-amber-500/15',
    accentBorder: 'border-amber-400/30',
    accentText: 'text-amber-400',
    darkMode: true,
    layout: 'grid',
    emptyStateIcon: 'graduation-cap',
    emptyStateMessage: 'No courses or lessons yet. Explore the catalog.',
  }),
  art: withDefaults({
    id: 'art',
    accent: 'rose-400',
    accentBg: 'bg-rose-500/10',
    accentBorder: 'border-rose-400/20',
    accentText: 'text-rose-400',
    darkMode: true,
    layout: 'masonry',
    emptyStateIcon: 'palette',
    emptyStateMessage: 'Your gallery is empty. Upload or create artwork.',
  }),
  dashboard: withDefaults({
    id: 'dashboard',
    accent: 'cyan-400',
    accentBg: 'bg-cyan-500/10',
    accentBorder: 'border-cyan-500/20',
    accentText: 'text-cyan-400',
    darkMode: true,
    layout: 'dashboard',
    emptyStateIcon: 'layout-dashboard',
    emptyStateMessage: 'No widgets configured. Customize your dashboard.',
  }),
  // ── Other domain lenses ──────────────────────────────────────────
  astronomy: withDefaults({ id: 'astronomy', accent: 'indigo-400', accentBg: 'bg-indigo-500/15', accentBorder: 'border-indigo-400/30', accentText: 'text-indigo-400', darkMode: true }),
  agriculture: withDefaults({ id: 'agriculture', accent: 'lime-500', accentBg: 'bg-lime-500/15', accentBorder: 'border-lime-500/30', accentText: 'text-lime-500', darkMode: true }),
  automotive: withDefaults({ id: 'automotive', accent: 'red-500', accentBg: 'bg-red-500/15', accentBorder: 'border-red-500/30', accentText: 'text-red-500', darkMode: true }),
  aviation: withDefaults({ id: 'aviation', accent: 'sky-400', accentBg: 'bg-sky-500/15', accentBorder: 'border-sky-400/30', accentText: 'text-sky-400', darkMode: true }),
  bridge: withDefaults({ id: 'bridge', accent: 'zinc-400', accentBg: 'bg-zinc-500/15', accentBorder: 'border-zinc-400/30', accentText: 'text-zinc-400', darkMode: true }),
  chem: withDefaults({ id: 'chem', accent: 'teal-400', accentBg: 'bg-teal-500/15', accentBorder: 'border-teal-400/30', accentText: 'text-teal-400', darkMode: true }),
  construction: withDefaults({ id: 'construction', accent: 'orange-400', accentBg: 'bg-orange-500/15', accentBorder: 'border-orange-400/30', accentText: 'text-orange-400', darkMode: true }),
  consulting: withDefaults({ id: 'consulting', accent: 'amber-500', accentBg: 'bg-amber-500/10', accentBorder: 'border-amber-500/20', accentText: 'text-amber-500', darkMode: true }),
  cooking: withDefaults({ id: 'cooking', accent: 'orange-500', accentBg: 'bg-orange-500/15', accentBorder: 'border-orange-500/30', accentText: 'text-orange-500', darkMode: true }),
  desert: withDefaults({ id: 'desert', accent: 'amber-400', accentBg: 'bg-amber-400/15', accentBorder: 'border-amber-400/30', accentText: 'text-amber-400', darkMode: true }),
  electrical: withDefaults({ id: 'electrical', accent: 'yellow-400', accentBg: 'bg-yellow-400/15', accentBorder: 'border-yellow-400/30', accentText: 'text-yellow-400', darkMode: true }),
  energy: withDefaults({ id: 'energy', accent: 'yellow-500', accentBg: 'bg-yellow-500/15', accentBorder: 'border-yellow-500/30', accentText: 'text-yellow-500', darkMode: true }),
  environment: withDefaults({ id: 'environment', accent: 'emerald-500', accentBg: 'bg-emerald-500/15', accentBorder: 'border-emerald-500/30', accentText: 'text-emerald-500', darkMode: true }),
  fashion: withDefaults({ id: 'fashion', accent: 'fuchsia-400', accentBg: 'bg-fuchsia-500/10', accentBorder: 'border-fuchsia-400/20', accentText: 'text-fuchsia-400', darkMode: true }),
  fitness: withDefaults({ id: 'fitness', accent: 'red-400', accentBg: 'bg-red-400/15', accentBorder: 'border-red-400/30', accentText: 'text-red-400', darkMode: true }),
  game: withDefaults({ id: 'game', accent: 'violet-400', accentBg: 'bg-violet-500/15', accentBorder: 'border-violet-400/30', accentText: 'text-violet-400', darkMode: true }),
  geology: withDefaults({ id: 'geology', accent: 'amber-600', accentBg: 'bg-amber-600/15', accentBorder: 'border-amber-600/30', accentText: 'text-amber-600', darkMode: true }),
  hvac: withDefaults({ id: 'hvac', accent: 'sky-400', accentBg: 'bg-sky-400/15', accentBorder: 'border-sky-400/30', accentText: 'text-sky-400', darkMode: true }),
  'home-improvement': withDefaults({ id: 'home-improvement', accent: 'amber-500', accentBg: 'bg-amber-500/15', accentBorder: 'border-amber-500/30', accentText: 'text-amber-500', darkMode: true }),
  hr: withDefaults({ id: 'hr', accent: 'blue-600', accentBg: 'bg-blue-600/10', accentBorder: 'border-blue-600/20', accentText: 'text-blue-600', darkMode: true }),
  landscaping: withDefaults({ id: 'landscaping', accent: 'green-500', accentBg: 'bg-green-500/15', accentBorder: 'border-green-500/30', accentText: 'text-green-500', darkMode: true }),
  legal: withDefaults({ id: 'legal', accent: 'amber-400', accentBg: 'bg-amber-400/10', accentBorder: 'border-amber-400/20', accentText: 'text-amber-400', darkMode: true }),
  logistics: withDefaults({ id: 'logistics', accent: 'blue-500', accentBg: 'bg-blue-500/15', accentBorder: 'border-blue-500/30', accentText: 'text-blue-500', darkMode: true }),
  manufacturing: withDefaults({ id: 'manufacturing', accent: 'orange-500', accentBg: 'bg-orange-500/15', accentBorder: 'border-orange-500/30', accentText: 'text-orange-500', darkMode: true }),
  masonry: withDefaults({ id: 'masonry', accent: 'stone-400', accentBg: 'bg-stone-500/15', accentBorder: 'border-stone-400/30', accentText: 'text-stone-400', darkMode: true }),
  materials: withDefaults({ id: 'materials', accent: 'zinc-300', accentBg: 'bg-zinc-400/15', accentBorder: 'border-zinc-300/30', accentText: 'text-zinc-300', darkMode: true }),
  mining: withDefaults({ id: 'mining', accent: 'amber-500', accentBg: 'bg-amber-500/15', accentBorder: 'border-amber-500/30', accentText: 'text-amber-500', darkMode: true }),
  ocean: withDefaults({ id: 'ocean', accent: 'blue-400', accentBg: 'bg-blue-500/15', accentBorder: 'border-blue-400/30', accentText: 'text-blue-400', darkMode: true }),
  photography: withDefaults({ id: 'photography', accent: 'neutral-300', accentBg: 'bg-neutral-500/10', accentBorder: 'border-neutral-300/20', accentText: 'text-neutral-300', darkMode: true }),
  plumbing: withDefaults({ id: 'plumbing', accent: 'blue-400', accentBg: 'bg-blue-400/15', accentBorder: 'border-blue-400/30', accentText: 'text-blue-400', darkMode: true }),
  podcast: withDefaults({ id: 'podcast', accent: 'purple-400', accentBg: 'bg-purple-500/15', accentBorder: 'border-purple-400/30', accentText: 'text-purple-400', darkMode: true }),
  realestate: withDefaults({ id: 'realestate', accent: 'emerald-400', accentBg: 'bg-emerald-400/15', accentBorder: 'border-emerald-400/30', accentText: 'text-emerald-400', darkMode: true }),
  security: withDefaults({ id: 'security', accent: 'green-400', accentBg: 'bg-green-500/15', accentBorder: 'border-green-400/30', accentText: 'text-green-400', fontFamily: 'font-mono', darkMode: true }),
  sports: withDefaults({ id: 'sports', accent: 'red-500', accentBg: 'bg-red-500/15', accentBorder: 'border-red-500/30', accentText: 'text-red-500', darkMode: true }),
  travel: withDefaults({ id: 'travel', accent: 'teal-400', accentBg: 'bg-teal-400/15', accentBorder: 'border-teal-400/30', accentText: 'text-teal-400', darkMode: true }),
  'urban-planning': withDefaults({ id: 'urban-planning', accent: 'slate-400', accentBg: 'bg-slate-500/15', accentBorder: 'border-slate-400/30', accentText: 'text-slate-400', darkMode: true }),
  veterinary: withDefaults({ id: 'veterinary', accent: 'green-400', accentBg: 'bg-green-400/15', accentBorder: 'border-green-400/30', accentText: 'text-green-400', darkMode: true }),
  welding: withDefaults({ id: 'welding', accent: 'orange-400', accentBg: 'bg-orange-400/15', accentBorder: 'border-orange-400/30', accentText: 'text-orange-400', darkMode: true }),
};

// ── Default theme for unlisted lenses ────────────────────────────────────────

export const defaultLensTheme: LensTheme = {
  id: 'default',
  accent: 'gray-400',
  accentBg: 'bg-gray-500/10',
  accentBorder: 'border-gray-500/20',
  accentText: 'text-gray-400',
  darkMode: true,
  layout: 'list',
  darkPreference: true,
  emptyStateIcon: 'layers',
  emptyStateMessage: 'Nothing here yet. Create your first item.',
};

// ── Helper hook ──────────────────────────────────────────────────────────────

export interface LensThemeUtils {
  theme: LensTheme;
  classes: {
    root: string;
    accentPanel: string;
    accentButton: string;
    accentBadge: string;
    accentTab: string;
    accentTabInactive: string;
    accentHeading: string;
    accentIcon: string;
    accentRing: string;
    accentGlow: string;
  };
}

export function useLensTheme(domain: string): LensThemeUtils {
  return useMemo(() => {
    const theme = lensThemes[domain] || defaultLensTheme;
    return {
      theme,
      classes: {
        root: `lens-${theme.id}`,
        accentPanel: `${theme.accentBg} ${theme.accentBorder} border rounded-xl`,
        accentButton: `${theme.accentBg} ${theme.accentText} ${theme.accentBorder} border hover:brightness-125 transition-all`,
        accentBadge: `${theme.accentBg} ${theme.accentText} text-xs font-medium px-2 py-0.5 rounded-full`,
        accentTab: `${theme.accentText} border-b-2 border-current`,
        accentTabInactive: 'text-gray-400 border-b-2 border-transparent hover:text-white hover:border-gray-600 transition-colors',
        accentHeading: `${theme.accentText} font-semibold`,
        accentIcon: theme.accentText,
        accentRing: `focus:ring-2 focus:ring-${theme.accent}/50 focus:ring-offset-2 focus:ring-offset-lattice-void`,
        accentGlow: `shadow-lg shadow-${theme.accent}/10`,
      },
    };
  }, [domain]);
}
