'use client';

/**
 * DocsShell — Notion / Word-shape document workspace.
 *
 * Sidebar with document tree, main editor area with title + body slot,
 * right rail for comments / outline / activity. Drop-in for /lenses/
 * legal, /lenses/docs, /lenses/paper, and any other document-shaped
 * surface. The caller renders the actual editor (TipTap / Lexical /
 * MD textarea) into `children`; this component handles the chrome.
 */

import React, { useState } from 'react';
import {
  ChevronRight, FileText, Folder, Plus, Search, MessageSquare, ListTree, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DocNode {
  id: string;
  title: string;
  kind: 'doc' | 'folder';
  children?: DocNode[];
  emoji?: string;
}

export interface DocComment {
  id: string;
  author: string;
  body: string;
  timestamp: string;
}

export interface DocsShellProps {
  tree: DocNode[];
  activeDocId?: string;
  /** Title editor value + change handler for the active doc. */
  title: string;
  onTitleChange?: (next: string) => void;
  /** Editor body — TipTap / Lexical / MD textarea — caller-owned. */
  children: React.ReactNode;
  onSelectDoc?: (doc: DocNode) => void;
  onCreateDoc?: () => void;
  /** Right-rail content. */
  comments?: DocComment[];
  outline?: Array<{ id: string; level: number; text: string }>;
  className?: string;
}

type RightRail = 'comments' | 'outline' | 'activity';

export function DocsShell({
  tree,
  activeDocId,
  title,
  onTitleChange,
  children,
  onSelectDoc,
  onCreateDoc,
  comments = [],
  outline = [],
  className,
}: DocsShellProps) {
  const [rail, setRail] = useState<RightRail>('outline');
  const [searchQuery, setSearchQuery] = useState('');
  return (
    <div className={cn('flex h-full bg-white text-gray-900 dark:bg-[#191919] dark:text-gray-100', className)}>
      {/* Left sidebar — document tree */}
      <aside className="w-64 shrink-0 border-r border-black/10 dark:border-white/10 flex flex-col bg-gray-50 dark:bg-[#202020]">
        <div className="p-2 border-b border-black/5 dark:border-white/5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search docs"
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-white dark:bg-black/30 border border-black/10 dark:border-white/10 rounded"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 text-sm">
          <ul>
            {tree.map((n) => (
              <DocNodeItem
                key={n.id}
                node={n}
                depth={0}
                activeId={activeDocId}
                onSelect={onSelectDoc}
              />
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={onCreateDoc}
          className="m-2 inline-flex items-center justify-center gap-1 py-1.5 text-xs bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded"
        >
          <Plus className="w-3 h-3" /> New doc
        </button>
      </aside>

      {/* Center editor */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="max-w-3xl w-full mx-auto px-12 py-12">
          <input
            value={title}
            onChange={(e) => onTitleChange?.(e.target.value)}
            placeholder="Untitled"
            className="w-full text-4xl font-semibold bg-transparent outline-none placeholder:text-gray-400"
          />
          <div className="mt-6 prose dark:prose-invert max-w-none text-base leading-relaxed">
            {children}
          </div>
        </div>
      </main>

      {/* Right rail — comments / outline / activity */}
      <aside className="w-72 shrink-0 border-l border-black/10 dark:border-white/10 bg-gray-50 dark:bg-[#202020] flex flex-col">
        <nav className="flex border-b border-black/5 dark:border-white/5">
          {(
            [
              { id: 'outline' as const,  icon: ListTree,       label: 'Outline' },
              { id: 'comments' as const, icon: MessageSquare,  label: 'Comments' },
              { id: 'activity' as const, icon: Activity,       label: 'Activity' },
            ]
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setRail(id)}
              aria-pressed={rail === id}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs',
                rail === id
                  ? 'text-gray-900 dark:text-white border-b-2 border-amber-500'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-3 text-sm">
          {rail === 'outline' && (
            outline.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No headings yet.</p>
            ) : (
              <ul className="space-y-1">
                {outline.map((h) => (
                  <li key={h.id} className="text-xs text-gray-700 dark:text-gray-300 truncate" style={{ paddingLeft: (h.level - 1) * 12 }}>
                    {h.text}
                  </li>
                ))}
              </ul>
            )
          )}
          {rail === 'comments' && (
            comments.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No comments yet.</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-md border border-black/10 dark:border-white/10 p-2">
                    <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{c.author}</div>
                    <div className="text-xs text-gray-700 dark:text-gray-300">{c.body}</div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      {new Date(c.timestamp).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
          {rail === 'activity' && (
            <p className="text-xs text-gray-500 italic">Activity log surfaces here.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

interface DocNodeItemProps {
  node: DocNode;
  depth: number;
  activeId?: string;
  onSelect?: (n: DocNode) => void;
}

function DocNodeItem({ node, depth, activeId, onSelect }: DocNodeItemProps) {
  const [open, setOpen] = useState(depth === 0);
  if (node.kind === 'folder') {
    return (
      <>
        <li>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 w-full text-left rounded hover:bg-black/5 dark:hover:bg-white/5"
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <ChevronRight className={cn('w-3 h-3 text-gray-500 transition-transform', open && 'rotate-90')} />
            <Folder className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-sm">{node.title}</span>
          </button>
        </li>
        {open && node.children?.map((c) => (
          <DocNodeItem key={c.id} node={c} depth={depth + 1} activeId={activeId} onSelect={onSelect} />
        ))}
      </>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(node)}
        className={cn(
          'flex items-center gap-1 px-2 py-1 w-full text-left rounded',
          activeId === node.id ? 'bg-black/10 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5'
        )}
        style={{ paddingLeft: 8 + depth * 12 + 12 }}
      >
        {node.emoji ? <span className="text-sm">{node.emoji}</span> : <FileText className="w-3.5 h-3.5 text-gray-500" />}
        <span className="text-sm truncate">{node.title || 'Untitled'}</span>
      </button>
    </li>
  );
}

export default DocsShell;
