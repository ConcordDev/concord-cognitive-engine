'use client';

/**
 * WorkspaceTabs — the one tab strip every workspace header uses (core lenses
 * and destinations alike). Linear-style: quiet text tabs, the active tab is a
 * subtle filled pill, no per-lens accent colors and no underline rule — the
 * header row's own bottom border is the only line.
 */

import Link from 'next/link';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface WorkspaceTab {
  id: string;
  label: string;
  path: string;
  icon?: ComponentType<{ className?: string }>;
}

export function WorkspaceTabs({
  tabs,
  activePath,
  label,
}: {
  tabs: WorkspaceTab[];
  activePath: string;
  label: string;
}) {
  return (
    <nav
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]"
      aria-label={label}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activePath === tab.path;
        return (
          <Link
            key={tab.id}
            href={tab.path}
            className={cn(
              'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] transition-colors',
              isActive
                ? 'bg-white/[0.08] text-zinc-50'
                : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100',
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            {Icon && <Icon className={cn('h-3.5 w-3.5', isActive ? 'opacity-90' : 'opacity-60')} />}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default WorkspaceTabs;
