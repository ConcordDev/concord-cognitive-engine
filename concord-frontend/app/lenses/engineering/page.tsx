'use client';

/**
 * Engineering — one FEA / multi-discipline calc desk.
 *
 * Reference: SAP2000 / Ansys Workbench density (tabbed model→solve→results).
 * Accordion booleans for HN feed / More Actions are folded into the single
 * `active` union. Shared FEA session lives in EngineeringFeaProvider; each
 * view is a panel under components/engineering/.
 */

import { useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Wrench,
  Zap,
  Loader2,
  CheckCircle,
  XCircle,
  Box,
  Atom,
  Weight,
  FlaskConical,
  BarChart3,
  ClipboardList,
  Ruler,
  Calculator,
  Activity,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  EngineeringFeaProvider,
  useEngineeringFea,
} from '@/components/engineering/EngineeringFeaProvider';
import { EngineeringPane } from '@/components/engineering/EngineeringPane';
import type { EngView } from '@/components/engineering/types';

const VIEWS: { id: EngView; label: string; keys: string; icon: typeof Wrench }[] = [
  { id: 'geometry', label: 'Geometry', keys: '1', icon: Box },
  { id: 'model', label: 'Model', keys: '2', icon: Atom },
  { id: 'loads', label: 'Loads', keys: '3', icon: Weight },
  { id: 'materials', label: 'Materials', keys: '4', icon: FlaskConical },
  { id: 'analysis', label: 'Analysis', keys: 'a', icon: BarChart3 },
  { id: 'bom', label: 'BOM', keys: 'b', icon: ClipboardList },
  { id: 'tolerance', label: 'Tolerance', keys: 't', icon: Ruler },
  { id: 'calcs', label: 'Calcs', keys: 'c', icon: Calculator },
  { id: 'results', label: 'Results', keys: 'r', icon: Activity },
  { id: 'feed', label: 'Feed', keys: 'f', icon: MessageSquare },
  { id: 'actions', label: 'Actions', keys: 'x', icon: Sparkles },
];

function EngineeringDesk() {
  const reduceMotion = useReducedMotion();
  const { active, setActive, runFEA, running, status, summary } = useEngineeringFea();

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'engineering' },
  );

  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  return (
    <div data-lens-theme="engineering" className={cn(ds.pageContainer, 'space-y-4 max-w-6xl')}>
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
            <Wrench className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
          </div>
          <div className="min-w-0">
            <h1 className={ds.heading1}>Engineering</h1>
            <p className={ds.textMuted}>FEA · Structural · Thermal · Electrical · Hydraulic</p>
          </div>
        </div>
        <button
          onClick={runFEA}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 bg-neon-cyan text-black rounded-lg font-semibold text-sm hover:bg-neon-cyan/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Run FEA
        </button>
      </header>

      {status && (
        <div
          className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${
            status.includes('Error') || status.includes('failed')
              ? 'bg-red-500/10 border border-red-500/30 text-red-400'
              : status.includes('complete')
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan'
          }`}
        >
          {status.includes('complete') ? (
            <CheckCircle className="w-4 h-4" />
          ) : status.includes('Error') || status.includes('failed') ? (
            <XCircle className="w-4 h-4" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin" />
          )}
          {status}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="panel p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Max Displacement</p>
            <p className="text-lg font-mono font-bold text-neon-cyan">
              {summary.maxDisplacement.toFixed(4)}&quot;
            </p>
          </div>
          <div className="panel p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Max Utilization</p>
            <p
              className={`text-lg font-mono font-bold ${summary.maxUtilization > 1 ? 'text-red-400' : 'text-green-400'}`}
            >
              {(summary.maxUtilization * 100).toFixed(1)}%
            </p>
          </div>
          <div className="panel p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">All Members</p>
            <p className={`text-lg font-bold ${summary.allPass ? 'text-green-400' : 'text-red-400'}`}>
              {summary.allPass ? 'PASS ✓' : 'FAIL ✗'}
            </p>
          </div>
        </div>
      )}

      <nav
        className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
        aria-label="Engineering views"
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
                  ? 'border-[var(--lens-accent)] text-white'
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
          <EngineeringPane active={active} />
        </motion.div>
      </AnimatePresence>

      <CrossLensRecentsPanel lensId="engineering" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </div>
  );
}

export default function EngineeringPage() {
  useLensNav('engineering');
  useLensIdentity('engineering');

  return (
    <LensShell lensId="engineering" asMain={false}>
      <FirstRunTour lensId="engineering" />
      <DepthBadge lensId="engineering" size="sm" className="ml-2" />
      <EngineeringFeaProvider>
        <EngineeringDesk />
      </EngineeringFeaProvider>
    </LensShell>
  );
}
