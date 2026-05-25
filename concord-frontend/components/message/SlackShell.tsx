'use client';

/**
 * SlackShell — Slack-style 3-pane chrome: workspaces rail + channel/DM
 * list + main message stream with optional thread side-pane.
 */

import React from 'react';
import { Hash, Lock, MessageSquare, Bell, Inbox, Calendar, Bookmark, Search, Radio, Paperclip, Bot, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusControl } from './StatusControl';

export type MsgNav =
  | 'channels' | 'inbox' | 'activity' | 'scheduled' | 'snoozed' | 'saved' | 'search'
  | 'huddles' | 'files' | 'integrations' | 'notifications' | 'directory';

interface NavItem { id: MsgNav; label: string; icon: typeof Hash; badge?: number | string }

export interface SlackShellProps {
  activeNav: MsgNav;
  onNavChange: (n: MsgNav) => void;
  badges?: Partial<Record<MsgNav, number | string>>;
  channelList: React.ReactNode;
  main: React.ReactNode;
  thread?: React.ReactNode;
  askBar?: React.ReactNode;
}

const NAV: NavItem[] = [
  { id: 'channels',     label: 'Channels & DMs', icon: MessageSquare },
  { id: 'inbox',        label: 'Inbox',          icon: Inbox },
  { id: 'activity',     label: 'Activity',       icon: Bell },
  { id: 'huddles',      label: 'Huddles',        icon: Radio },
  { id: 'files',        label: 'Files',          icon: Paperclip },
  { id: 'integrations', label: 'Integrations',   icon: Bot },
  { id: 'scheduled',    label: 'Scheduled',      icon: Calendar },
  { id: 'snoozed',      label: 'Snoozed',        icon: Bookmark },
  { id: 'saved',        label: 'Saved',          icon: Bookmark },
  { id: 'directory',    label: 'Directory',      icon: Users },
  { id: 'notifications',label: 'Notifications',  icon: Bell },
  { id: 'search',       label: 'Search',         icon: Search },
];

export function SlackShell({ activeNav, onNavChange, badges = {}, channelList, main, thread, askBar }: SlackShellProps) {
  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-violet-500/15 rounded-lg overflow-hidden">
      {/* Activity bar */}
      <nav className="w-14 bg-[#0a0c10] border-r border-white/5 flex flex-col items-center py-2 flex-shrink-0">
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
                'relative w-12 h-12 m-1 rounded flex items-center justify-center transition-colors',
                active ? 'bg-violet-500/15 text-violet-200' : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              <Icon className="w-5 h-5" />
              {badge !== undefined && badge !== 0 && (
                <span className="absolute top-0 right-0 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[8px] font-mono">{badge}</span>
              )}
            </button>
          );
        })}
        <StatusControl />
      </nav>

      {/* Channel list */}
      <aside className="w-64 bg-[#0a0c10] border-r border-white/5 overflow-hidden flex flex-col flex-shrink-0">
        {channelList}
      </aside>

      {/* Main pane (+optional thread side) */}
      <main className="flex-1 flex overflow-hidden">
        <div className={cn('flex-1 flex flex-col overflow-hidden', thread && 'border-r border-white/10')}>
          {askBar && (
            <header className="px-4 py-2 border-b border-white/5 bg-[#0a0c10]/60">
              {askBar}
            </header>
          )}
          {main}
        </div>
        {thread && (
          <aside className="w-96 bg-[#0a0c10] overflow-hidden flex flex-col flex-shrink-0">
            {thread}
          </aside>
        )}
      </main>
    </div>
  );
}

export function ChannelIcon({ kind, isPrivate, className }: { kind: string; isPrivate?: boolean; className?: string }) {
  if (kind === 'dm' || kind === 'group_dm') return <MessageSquare className={className} />;
  if (isPrivate) return <Lock className={className} />;
  return <Hash className={className} />;
}

export default SlackShell;
