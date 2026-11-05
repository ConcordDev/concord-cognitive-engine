'use client';

/**
 * Physics lens — one PhET / lab-notebook app.
 *
 * Single view union (lab | sandbox | solvers | notebook). The client Verlet
 * playground, server scene editor, equation solvers, and arXiv shelf are
 * separate screens — not stacked on one page.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Atom, FlaskConical, Calculator, BookOpen } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { lensRun } from '@/lib/api/client';

/**
 * The ↓.dtu export's payload, loaded at click time: the user's own
 * saved scenes (full scene data, capped). The button previously
 * received the realtime feed payload, whose size the export request
 * rejected with a raw HTTP 413. Returns {} when the user has no saved
 * scenes, so the refusal stays honest.
 */
async function preparePhysicsExport(): Promise<unknown> {
  try {
    const list = await lensRun<{ scenes: { id: string }[] }>('physics', 'scene-list', {});
    const summaries = list.data?.result?.scenes || [];
    if (summaries.length === 0) return {};
    const scenes: unknown[] = [];
    for (const s of summaries.slice(0, 20)) {
      const g = await lensRun<{ scene: unknown }>('physics', 'scene-get', { id: s.id });
      if (g.data?.ok && g.data.result?.scene) scenes.push(g.data.result.scene);
    }
    return scenes.length > 0
      ? { source: 'physics-lens-export', exportedAt: new Date().toISOString(), scenes }
      : {};
  } catch {
    return {};
  }
}
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import { PhysicsLabPanel } from '@/components/physics/PhysicsLabPanel';
import { PhysicsSandboxPanel } from '@/components/physics/PhysicsSandboxPanel';
import { PhysicsSolversPanel } from '@/components/physics/PhysicsSolversPanel';
import { PhysicsNotebookPanel } from '@/components/physics/PhysicsNotebookPanel';

type PhysicsView = 'lab' | 'sandbox' | 'solvers' | 'notebook';

const VIEWS: { id: PhysicsView; label: string; keys: string; hint: string; icon: typeof Atom }[] = [
  { id: 'lab', label: 'Lab', keys: '1', hint: 'PhET scene editor', icon: FlaskConical },
  { id: 'sandbox', label: 'Sandbox', keys: '2', hint: 'Verlet playground', icon: Atom },
  { id: 'solvers', label: 'Solvers', keys: '3', hint: 'Kinematics · orbits · waves', icon: Calculator },
  { id: 'notebook', label: 'Notebook', keys: '4', hint: 'arXiv physics', icon: BookOpen },
];

const PANELS: Record<PhysicsView, ComponentType> = {
  lab: PhysicsLabPanel,
  sandbox: PhysicsSandboxPanel,
  solvers: PhysicsSolversPanel,
  notebook: PhysicsNotebookPanel,
};

export default function PhysicsLensPage() {
  useLensNav('physics');
  useLensIdentity('physics');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('physics');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<PhysicsView>('lab');
  // Views stay mounted once visited (the sandbox excepted — see the
  // render), so switching views cannot silently discard an in-flight
  // solve, a panel's results, or the Lab's unsaved scene (F10).
  const [visited, setVisited] = useState<ReadonlySet<PhysicsView>>(new Set(['lab']));
  const go = (v: PhysicsView) => {
    setActive(v);
    setVisited((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
  };

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => go(v.id),
    })),
    { lensId: 'physics' },
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

  return (
    <LensShell lensId="physics" asMain={false}>

      <DepthBadge lensId="physics" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="physics"
        crumb="Physics"
        subtitle="Scene lab, Verlet sandbox, equation solvers and a live arXiv notebook, with real engines."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="physics" data={{}} compact prepare={preparePhysicsExport} />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => go(id as PhysicsView)}
        tabsLabel="Physics views"
        cta={{ label: 'Open the lab', icon: FlaskConical, onClick: () => go('lab'), title: 'Open the scene lab (1)' }}
      >
        {VIEWS.filter((v) => v.id !== 'sandbox' && visited.has(v.id)).map((v) => {
          const P = PANELS[v.id];
          const isActive = v.id === active;
          return (
            <motion.div key={v.id} {...(isActive ? motionProps : { initial: false as const })} className={isActive ? '' : 'hidden'}>
              <P />
            </motion.div>
          );
        })}
        {active === 'sandbox' && (
          <motion.div key="sandbox" {...motionProps}>
            <PhysicsSandboxPanel />
          </motion.div>
        )}

        <LiveFeed
          articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
          domain="research"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={8}
        />
        {realtimeData && (
          <RealtimeDataPanel
            domain="physics"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
