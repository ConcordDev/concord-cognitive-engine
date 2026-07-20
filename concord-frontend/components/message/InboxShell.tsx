'use client';
// @ghost-click-ok: silhouette/scaffolding component — Reply/Forward/Archive
// buttons are visual placeholders for the inbox shape; caller wires real
// handlers via children.

/**
 * InboxShell — Gmail / Front 3-pane inbox silhouette.
 *
 * Label rail + thread list + reading pane. Drop-in for /lenses/message
 * or any inbox-shaped lens. Threads carry from/subject/snippet/time
 * just like every email client; the caller renders the actual
 * reading pane via children so message body / quote chain / forward
 * controls stay caller-owned.
 */

import React, { useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
  Inbox, Send, Star, Archive, Trash2, Tag, Clock,
  Paperclip, Reply, Forward, ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InboxThread {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  timestamp: string;
  unread?: boolean;
  starred?: boolean;
  hasAttachment?: boolean;
  labels?: string[];
}

export interface InboxLabel {
  id: string;
  label: string;
  count?: number;
  icon?: 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'tag' | 'snoozed';
}

export interface InboxShellProps {
  labels: InboxLabel[];
  threads: InboxThread[];
  activeLabelId?: string;
  activeThreadId?: string;
  onSelectLabel?: (label: InboxLabel) => void;
  onSelectThread?: (thread: InboxThread) => void;
  /** Reading pane content for the selected thread. */
  children: React.ReactNode;
  className?: string;
}

const LABEL_ICONS = {
  inbox: Inbox,
  sent: Send,
  starred: Star,
  archive: Archive,
  trash: Trash2,
  tag: Tag,
  snoozed: Clock,
} as const;

export function InboxShell({
  labels,
  threads,
  activeLabelId,
  activeThreadId,
  onSelectLabel,
  onSelectThread,
  children,
  className,
}: InboxShellProps) {
  // A heavy DM user can accumulate hundreds of conversations; this list
  // used to render every <li> unconditionally into the DOM regardless of
  // scroll position. Virtualized with the same react-virtuoso already
  // proven for the chat lens's message thread (app/lenses/chat/page.tsx) —
  // reusing it here instead of adding a second windowing library.
  const renderThreadRow = useCallback(
    (_index: number, t: InboxThread) => {
      const active = t.id === activeThreadId;
      return (
        <button
          type="button"
          onClick={() => onSelectThread?.(t)}
          className={cn(
            'w-full text-left pl-3 pr-4 py-2.5 border-b border-lattice-border/60 border-l-2 transition-colors duration-100',
            'hover:bg-white/[0.03]',
            t.unread ? 'border-l-neon-blue' : 'border-l-transparent',
            active && 'bg-neon-blue/[0.06]',
          )}
        >
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className={cn(
              'flex-1 truncate text-sm',
              t.unread ? 'font-semibold text-white' : 'text-gray-300'
            )}>
              {t.from}
            </span>
            {t.starred && <Star className="w-3 h-3 text-amber-400 fill-current shrink-0" />}
            {t.hasAttachment && <Paperclip className="w-3 h-3 text-gray-500 shrink-0" />}
            <span className="text-[11px] text-gray-500 font-mono tabular-nums whitespace-nowrap">
              {new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <div className={cn(
            'truncate text-sm',
            t.unread ? 'font-medium text-gray-100' : 'text-gray-400'
          )}>
            {t.subject}
          </div>
          <div className="truncate text-xs text-gray-500 mt-0.5">{t.snippet}</div>
          {t.labels && t.labels.length > 0 && (
            <div className="mt-1 flex gap-1 flex-wrap">
              {t.labels.slice(0, 3).map((l) => (
                <span
                  key={l}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-elevated border border-lattice-border text-gray-400"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </button>
      );
    },
    [activeThreadId, onSelectThread]
  );

  return (
    <div className={cn('flex h-full bg-lattice-void text-gray-100', className)}>
      {/* Label rail */}
      <aside className="w-56 shrink-0 border-r border-lattice-border py-3 px-2">
        <ul className="space-y-0.5">
          {labels.map((label) => {
            const Icon = label.icon ? LABEL_ICONS[label.icon] : Tag;
            const active = label.id === activeLabelId;
            return (
              <li key={label.id}>
                <button
                  type="button"
                  onClick={() => onSelectLabel?.(label)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors duration-100',
                    active
                      ? 'bg-neon-blue/10 text-neon-blue font-medium'
                      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{label.label}</span>
                  {label.count !== undefined && (
                    <span className={cn(
                      'text-[11px] font-mono tabular-nums',
                      active ? 'text-neon-blue' : 'text-gray-500'
                    )}>{label.count}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Thread list — Virtuoso owns its own scroll container, so no
          overflow-y-auto here (would fight its internal scroller). */}
      <section className="w-96 shrink-0 border-r border-lattice-border bg-lattice-surface">
        <Virtuoso
          data={threads}
          style={{ height: '100%' }}
          itemContent={renderThreadRow}
        />
      </section>

      {/* Reading pane */}
      <main className="flex-1 overflow-y-auto bg-lattice-void">
        {activeThreadId ? (
          <div className="max-w-4xl mx-auto px-8 py-6">
            <div className="flex items-center gap-2 mb-6 border-b border-lattice-border pb-3">
              <button type="button" className="inline-flex items-center gap-1 text-sm text-gray-300 px-3 py-1.5 rounded hover:bg-white/5 hover:text-white transition-colors duration-100">
                <Reply className="w-3.5 h-3.5" /> Reply
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-gray-300 px-3 py-1.5 rounded hover:bg-white/5 hover:text-white transition-colors duration-100">
                <Forward className="w-3.5 h-3.5" /> Forward
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-gray-300 px-3 py-1.5 rounded hover:bg-white/5 hover:text-white transition-colors duration-100">
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
              <button type="button" className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 px-3 py-1.5 rounded hover:bg-white/5 hover:text-gray-300 transition-colors duration-100" aria-label="Expand">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            {children}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-500 italic">
            Select a thread to read.
          </div>
        )}
      </main>
    </div>
  );
}

export default InboxShell;
