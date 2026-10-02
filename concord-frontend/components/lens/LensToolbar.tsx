'use client';

/**
 * LensToolbar — the right side of every lens header row.
 *
 * Replaces the per-lens context bar and the column of floating buttons that
 * used to sit over every lens (capture, assistant, connections, share, agent,
 * cross-lens panels, activity). Each tool still owns its panel; this toolbar
 * only shows a button for tools that are actually mounted (lib/lens-dock), so
 * nothing here is decorative. Shortcuts stay the same and are named in the
 * button titles.
 */

import { useQuery } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { Bot, History, LayoutPanelLeft, MessageCircle, Network, Plus, Sparkles } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { openLensTool, useAvailableLensTools, type LensTool } from '@/lib/lens-dock';
import { ContentPublisher } from '@/components/lens/ContentPublisher';
import { ExportMenu } from '@/components/common/ExportMenu';

const TOOLS: Array<{ tool: LensTool; icon: ComponentType<{ className?: string }>; label: string; shortcut?: string }> = [
  { tool: 'capture', icon: Plus, label: 'Quick capture', shortcut: 'Ctrl+N' },
  { tool: 'assistant', icon: Sparkles, label: 'Assistant', shortcut: 'Ctrl+/' },
  { tool: 'agent', icon: Bot, label: 'Agent mode' },
  { tool: 'connections', icon: Network, label: 'Cross-domain connections' },
  { tool: 'panels', icon: LayoutPanelLeft, label: 'Cross-lens panels' },
  { tool: 'activity', icon: History, label: 'Activity' },
];

const iconBtn =
  'flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30';

export function LensToolbar({ domain, domainLabel }: { domain: string; domainLabel: string }) {
  const available = useAvailableLensTools();
  const { data } = useQuery<{ items?: unknown[]; total?: number }>({
    queryKey: ['domain-context', domain],
    queryFn: () =>
      apiHelpers.lens
        .list(domain, { limit: 5 })
        .then((r) => r.data as { items?: unknown[]; total?: number })
        .catch(() => ({ items: [], total: 0 })),
    staleTime: 30_000,
    retry: 0,
  });
  const dtuCount = data?.total || data?.items?.length || 0;

  return (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      {dtuCount > 0 && (
        <span className="mr-2 hidden font-mono text-[11px] text-zinc-500 md:inline" title={`${dtuCount} DTUs in ${domainLabel}`}>
          {dtuCount.toLocaleString()} DTUs
        </span>
      )}
      <a
        href={`/lenses/chat?context=${encodeURIComponent(domain)}`}
        className="mr-1 flex h-7 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[12px] text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-50"
        title={`Ask about ${domainLabel} in chat`}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        Ask
      </a>
      {TOOLS.filter((t) => available.has(t.tool)).map(({ tool, icon: Icon, label, shortcut }) => (
        <button
          key={tool}
          type="button"
          onClick={() => openLensTool(tool)}
          className={iconBtn}
          title={shortcut ? `${label} (${shortcut})` : label}
          aria-label={label}
          data-testid={`lens-tool-${tool}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      <ContentPublisher domain={domain} compact className="[&>button]:h-7 [&>button]:w-7 [&>button]:justify-center [&>button]:px-0" />
      <ExportMenu domain={domain} />
    </div>
  );
}

export default LensToolbar;
