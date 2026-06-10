'use client';

/**
 * CodeWorkbenchShell — VS Code-style workbench chrome.
 *
 * Layout matches the editor everyone knows:
 *   - top-left: activity bar (vertical) + side panel (file tree / search / git / agent)
 *   - center:   tabbed editor area
 *   - bottom:   terminal / problems
 */

import React from 'react';
import { Files, GitBranch, Sparkles, Search, Settings, Bug, Terminal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CodeNav = 'files' | 'search' | 'git' | 'agent' | 'debug' | 'settings';

interface NavItem { id: CodeNav; label: string; icon: typeof Files; badge?: number | string }

export interface CodeWorkbenchShellProps {
  activeNav: CodeNav;
  onNavChange: (n: CodeNav) => void;
  badges?: Partial<Record<CodeNav, number | string>>;
  sidePanel: React.ReactNode;
  editor: React.ReactNode;
  bottomPanel?: React.ReactNode;
  showBottom?: boolean;
  onToggleBottom?: () => void;
  branch?: string;
  statusRight?: React.ReactNode;
}

const NAV: NavItem[] = [
  { id: 'files', label: 'Explorer', icon: Files },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'git', label: 'Source Control', icon: GitBranch },
  { id: 'agent', label: 'Agent', icon: Sparkles },
  { id: 'debug', label: 'Run & Debug', icon: Bug },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function CodeWorkbenchShell({
  activeNav, onNavChange, badges = {},
  sidePanel, editor, bottomPanel, showBottom, onToggleBottom,
  branch, statusRight,
}: CodeWorkbenchShellProps) {
  return (
    <div className="flex flex-col h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      {/* Main area: activity bar + side panel + editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity bar */}
        <nav className="w-12 bg-[#0a0c10] border-r border-white/5 flex flex-col items-center py-2 flex-shrink-0">
          {NAV.map(n => {
            const Icon = n.icon;
            const active = activeNav === n.id;
            const badge = badges[n.id];
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => onNavChange(n.id)}
                title={n.label}
                className={cn(
                  'relative w-12 h-12 flex items-center justify-center transition-colors',
                  active ? 'text-white border-l-2 border-blue-400 bg-white/[0.04]' : 'text-gray-400 hover:text-white border-l-2 border-transparent',
                )}
              >
                <Icon className="w-5 h-5" />
                {badge !== undefined && badge !== 0 && (
                  <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[8px] font-mono">{badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Side panel */}
        <aside className="w-64 bg-[#0a0c10] border-r border-white/5 overflow-hidden flex flex-col flex-shrink-0">
          {sidePanel}
        </aside>

        {/* Editor area */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {editor}
        </main>
      </div>

      {/* Bottom panel */}
      {showBottom && bottomPanel && (
        <div className="h-56 border-t border-white/10 bg-[#0a0c10] overflow-hidden flex flex-col">
          {bottomPanel}
        </div>
      )}

      {/* Status bar */}
      <footer className="h-6 bg-blue-600 text-white text-[10px] flex items-center px-2 gap-2 flex-shrink-0">
        {branch && (
          <span className="inline-flex items-center gap-1"><GitBranch className="w-3 h-3" />{branch}</span>
        )}
        {onToggleBottom && (
          <button onClick={onToggleBottom} className="inline-flex items-center gap-1 hover:opacity-80">
            <Terminal className="w-3 h-3" />
            {showBottom ? 'Hide terminal' : 'Show terminal'}
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">{statusRight}</div>
      </footer>
    </div>
  );
}

export interface EditorTabsProps {
  tabs: Array<{ path: string; modified: boolean }>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function EditorTabs({ tabs, activePath, onSelect, onClose }: EditorTabsProps) {
  return (
    <div className="flex items-center border-b border-white/10 bg-[#0a0c10] overflow-x-auto flex-shrink-0">
      {tabs.length === 0 ? (
        <div className="px-3 py-2 text-xs text-gray-400">No file open</div>
      ) : tabs.map(t => {
        const active = activePath === t.path;
        return (
          <div
            key={t.path}
            onClick={() => onSelect(t.path)}
            className={cn(
              'group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-xs border-r border-white/5 max-w-[200px]',
              active ? 'bg-[#0d1117] text-white border-t-2 border-t-blue-400' : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
            )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <span className="truncate">{t.path.split('/').pop()}</span>
            {t.modified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            <button aria-label="Close tab"
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(t.path); }}
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-300 ml-auto"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default CodeWorkbenchShell;
