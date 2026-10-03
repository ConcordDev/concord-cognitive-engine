'use client';

/**
 * LensToolbar — the right side of every lens header row.
 *
 * Lens north stars (docs/lens-northstar) keep lens chrome nearly empty: no Ask
 * button, DTU count or tool strip competing with the lens. So the toolbar is
 * one "⋯" menu (Ask, Kay, and every MOUNTED lens tool from lib/lens-dock —
 * capture, assistant, agent, connections, cross-lens panels, activity) plus
 * share and export, which own their own dialogs. Shortcuts are unchanged and
 * listed in the menu. Nothing here is decorative: a tool only appears when it
 * is mounted and will actually open.
 */

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot, CircleDot, History, LayoutPanelLeft, MessageCircle, MoreHorizontal, Network, Plus, Sparkles,
} from 'lucide-react';
import { useConkayInitiativeStore } from '@/components/conkay/conkayInitiativeStore';
import { apiHelpers } from '@/lib/api/client';
import { openLensTool, useAvailableLensTools, type LensTool } from '@/lib/lens-dock';
import { ContentPublisher } from '@/components/lens/ContentPublisher';
import { ExportMenu } from '@/components/common/ExportMenu';

const TOOLS: Array<{ tool: LensTool; icon: ComponentType<{ className?: string }>; label: string; shortcut?: string }> = [
  { tool: 'capture', icon: Plus, label: 'Quick capture', shortcut: '⌘N' },
  { tool: 'assistant', icon: Sparkles, label: 'Assistant', shortcut: '⌘/' },
  { tool: 'agent', icon: Bot, label: 'Agent mode' },
  { tool: 'connections', icon: Network, label: 'Cross-domain connections' },
  { tool: 'panels', icon: LayoutPanelLeft, label: 'Cross-lens panels' },
  { tool: 'activity', icon: History, label: 'Activity' },
];

const itemCls =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-50';

export function LensToolbar({ domain, domainLabel }: { domain: string; domainLabel: string }) {
  const available = useAvailableLensTools();
  const kayPending = useConkayInitiativeStore((s) => s.pending.length);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery<{ items?: unknown[]; total?: number }>({
    queryKey: ['domain-context', domain],
    queryFn: () =>
      apiHelpers.lens
        .list(domain, { limit: 5 })
        .then((r) => r.data as { items?: unknown[]; total?: number })
        .catch(() => ({ items: [], total: 0 })),
    staleTime: 30_000,
    retry: 0,
    enabled: open,
  });
  const dtuCount = data?.total || data?.items?.length || 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="flex flex-shrink-0 items-center gap-0.5">
      <ContentPublisher domain={domain} compact className="[&>button]:h-7 [&>button]:w-7 [&>button]:justify-center [&>button]:px-0" />
      <ExportMenu domain={domain} />
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="relative flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          aria-label="Lens tools"
          aria-expanded={open}
          aria-haspopup="menu"
          title="Lens tools"
          data-testid="lens-tools-menu"
        >
          <MoreHorizontal className="h-4 w-4" />
          {kayPending > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-teal-400" aria-hidden="true" />}
        </button>
        {open && (
          <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
            <a role="menuitem" href={`/lenses/chat?context=${encodeURIComponent(domain)}`} className={itemCls}>
              <MessageCircle className="h-4 w-4 text-zinc-500" />
              <span className="flex-1">Ask about {domainLabel}</span>
              {dtuCount > 0 && <span className="font-mono text-[11px] text-zinc-500">{dtuCount.toLocaleString()}</span>}
            </a>
            {domain !== 'chat' && (
              <button role="menuitem" type="button" className={itemCls} onClick={run(() => window.dispatchEvent(new Event('conkay:summon')))} data-testid="lens-tool-kay">
                <CircleDot className="h-4 w-4 text-zinc-500" />
                <span className="flex-1">Kay{kayPending > 0 ? ` · ${kayPending} waiting` : ''}</span>
                <kbd className="font-mono text-[11px] text-zinc-500">⌘J</kbd>
              </button>
            )}
            {TOOLS.filter((t) => available.has(t.tool)).map(({ tool, icon: Icon, label, shortcut }) => (
              <button key={tool} role="menuitem" type="button" className={itemCls} onClick={run(() => openLensTool(tool))} data-testid={`lens-tool-${tool}`}>
                <Icon className="h-4 w-4 text-zinc-500" />
                <span className="flex-1">{label}</span>
                {shortcut && <kbd className="font-mono text-[11px] text-zinc-500">{shortcut}</kbd>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default LensToolbar;
