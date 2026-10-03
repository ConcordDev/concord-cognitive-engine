'use client';

/**
 * Forum — one Reddit/Discourse community app.
 *
 * Single view union (discourse | board | chatter | actions). Former welded
 * pile (ForumSection always-on + inline Reddit board + desk overlays) is
 * folded into panels under components/forum/. Macros preserved.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MessagesSquare, Flame, MessageCircle, Shield, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { DiscoursePanel } from '@/components/forum/DiscoursePanel';
import { BoardPanel } from '@/components/forum/BoardPanel';
import { ChatterPanel } from '@/components/forum/ChatterPanel';
import { ModToolsPanel } from '@/components/forum/ModToolsPanel';
import { requestForumCompose } from '@/components/forum/FmTopicsPanel';

type ForumView = 'discourse' | 'board' | 'chatter' | 'actions';

const VIEWS: { id: ForumView; label: string; keys: string; title: string; hint: string; icon: typeof Flame }[] = [
  { id: 'discourse', label: 'Discourse', keys: '1', title: 'What the community is saying', hint: 'Topics · communities · inbox', icon: MessagesSquare },
  { id: 'board', label: 'Board', keys: '2', title: 'What is rising', hint: 'Hot · new · top · rising', icon: Flame },
  { id: 'chatter', label: 'Chatter', keys: '3', title: 'Talk it through live', hint: 'Live discussion', icon: MessageCircle },
  { id: 'actions', label: 'Mod tools', keys: '4', title: 'Keep the room healthy', hint: 'Analytics · queue', icon: Shield },
];

const PANELS: Record<ForumView, ComponentType> = {
  discourse: DiscoursePanel,
  board: BoardPanel,
  chatter: ChatterPanel,
  actions: ModToolsPanel,
};

export default function ForumLensPage() {
  useLensNav('forum');
  useLensIdentity('forum');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('forum');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<ForumView>('discourse');

  const newTopic = () => {
    setActive('discourse');
    requestForumCompose();
  };

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'forum-new-topic', keys: 'n', description: 'Start a discussion', category: 'actions' as const, action: newTopic },
    ],
    { lensId: 'forum' },
  );

  const view = VIEWS.find((v) => v.id === active)!;
  const Panel = PANELS[active];
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="forum" asMain={false}>
      <FirstRunTour lensId="forum" />
      <DepthBadge lensId="forum" size="sm" className="ml-2" />
      <div data-lens-theme="forum" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Forum</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {view.title}{active === 'discourse' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[12px] text-amber-300">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="forum" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Forum views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        <section className="mt-6">
          <SessionRail lensId="forum" hideWhenEmpty />
        </section>
        <CrossLensRecentsPanel lensId="forum" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        <button
          type="button"
          onClick={newTopic}
          title="Start a discussion (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New topic
        </button>
      </div>
    </LensShell>
  );
}
