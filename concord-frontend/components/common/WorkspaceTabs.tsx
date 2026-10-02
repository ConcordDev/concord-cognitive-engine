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
      className="inline-flex max-w-full min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar rounded-xl border border-white/[0.08] bg-white/[0.02] p-1"
      aria-label={label}
    >
      {tabs.map((tab) => {
        const isActive = activePath === tab.path;
        return (
          <Link
            key={tab.id}
            href={tab.path}
            className={cn(
              'flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors',
              isActive
                ? 'bg-white/[0.09] text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-200',
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default WorkspaceTabs;
