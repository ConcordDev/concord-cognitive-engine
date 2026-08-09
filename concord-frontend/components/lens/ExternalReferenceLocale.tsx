'use client';

// concord-frontend/components/lens/ExternalReferenceLocale.tsx
//
// The one, consistent place a lens puts a link out to an external information
// provider (Hacker News, GitHub, etc.) — collapsed by default, opened on
// demand. Concord's own answer for "I need outside context" is ConKay/chat
// (tools.web_search + citation), not a permanently-mounted third-party feed
// competing for the same screen real estate as the lens's own work — a
// promoted, always-visible external panel reads as free advertising for
// someone else's product on Concord's own page, not a designed feature.
//
// This is the "designed locale": every lens that needs one mounts THIS
// component in the same collapsed, search-on-demand shape, instead of each
// lens inventing its own always-open block. Content lives in `children` —
// this component only owns the disclosure chrome.

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Globe2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExternalReferenceLocaleProps {
  /** e.g. "Hacker News", "GitHub" — shown in the collapsed pill. */
  label: string;
  /** e.g. "hn.algolia.com" — small provenance hint next to the label. */
  source?: string;
  children: ReactNode;
  className?: string;
}

export function ExternalReferenceLocale({ label, source, children, className }: ExternalReferenceLocaleProps) {
  const [open, setOpen] = useState(false);

  return (
    <section
      className={cn('rounded-lg border border-zinc-800/80 bg-zinc-950/40', className)}
      data-testid="external-reference-locale"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        aria-expanded={open}
      >
        <Globe2 className="h-3.5 w-3.5 text-zinc-500" />
        <span>Look up {label}</span>
        {source && <span className="font-mono text-[10px] text-zinc-600">{source}</span>}
        {open ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-zinc-800/60">{children}</div>}
    </section>
  );
}

export default ExternalReferenceLocale;
