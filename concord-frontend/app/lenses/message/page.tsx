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
import { Inbox, Wrench, Tags, Plug } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { InboxPanel } from '@/components/message/InboxPanel';
import { WorkbenchPanel } from '@/components/message/WorkbenchPanel';
import { LabelManagerPanel } from '@/components/message/LabelManagerPanel';
import { ConnectPanel } from '@/components/message/ConnectPanel';

type MessageView = 'inbox' | 'workbench' | 'labels' | 'connect';

const VIEWS: { id: MessageView; label: string; keys: string; hint: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'Inbox', keys: '1', hint: 'Direct messages', icon: Inbox },
  { id: 'workbench', label: 'Workbench', keys: '2', hint: 'Saved · search · voice', icon: Wrench },
  { id: 'labels', label: 'Labels', keys: '3', hint: 'Label manager', icon: Tags },
  { id: 'connect', label: 'Connect', keys: '4', hint: 'Gmail · Slack · repos', icon: Plug },
];

const PANELS: Record<MessageView, ComponentType> = {
  inbox: InboxPanel,
  workbench: WorkbenchPanel,
  labels: LabelManagerPanel,
  connect: ConnectPanel,
};

export default function MessageLensPage() {
  useLensNav('message');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<MessageView>('inbox');

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
      <div className="px-4 pt-3 space-y-3">
        <header className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-neon-blue" />
          <div>
            <h1 className="text-lg font-semibold tracking-wide text-white">Message</h1>
            <p className="text-xs text-gray-400">Direct messages · Gmail · Slack — one messaging desk.</p>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Message views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-neon-blue text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="message" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
