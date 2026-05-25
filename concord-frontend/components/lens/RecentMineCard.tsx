'use client';

/**
 * RecentMineCard — "Your last N <artifact>" surface for any lens.
 *
 * Phase 2 / 3 of the 10-dimension UX completeness sprint. Drop one
 * inside any lens to expose the user's recent work in that domain.
 * Backed by the universal `${domain}.recent_mine` macro (Phase 2 bulk
 * registration) and the `useListMine` hook (Phase 1).
 *
 * Usage:
 *
 *   <RecentMineCard domain="pharmacy" limit={10} />
 *
 *   // With click handler:
 *   <RecentMineCard
 *     domain="art"
 *     limit={6}
 *     onSelect={(item) => router.push(`/lenses/art/${item.id}`)}
 *   />
 *
 *   // Override the title:
 *   <RecentMineCard domain="forge" title="My recent apps" />
 *
 * Honest empty state: when the user has no recent work in this lens,
 * shows a quiet hint (not a hard CTA — the EmptyStateCTA component
 * handles the "first ever" case).
 */

import { useMemo } from 'react';
import { Clock, Loader2, FileText, ArrowRight } from 'lucide-react';
import { useListMine } from '@/hooks/useListMine';
import { cn } from '@/lib/utils';

export interface RecentMineCardProps {
  /** Domain whose recent_mine macro to call. */
  domain: string;
  /** Display title; defaults to "Recent in <domain>". */
  title?: string;
  /** Max items to show. Default 10. */
  limit?: number;
  /** Socket events that should trigger refetch. */
  watchEvents?: string[];
  /** Called when the user clicks an item. */
  onSelect?: (item: RecentMineItem) => void;
  /** Hide the card entirely when the list is empty. Default false. */
  hideWhenEmpty?: boolean;
  className?: string;
}

interface RecentMineItem {
  id?: string | number;
  title?: string;
  type?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

function formatRelative(ts: number | undefined): string {
  if (!ts) return '';
  const n = Number(ts);
  if (!Number.isFinite(n)) return '';
  const ms = (n > 1e12 ? n : n * 1000); // unix-seconds or ms
  const diffSec = (Date.now() - ms) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))}mo ago`;
  return `${Math.floor(diffSec / (86400 * 365))}y ago`;
}

export function RecentMineCard({
  domain,
  title,
  limit = 10,
  watchEvents,
  onSelect,
  hideWhenEmpty = false,
  className,
}: RecentMineCardProps) {
  const { items, total, loading, error, refetch } = useListMine<RecentMineItem>(domain, {
    limit,
    watchEvents,
  });

  const headline = useMemo(() => title || `Recent in ${domain}`, [title, domain]);

  if (hideWhenEmpty && !loading && items.length === 0 && !error) return null;

  return (
    <section
      className={cn(
        'rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden',
        className,
      )}
      aria-label={headline}
    >
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80">
        <Clock className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
        <h3 className="text-xs font-medium text-zinc-300 flex-1">{headline}</h3>
        {total > 0 && (
          <span className="text-[10px] text-zinc-400 font-mono">{Math.min(items.length, limit)} / {total}</span>
        )}
        {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-400" aria-hidden="true" />}
      </header>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          Couldn’t load recents — <button onClick={() => void refetch()} className="underline hover:text-rose-200">retry</button>
        </div>
      )}

      {!error && !loading && items.length === 0 && (
        <div className="px-3 py-4 text-xs text-zinc-400 italic">
          Nothing recent — your work in this lens will show up here.
        </div>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-zinc-800/60">
          {items.map((item, idx) => {
            const key = item.id ?? `r${idx}`;
            const itemTitle = item.title || (typeof item.type === 'string' ? item.type : 'Untitled');
            const ts = item.updatedAt ?? item.createdAt;
            const Component = onSelect ? 'button' : 'div';
            return (
              <li key={key}>
                <Component
                  type={onSelect ? 'button' : undefined}
                  onClick={onSelect ? () => onSelect(item) : undefined}
                  className={cn(
                    'w-full text-left flex items-center gap-2 px-3 py-2 text-xs',
                    onSelect ? 'hover:bg-zinc-900/60 cursor-pointer transition-colors' : '',
                  )}
                >
                  <FileText className="w-3 h-3 text-zinc-400 shrink-0" aria-hidden="true" />
                  <span className="text-zinc-200 truncate flex-1">{itemTitle}</span>
                  {ts && <span className="text-[10px] text-zinc-400 font-mono shrink-0">{formatRelative(ts)}</span>}
                  {onSelect && <ArrowRight className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden="true" />}
                </Component>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default RecentMineCard;
