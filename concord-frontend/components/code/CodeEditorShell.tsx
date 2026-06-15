'use client';

/**
 * CodeEditorShell — IDE silhouette: activity bar + file tree + tab strip +
 * editor pane + status bar.
 *
 * Drop-in for /lenses/code (and any code-like lens — repos, debug,
 * scripts). Ships the visual structure every IDE shares so the lens
 * reads as a familiar IDE in 200ms; the actual editor / file-tree contents
 * are passed as children so callers stay in control of behaviour.
 */

import React from 'react';
import {
  FileText, Search, GitBranch, Bug, Settings, Folder, FolderOpen, ChevronRight,
  X as CloseIcon, Circle, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileTreeNode {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  children?: FileTreeNode[];
  modified?: boolean;
}

export interface OpenTab {
  id: string;
  label: string;
  modified?: boolean;
}

export type ActivityIcon = 'files' | 'search' | 'git' | 'debug' | 'settings';

export interface CodeEditorShellProps {
  files: FileTreeNode[];
  openTabs: OpenTab[];
  activeTabId?: string;
  onSelectFile?: (file: FileTreeNode) => void;
  onSelectTab?: (tab: OpenTab) => void;
  onCloseTab?: (tab: OpenTab) => void;
  /** Editor pane render — Monaco, CodeMirror, or whatever the caller wants. */
  children: React.ReactNode;
  activeActivity?: ActivityIcon;
  onActivityChange?: (act: ActivityIcon) => void;
  /** Status bar content (branch, errors, language, line/col). */
  statusBar?: {
    branch?: string;
    errors?: number;
    warnings?: number;
    language?: string;
    cursor?: string;
  };
  className?: string;
}

const ACTIVITY_ICONS: Array<{ id: ActivityIcon; icon: typeof FileText; label: string }> = [
  { id: 'files',    icon: FileText,  label: 'Explorer' },
  { id: 'search',   icon: Search,    label: 'Search' },
  { id: 'git',      icon: GitBranch, label: 'Source control' },
  { id: 'debug',    icon: Bug,       label: 'Run and debug' },
  { id: 'settings', icon: Settings,  label: 'Settings' },
];

export function CodeEditorShell({
  files,
  openTabs,
  activeTabId,
  onSelectFile,
  onSelectTab,
  onCloseTab,
  children,
  activeActivity = 'files',
  onActivityChange,
  statusBar,
  className,
}: CodeEditorShellProps) {
  return (
    <div className={cn('flex h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm', className)}>
      {/* Activity bar */}
      <nav
        className="w-12 shrink-0 bg-[#333] flex flex-col items-center py-2 border-r border-black/40"
        aria-label="Activity bar"
      >
        {ACTIVITY_ICONS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => onActivityChange?.(id)}
            title={label}
            aria-pressed={activeActivity === id}
            className={cn(
              'w-12 h-12 flex items-center justify-center border-l-2',
              activeActivity === id
                ? 'border-[#d4d4d4] text-[#d4d4d4]'
                : 'border-transparent text-[#858585] hover:text-[#d4d4d4]'
            )}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
          </button>
        ))}
      </nav>

      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-[#252526] border-r border-black/40 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-[#bbb]">
          {activeActivity === 'files' ? 'Explorer'
            : activeActivity === 'search' ? 'Search'
            : activeActivity === 'git' ? 'Source control'
            : activeActivity === 'debug' ? 'Run and debug'
            : 'Settings'}
        </div>
        {activeActivity === 'files' && (
          <ul className="text-xs">
            {files.map((node) => (
              <FileNode key={node.id} node={node} depth={0} onSelectFile={onSelectFile} />
            ))}
          </ul>
        )}
      </aside>

      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab strip */}
        <div className="flex bg-[#2d2d30] border-b border-black/40 overflow-x-auto">
          {openTabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  'group flex items-center gap-1.5 pl-3 pr-2 py-1.5 border-r border-black/40 text-xs cursor-pointer',
                  active
                    ? 'bg-[#1e1e1e] text-[#d4d4d4]'
                    : 'bg-[#2d2d30] text-[#858585] hover:text-[#d4d4d4]'
                )}
                onClick={() => onSelectTab?.(tab)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <span className="truncate max-w-[160px]">
                  {tab.modified && <span className="text-yellow-400">●</span>}
                  {tab.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onCloseTab?.(tab); }}
                  className="text-[#858585] hover:text-[#d4d4d4] opacity-0 group-hover:opacity-100"
                  aria-label={`Close ${tab.label}`}
                >
                  <CloseIcon className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
        {/* Editor body */}
        <div className="flex-1 overflow-auto bg-[#1e1e1e]">{children}</div>
      </div>

      {/* Status bar */}
      {statusBar && (
        <></>
      )}
      {/* Status bar bottom-of-page */}
      <div
        role="status"
        className="absolute inset-x-0 bottom-0 h-6 bg-[#007acc] text-white text-[11px] flex items-center px-2 gap-3"
      >
        {statusBar?.branch && (
          <span className="inline-flex items-center gap-1">
            <GitBranch className="w-3 h-3" /> {statusBar.branch}
          </span>
        )}
        {(statusBar?.errors !== undefined || statusBar?.warnings !== undefined) && (
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {statusBar.errors ?? 0}
            </span>
            <span className="inline-flex items-center gap-1">
              <Circle className="w-3 h-3" /> {statusBar.warnings ?? 0}
            </span>
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-3">
          {statusBar?.cursor && <span>{statusBar.cursor}</span>}
          {statusBar?.language && <span>{statusBar.language}</span>}
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Concord
          </span>
        </span>
      </div>
    </div>
  );
}

interface FileNodeProps {
  node: FileTreeNode;
  depth: number;
  onSelectFile?: (file: FileTreeNode) => void;
}

function FileNode({ node, depth, onSelectFile }: FileNodeProps) {
  const [open, setOpen] = React.useState(depth < 2);
  if (node.kind === 'folder') {
    return (
      <>
        <li>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 px-2 py-0.5 w-full text-left hover:bg-white/5"
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <ChevronRight className={cn('w-3 h-3 text-[#bbb] transition-transform', open && 'rotate-90')} />
            {open ? <FolderOpen className="w-3.5 h-3.5 text-[#dcb67a]" /> : <Folder className="w-3.5 h-3.5 text-[#dcb67a]" />}
            <span>{node.name}</span>
          </button>
        </li>
        {open && node.children?.map((c) => (
          <FileNode key={c.id} node={c} depth={depth + 1} onSelectFile={onSelectFile} />
        ))}
      </>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectFile?.(node)}
        className="flex items-center gap-1 px-2 py-0.5 w-full text-left hover:bg-white/5"
        style={{ paddingLeft: 8 + depth * 12 + 12 }}
      >
        <FileText className="w-3.5 h-3.5 text-[#858585]" />
        <span className={cn(node.modified && 'text-yellow-300')}>{node.name}</span>
      </button>
    </li>
  );
}

export default CodeEditorShell;
