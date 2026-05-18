'use client';

import { Files, Search, GitBranch, Bug, Settings, Boxes, Sparkles, Terminal as TerminalIcon, Database as DbIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Activity = 'files' | 'search' | 'sourceControl' | 'snippets' | 'debug' | 'extensions' | 'settings' | 'terminal' | 'agent' | 'repoIndex';

interface ActivityBarProps {
  active: Activity;
  onChange: (a: Activity) => void;
  badges?: Partial<Record<Activity, number>>;
}

const ITEMS: Array<{ id: Activity; icon: typeof Files; label: string; hotkey?: string }> = [
  { id: 'files',         icon: Files,         label: 'Explorer',       hotkey: '⌘B' },
  { id: 'search',        icon: Search,        label: 'Search',         hotkey: '⌘⇧F' },
  { id: 'sourceControl', icon: GitBranch,     label: 'Source control', hotkey: '⌃⇧G' },
  { id: 'debug',         icon: Bug,           label: 'Run & debug',    hotkey: '⌃⇧D' },
  { id: 'extensions',    icon: Boxes,         label: 'Extensions',     hotkey: '⌘⇧X' },
  { id: 'snippets',      icon: Sparkles,      label: 'Snippets' },
  { id: 'repoIndex',     icon: DbIcon,        label: 'Repo index',     hotkey: '⌘⇧I' },
  { id: 'terminal',      icon: TerminalIcon,  label: 'Terminal',       hotkey: '⌃`' },
  { id: 'agent',         icon: Sparkles,      label: 'AI agent' },
];

export function ActivityBar({ active, onChange, badges }: ActivityBarProps) {
  return (
    <nav
      aria-label="Activity bar"
      className="w-12 shrink-0 bg-[#181818] border-r border-black/50 flex flex-col items-center py-1 gap-0.5 select-none"
    >
      {ITEMS.map(({ id, icon: Icon, label, hotkey }) => {
        const isActive = active === id;
        const badge = badges?.[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={`${label}${hotkey ? ` (${hotkey})` : ''}`}
            aria-pressed={isActive}
            aria-label={label}
            className={cn(
              'relative w-12 h-11 flex items-center justify-center border-l-2 transition-colors',
              isActive
                ? 'border-cyan-400 text-cyan-300 bg-white/[0.04]'
                : 'border-transparent text-[#9ca3af] hover:text-white'
            )}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
            {badge !== undefined && badge > 0 && (
              <span
                className="absolute top-1 right-1 text-[9px] min-w-[14px] h-[14px] px-1 rounded-full bg-cyan-500 text-black font-bold flex items-center justify-center"
                aria-label={`${badge} items`}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto pb-2">
        <button
          type="button"
          onClick={() => onChange('settings')}
          title="Settings (⌘,)"
          aria-label="Settings"
          aria-pressed={active === 'settings'}
          className={cn(
            'w-12 h-11 flex items-center justify-center border-l-2 transition-colors',
            active === 'settings'
              ? 'border-cyan-400 text-cyan-300 bg-white/[0.04]'
              : 'border-transparent text-[#9ca3af] hover:text-white'
          )}
        >
          <Settings className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export default ActivityBar;
