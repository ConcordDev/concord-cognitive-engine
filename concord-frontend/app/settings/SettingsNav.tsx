'use client';

/**
 * Shared nav strip for /settings sub-pages. Lightweight tab-row pattern:
 * each tab is a Link; the parent passes `active` so the current tab
 * gets a different style. Centralised here so adding a new sub-page
 * (e.g. /settings/complexity) is a one-line addition.
 */

import Link from 'next/link';

const TABS = [
  { href: '/settings', key: 'general', label: 'General' },
  { href: '/settings/accessibility', key: 'accessibility', label: 'Accessibility' },
] as const;

type SettingsTabKey = (typeof TABS)[number]['key'];

export function SettingsNav({ active }: { active: SettingsTabKey }) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex flex-wrap gap-1 rounded-lg border border-lattice-border bg-lattice-elevated/40 p-1"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              isActive
                ? 'rounded-md bg-neon-cyan/20 px-3 py-1.5 text-xs font-medium text-cyan-100 ring-1 ring-neon-cyan/40'
                : 'rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-neon-cyan/10 hover:text-cyan-200'
            }
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
