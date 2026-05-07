'use client';

/**
 * LensActionBar — Contextual action bar per lens.
 *
 * Every lens gets an action bar below the header showing the most
 * important actions for that domain. Primary action is a filled button.
 * Secondary actions are ghost buttons. Scrollable on mobile.
 *
 * Two-Tap Rule: Every feature must be reachable within two taps.
 * Tap 0: User is on the lens page.
 * Tap 1: User sees the action or opens a menu.
 * Tap 2: User executes the action.
 */

import { ReactNode, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LensAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  requiresAuth?: boolean;
  disabled?: boolean;
  badge?: string | number;
}

interface LensActionBarProps {
  actions: LensAction[];
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function LensActionBar({ actions, className }: LensActionBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!actions || actions.length === 0) return null;

  // Sort: primary first
  const sorted = [...actions].sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return 0;
  });

  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex items-center gap-2 px-4 py-2 overflow-x-auto scrollbar-none',
        '-mx-4 px-4 sm:mx-0 sm:px-0', // edge-to-edge scroll on mobile
        className,
      )}
      role="toolbar"
      aria-label="Lens actions"
    >
      {sorted.map(action => (
        <button
          key={action.id}
          onClick={action.onClick}
          disabled={action.disabled}
          className={cn(
            // Base styles — meets 44px min tap target
            'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl',
            'text-sm font-medium whitespace-nowrap transition-all',
            'min-h-[44px] min-w-[44px]',
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--bg-base,#0C0C0E)]',
            // Primary vs secondary styling
            action.primary
              ? 'bg-[var(--lens-accent,#3ECFA0)] text-[var(--bg-base,#0C0C0E)] font-semibold hover:brightness-110 focus:ring-[var(--lens-accent,#3ECFA0)]'
              : 'bg-[var(--bg-raised,#1C1C20)] text-[var(--text-secondary,#9B978F)] border border-[var(--border-subtle,rgba(240,237,232,0.06))] hover:text-[var(--text-primary,#F0EDE8)] hover:border-[var(--border-default,rgba(240,237,232,0.10))] focus:ring-gray-500',
            action.disabled && 'opacity-50 cursor-not-allowed',
          )}
          aria-label={action.label}
        >
          <span className="flex-shrink-0 w-4 h-4 [&>svg]:w-4 [&>svg]:h-4">
            {action.icon}
          </span>
          <span>{action.label}</span>
          {action.badge != null && (
            <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-[var(--lens-accent,#3ECFA0)]/20 text-[var(--lens-accent,#3ECFA0)]">
              {action.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Action Registry ──────────────────────────────────────────────────────────
// Pre-defined action templates for common lenses.
// Lens pages import these and wire onClick to their own handlers.

export const ACTION_TEMPLATES = {
  music: [
    { id: 'upload', label: 'Upload Track', primary: true },
    { id: 'playlist', label: 'Playlists' },
    { id: 'studio', label: 'Open Studio' },
    { id: 'browse', label: 'Browse' },
  ],
  code: [
    { id: 'new-file', label: 'New File', primary: true },
    { id: 'templates', label: 'Templates' },
    { id: 'run', label: 'Run' },
    { id: 'terminal', label: 'Terminal' },
  ],
  legal: [
    { id: 'new-doc', label: 'New Document', primary: true },
    { id: 'templates', label: 'Templates' },
    { id: 'search', label: 'Search Cases' },
    { id: 'contracts', label: 'Contracts' },
  ],
  news: [
    { id: 'submit', label: 'Submit Story', primary: true },
    { id: 'sources', label: 'Sources' },
    { id: 'saved', label: 'Saved' },
    { id: 'topics', label: 'Topics' },
  ],
  art: [
    { id: 'upload', label: 'Upload Art', primary: true },
    { id: 'gallery', label: 'Gallery' },
    { id: 'collections', label: 'Collections' },
    { id: 'challenges', label: 'Challenges' },
  ],
  finance: [
    { id: 'watchlist', label: 'Watchlist', primary: true },
    { id: 'charts', label: 'Charts' },
    { id: 'indicators', label: 'Indicators' },
    { id: 'analysis', label: 'Analysis' },
  ],
  trades: [
    { id: 'upload', label: 'Upload Tutorial', primary: true },
    { id: 'browse', label: 'Browse Trades' },
    { id: 'materials', label: 'Materials' },
    { id: 'ask', label: 'Ask a Question' },
  ],
  forum: [
    { id: 'new-thread', label: 'New Thread', primary: true },
    { id: 'hot', label: 'Hot' },
    { id: 'new', label: 'New' },
    { id: 'top', label: 'Top' },
  ],
  marketplace: [
    { id: 'list', label: 'List Item', primary: true },
    { id: 'browse', label: 'Browse' },
    { id: 'my-listings', label: 'My Listings' },
    { id: 'purchases', label: 'Purchases' },
  ],
  feed: [
    { id: 'post', label: 'New Post', primary: true },
    { id: 'following', label: 'Following' },
    { id: 'trending', label: 'Trending' },
    { id: 'discover', label: 'Discover' },
  ],
  research: [
    { id: 'new-paper', label: 'New Paper', primary: true },
    { id: 'search', label: 'Search' },
    { id: 'citations', label: 'Citations' },
    { id: 'datasets', label: 'Datasets' },
  ],
  education: [
    { id: 'new-course', label: 'New Course', primary: true },
    { id: 'browse', label: 'Browse' },
    { id: 'my-courses', label: 'My Courses' },
    { id: 'progress', label: 'Progress' },
  ],
  healthcare: [
    { id: 'search', label: 'Search', primary: true },
    { id: 'references', label: 'References' },
    { id: 'saved', label: 'Saved' },
    { id: 'disclaimer', label: 'Disclaimer' },
  ],
  photography: [
    { id: 'upload', label: 'Upload Photo', primary: true },
    { id: 'gallery', label: 'Gallery' },
    { id: 'albums', label: 'Albums' },
    { id: 'edit', label: 'Edit' },
  ],
  cooking: [
    { id: 'new-recipe', label: 'New Recipe', primary: true },
    { id: 'browse', label: 'Browse' },
    { id: 'my-recipes', label: 'My Recipes' },
    { id: 'shopping-list', label: 'Shopping List' },
  ],
  science: [
    { id: 'new-experiment', label: 'New Experiment', primary: true },
    { id: 'browse', label: 'Browse' },
    { id: 'data', label: 'Data' },
    { id: 'collaborate', label: 'Collaborate' },
  ],
  studio: [
    { id: 'record', label: 'Record', primary: true },
    { id: 'projects', label: 'Projects' },
    { id: 'mixer', label: 'Mixer' },
    { id: 'effects', label: 'Effects' },
  ],
} as const;
