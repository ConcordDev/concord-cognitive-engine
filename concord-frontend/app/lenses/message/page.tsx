'use client';

/**
 * Message — one Gmail/Slack messaging desk.
 *
 * Single view union (inbox | workbench | labels | connect). Inline DM
 * compose/thread, floating workbench modal, and stacked Gmail/Slack/Repos
 * surfaces extracted to panels. Page is a thin shell (paper/government gold).
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Inbox, Wrench, Tags, Plug, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { InboxPanel } from '@/components/message/InboxPanel';
import { WorkbenchPanel } from '@/components/message/WorkbenchPanel';
import { LabelManagerPanel } from '@/components/message/LabelManagerPanel';
import { ConnectPanel } from '@/components/message/ConnectPanel';

type MessageView = 'inbox' | 'workbench' | 'labels' | 'connect';

const VIEWS: { id: MessageView; label: string; keys: string; title: string; hint: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'Inbox', keys: '1', title: 'Who wrote', hint: 'Direct messages', icon: Inbox },
  { id: 'workbench', label: 'Workbench', keys: '2', title: 'What you have kept', hint: 'Saved · search · voice', icon: Wrench },
  { id: 'labels', label: 'Labels', keys: '3', title: 'How it is sorted', hint: 'Label manager', icon: Tags },
  { id: 'connect', label: 'Connect', keys: '4', title: 'Where mail comes from', hint: 'Gmail · Slack · repos', icon: Plug },
];

const PANELS: Record<MessageView, ComponentType> = {
  inbox: InboxPanel,
  workbench: WorkbenchPanel,
  labels: LabelManagerPanel,
  connect: ConnectPanel,
};

export default function MessageLensPage() {
  useLensNav('message');
  useLensIdentity('message');
  const { isLive, lastUpdated } = useRealtimeLens('message');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<MessageView>('inbox');

  const compose = () => {
    setActive('inbox');
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('message:compose')));
  };

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'message' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

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
    <LensShell lensId="message" asMain={false}>
      <FirstRunTour lensId="message" />
      <DepthBadge lensId="message" size="sm" className="ml-2" />
      <div data-lens-theme="message" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Messages</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'inbox' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="message" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Message views">
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

        <CrossLensRecentsPanel lensId="message" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        <button
          type="button"
          onClick={compose}
          title="New message"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New message
        </button>
      </div>
    </LensShell>
  );
}
