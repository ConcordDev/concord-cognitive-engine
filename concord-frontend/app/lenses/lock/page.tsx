'use client';

/**
 * Lock — one sovereignty + concurrency-profiler app.
 *
 * Single view union (sovereignty | profiler | security). Profiler and
 * SecurityRepos accordion folded into active. Page is a thin shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Lock, Activity, ShieldAlert } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { SovereigntyPanel } from '@/components/lock/SovereigntyPanel';
import { LockProfiler } from '@/components/lock/LockProfiler';
import { SecurityRepos } from '@/components/lock/SecurityRepos';

type LockView = 'sovereignty' | 'profiler' | 'security';

const VIEWS: { id: LockView; label: string; keys: string; hint: string; icon: typeof Lock }[] = [
  { id: 'sovereignty', label: 'Sovereignty', keys: '1', hint: '70% lock + invariants', icon: Lock },
  { id: 'profiler', label: 'Profiler', keys: '2', hint: 'Concurrency lock traces', icon: Activity },
  { id: 'security', label: 'Security', keys: '3', hint: 'External tooling reference', icon: ShieldAlert },
];

export default function LockLensPage() {
  useLensNav('lock');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('lock');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<LockView>('sovereignty');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'open-setup', keys: 's', description: 'Open sovereignty setup', category: 'actions' as const, action: () => setActive('sovereignty') },
    ],
    { lensId: 'lock' },
  );

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

  let body: ReactNode = null;
  if (active === 'sovereignty') body = <SovereigntyPanel />;
  else if (active === 'profiler') body = <LockProfiler />;
  else body = <SecurityRepos />;

  return (
    <LensShell lensId="lock" asMain={false}>
      <FirstRunTour lensId="lock" />
      <DepthBadge lensId="lock" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="lock"
        crumb="Lock"
        title={`Your sovereignty lock${active === 'sovereignty' && who ? `, ${who}` : ''}`}
        subtitle="70% sovereignty lock and a JFR-style concurrency profiler"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="lock" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as LockView)}
        tabsLabel="Lock views"
        cta={{ label: 'Open setup', icon: Lock, onClick: () => setActive('sovereignty'), title: 'Open the sovereignty setup' }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps} className="pt-4">
            {body}
          </motion.div>
        </AnimatePresence>
      </NorthStarFrame>
    </LensShell>
  );
}
