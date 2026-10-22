'use client';

/**
 * Engineering — one FEA / multi-discipline calc desk.
 *
 * Reference: SAP2000 / Ansys Workbench density (tabbed model→solve→results).
 * Accordion booleans for HN feed / More Actions are folded into the single
 * `active` union. Shared FEA session lives in EngineeringFeaProvider; each
 * view is a panel under components/engineering/.
 */

import {
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
  Flame,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import {
  EngineeringFeaProvider,
  useEngineeringFea,
} from '@/components/engineering/EngineeringFeaProvider';
import { EngineeringPane } from '@/components/engineering/EngineeringPane';
import type { EngView } from '@/components/engineering/types';

const VIEWS: { id: EngView; label: string; keys: string; icon: typeof Box }[] = [
  { id: 'geometry', label: 'Geometry', keys: '1', icon: Box },
  { id: 'model', label: 'Model', keys: '2', icon: Atom },
  { id: 'loads', label: 'Loads', keys: '3', icon: Weight },
  { id: 'materials', label: 'Materials', keys: '4', icon: FlaskConical },
  { id: 'analysis', label: 'Analysis', keys: 'a', icon: BarChart3 },
  { id: 'bom', label: 'BOM', keys: 'b', icon: ClipboardList },
  { id: 'tolerance', label: 'Tolerance', keys: 't', icon: Ruler },
  { id: 'calcs', label: 'Calcs', keys: 'c', icon: Calculator },
  { id: 'physics', label: 'Multi-physics', keys: 'p', icon: Flame },
  { id: 'results', label: 'Results', keys: 'r', icon: Activity },
  { id: 'feed', label: 'Feed', keys: 'f', icon: MessageSquare },
  { id: 'actions', label: 'Actions', keys: 'x', icon: Sparkles },
];

function EngineeringDesk() {
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


  return (
    <NorthStarFrame
      lensId="engineering"
      crumb="Engineering"
      subtitle="FEA, structural, thermal, electrical and hydraulic."
      tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys }))}
      activeTab={active}
      onTab={(id) => setActive(id as EngView)}
      tabsLabel="Engineering views"
      cta={{
        label: running ? 'Solving…' : 'Run FEA',
        icon: running ? Loader2 : Zap,
        onClick: runFEA,
        disabled: running,
        title: 'Run the finite-element solve',
      }}
    >
      <div className="space-y-4">
        {status && (
          <div
            className={`flex items-center gap-2 rounded-2xl px-4 py-2 text-sm ${
              status.includes('Error') || status.includes('failed')
                ? 'border border-red-500/30 bg-red-500/10 text-red-400'
                : status.includes('complete')
                  ? 'border border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan'
            }`}
          >
            {status.includes('complete') ? (
              <CheckCircle className="h-4 w-4" />
            ) : status.includes('Error') || status.includes('failed') ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {status}
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-center">
              <p className="mb-1 text-xs text-gray-400">Max Displacement</p>
              <p className="font-mono text-lg font-bold text-neon-cyan">{summary.maxDisplacement.toFixed(4)}&quot;</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-center">
              <p className="mb-1 text-xs text-gray-400">Max Utilization</p>
              <p className={`font-mono text-lg font-bold ${summary.maxUtilization > 1 ? 'text-red-400' : 'text-green-400'}`}>
                {(summary.maxUtilization * 100).toFixed(1)}%
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-center">
              <p className="mb-1 text-xs text-gray-400">All Members</p>
              <p className={`text-lg font-bold ${summary.allPass ? 'text-green-400' : 'text-red-400'}`}>
                {summary.allPass ? 'PASS ✓' : 'FAIL ✗'}
              </p>
            </div>
          </div>
        )}

        <EngineeringPane active={active} />
      </div>
    </NorthStarFrame>
  );
}

export default function EngineeringPage() {
  useLensNav('engineering');
  useLensIdentity('engineering');

  return (
    <LensShell lensId="engineering" asMain={false}>

      <DepthBadge lensId="engineering" size="sm" className="ml-2" />
      <EngineeringFeaProvider>
        <EngineeringDesk />
      </EngineeringFeaProvider>
    </LensShell>
  );
}
