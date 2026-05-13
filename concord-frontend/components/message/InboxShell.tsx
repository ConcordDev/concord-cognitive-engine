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

import React from 'react';
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
  return (
    <div className={cn('flex h-full bg-[#f6f8fc] dark:bg-[#1a1d23] text-gray-900 dark:text-gray-100', className)}>
      {/* Label rail */}
      <aside className="w-56 shrink-0 border-r border-black/10 dark:border-white/10 py-3 px-2">
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
                    'w-full flex items-center gap-2 px-3 py-1.5 rounded-full text-sm',
                    active
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left truncate">{label.label}</span>
                  {label.count !== undefined && (
                    <span className="text-[11px] font-mono text-gray-500">{label.count}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Thread list */}
      <section className="w-96 shrink-0 border-r border-black/10 dark:border-white/10 overflow-y-auto bg-white dark:bg-[#222629]">
        <ul>
          {threads.map((t) => {
            const active = t.id === activeThreadId;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onSelectThread?.(t)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-black/5 dark:border-white/5',
                    'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
                    active && 'bg-amber-500/[0.07] dark:bg-amber-500/[0.05]',
                  )}
                >
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className={cn(
                      'flex-1 truncate text-sm',
                      t.unread ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                    )}>
                      {t.from}
                    </span>
                    {t.starred && <Star className="w-3 h-3 text-amber-400 fill-current" />}
                    {t.hasAttachment && <Paperclip className="w-3 h-3 text-gray-400" />}
                    <span className="text-[11px] text-gray-500 font-mono whitespace-nowrap">
                      {new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className={cn(
                    'truncate text-sm',
                    t.unread ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-400'
                  )}>
                    {t.subject}
                  </div>
                  <div className="truncate text-xs text-gray-500 mt-0.5">{t.snippet}</div>
                  {t.labels && t.labels.length > 0 && (
                    <div className="mt-1 flex gap-1 flex-wrap">
                      {t.labels.slice(0, 3).map((l) => (
                        <span
                          key={l}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Reading pane */}
      <main className="flex-1 overflow-y-auto bg-white dark:bg-[#1a1d23]">
        {activeThreadId ? (
          <div className="max-w-4xl mx-auto px-8 py-6">
            <div className="flex items-center gap-2 mb-6 border-b border-black/10 dark:border-white/10 pb-3">
              <button type="button" className="inline-flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5">
                <Reply className="w-3.5 h-3.5" /> Reply
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5">
                <Forward className="w-3.5 h-3.5" /> Forward
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5">
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
              <button type="button" className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 px-3 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5" aria-label="Expand">
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
