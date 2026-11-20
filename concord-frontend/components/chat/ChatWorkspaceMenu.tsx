'use client';

/**
 * Chat header Workspace overflow menu — secondary tools behind one button.
 * Extracted from app/lenses/chat/page.tsx (lens consolidation playbook).
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  BookOpen,
  Clock,
  Eye,
  FolderOpen,
  LayoutGrid,
  ChevronDown,
  PauseCircle,
  PlayCircle,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function ChatWorkspaceMenu({
  open,
  onOpenChange,
  initiativesPaused,
  systemsPanelOpen,
  toolsPanelOpen,
  activeProject,
  studioOpen,
  onViewContext,
  onToolPalette,
  onSearchChats,
  onProjects,
  onPrompts,
  onSchedule,
  onStudio,
  onToggleAnalysis,
  onToggleSystems,
  onToggleInitiativesPaused,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initiativesPaused: boolean;
  systemsPanelOpen: boolean;
  toolsPanelOpen: boolean;
  activeProject: { name: string } | null;
  studioOpen: boolean;
  onViewContext: () => void;
  onToolPalette: () => void;
  onSearchChats: () => void;
  onProjects: () => void;
  onPrompts: () => void;
  onSchedule: () => void;
  onStudio: () => void;
  onToggleAnalysis: () => void;
  onToggleSystems: () => void;
  onToggleInitiativesPaused: () => void;
}) {
  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] border rounded-lg text-xs transition-colors',
          open
            ? 'border-[color:var(--nb-blue,rgba(0,255,247,0.5))] text-[color:var(--nb-blue,#00fff7)]'
            : 'border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] text-[color:var(--nb-ink-2,#d1d5db)] hover:text-[color:var(--nb-ink,#ffffff)] hover:border-[color:var(--nb-rule-2,#6b7280)]',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Workspace — context, tools, systems, projects, prompts, schedule, studio, search"
      >
        <LayoutGrid className="w-4 h-4" />
        <span className="font-medium">Workspace</span>
        {(initiativesPaused || systemsPanelOpen || toolsPanelOpen || activeProject || studioOpen) && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--nb-blue,#00fff7)]" aria-hidden="true" />
        )}
        <ChevronDown className="w-3.5 h-3.5 text-[color:var(--nb-muted,#9ca3af)]" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => onOpenChange(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              role="menu"
              className="absolute top-full right-0 mt-2 w-60 bg-[var(--nb-sheet,rgb(var(--lattice-surface-rgb)))] border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] rounded-lg shadow-xl z-50 overflow-hidden py-1"
            >
              {[
                { key: 'context', icon: Eye, label: 'View context', hint: 'working set', onClick: onViewContext },
                { key: 'tools', icon: Sparkles, label: 'Tool palette', hint: '⌘.', onClick: onToolPalette },
                { key: 'search', icon: Search, label: 'Search chats', hint: '⌘K', onClick: onSearchChats },
                { key: 'projects', icon: FolderOpen, label: 'Projects', active: !!activeProject, dot: 'bg-[var(--nb-blue,#22d3ee)]', onClick: onProjects },
                { key: 'prompts', icon: BookOpen, label: 'Prompt library', onClick: onPrompts },
                { key: 'schedule', icon: Clock, label: 'Scheduled tasks', onClick: onSchedule },
                { key: 'studio', icon: Sparkles, label: 'Studio', active: studioOpen, dot: 'bg-[var(--nb-red,#a78bfa)]', onClick: onStudio },
                { key: 'analysis', icon: Zap, label: 'Analysis & features', active: toolsPanelOpen, dot: 'bg-[var(--nb-ochre,#facc15)]', onClick: onToggleAnalysis },
                { key: 'systems', icon: Activity, label: 'Systems', active: systemsPanelOpen, dot: 'bg-[var(--nb-red,#a855f7)]', onClick: onToggleSystems },
                {
                  key: 'pause',
                  icon: initiativesPaused ? PlayCircle : PauseCircle,
                  label: initiativesPaused ? 'Resume Concord' : 'Pause Concord',
                  active: initiativesPaused,
                  dot: 'bg-[var(--nb-ochre,#fbbf24)]',
                  onClick: onToggleInitiativesPaused,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      item.onClick();
                      onOpenChange(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[color:var(--nb-ink,#e5e7eb)] hover:bg-[var(--nb-paper,rgb(var(--lattice-bg-rgb)))] transition-colors"
                  >
                    <Icon className={cn('w-4 h-4 flex-shrink-0', item.active ? 'text-[color:var(--nb-ink,#ffffff)]' : 'text-[color:var(--nb-muted,#9ca3af)]')} />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.active && item.dot && (
                      <span className={cn('w-1.5 h-1.5 rounded-full', item.dot)} aria-hidden="true" />
                    )}
                    {item.hint && <kbd className="text-[10px] text-[color:var(--nb-muted,#6b7280)]">{item.hint}</kbd>}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
