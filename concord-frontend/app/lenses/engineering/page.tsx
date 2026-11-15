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
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { lensRun } from '@/lib/api/client';
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
  const { active, setActive, runFEA, running, status, summary, model, feaResult } = useEngineeringFea();

  // The lens's working export: the header Export menu is chrome whose
  // exporter is an empty stub, so the desk carries its own ↓.dtu whose
  // file is built from the member's actual records at click time.
  const prepareExport = async () => {
    const run = async <T,>(name: string, input: Record<string, unknown> = {}) => {
      const r = await lensRun<T>('engineering', name, input);
      return r.data?.ok && r.data.result && typeof r.data.result === 'object' ? r.data.result : null;
    };
    const [history, parts, cases] = await Promise.all([
      run<{ jobs?: unknown[] }>('listSimJobs'),
      run<{ parts?: unknown[] }>('listParts'),
      run<{ loadCases?: unknown[] }>('listLoadCases'),
    ]);
    const lines = [
      '# Engineering export',
      '',
      '## Working model',
      `Nodes: ${model.nodes.length} · Members: ${model.members.length} · Loads: ${model.loads.length} · Supports: ${model.supports.length}`,
      '',
      '```json',
      JSON.stringify(model, null, 2),
      '```',
      '',
      '## Latest FEA result (this session / restored)',
      feaResult ? ['```json', JSON.stringify(feaResult, null, 2), '```'].join('\n') : 'No FEA result yet.',
      '',
      `## Simulation history (${history?.jobs?.length ?? 0})`,
      history?.jobs?.length ? ['```json', JSON.stringify(history.jobs, null, 2), '```'].join('\n') : 'No runs recorded.',
      '',
      `## Saved parts (${parts?.parts?.length ?? 0})`,
      parts?.parts?.length ? ['```json', JSON.stringify(parts.parts, null, 2), '```'].join('\n') : 'No saved parts.',
      '',
      `## Load cases (${cases?.loadCases?.length ?? 0})`,
      cases?.loadCases?.length
        ? ['```json', JSON.stringify(cases.loadCases, null, 2), '```'].join('\n')
        : 'No saved load cases.',
    ];
    return {
      title: 'Engineering — model, results and records',
      content: lines.join('\n'),
      tags: ['engineering', 'export', 'fea'],
    };
  };

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

        {summary && (() => {
          // FIX-engineering-011: the solver returns support reactions
          // and per-member end moments, and the factor of safety is
          // 1/maxUtilization — the summary strip showed none of them.
          const fr = feaResult as unknown as {
            reactions?: Array<{ nodeId: string; dof: string; force: number }>;
            memberForces?: Array<{ momentI?: number; momentJ?: number }>;
          } | null;
          const reactionsByNode = new Map<string, Array<{ dof: string; force: number }>>();
          for (const r of fr?.reactions ?? []) {
            if (Math.abs(r.force) < 1e-9) continue;
            const arr = reactionsByNode.get(r.nodeId) ?? [];
            arr.push({ dof: r.dof, force: r.force });
            reactionsByNode.set(r.nodeId, arr);
          }
          const maxMoment = Math.max(0, ...(fr?.memberForces ?? []).flatMap((m) => [Math.abs(m.momentI ?? 0), Math.abs(m.momentJ ?? 0)]));
          const fos = summary.maxUtilization > 0 ? 1 / summary.maxUtilization : null;
          return (
          <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-center">
              <p className="mb-1 text-xs text-gray-400">Factor of Safety</p>
              <p className="font-mono text-lg font-bold text-neon-cyan">{fos !== null ? fos.toFixed(2) : '—'}</p>
              <p className="text-[10px] text-gray-400">1 ÷ max utilization</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-center">
              <p className="mb-1 text-xs text-gray-400">Max Bending Moment</p>
              <p className="font-mono text-lg font-bold text-neon-cyan">{maxMoment.toFixed(2)}</p>
              <p className="text-[10px] text-gray-400">largest member end moment</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-left">
              <p className="mb-1 text-center text-xs text-gray-400">Support Reactions</p>
              {reactionsByNode.size === 0 ? (
                <p className="text-center font-mono text-sm text-gray-400">none</p>
              ) : (
                <ul className="space-y-0.5 font-mono text-[11px] text-gray-300">
                  {[...reactionsByNode.entries()].map(([nodeId, rs]) => (
                    <li key={nodeId}><span className="text-neon-cyan">{nodeId}</span>: {rs.map((r) => `${r.dof} ${r.force.toFixed(2)}`).join(' · ')}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          </>
          );
        })()}

        <div className="flex justify-end">
          <DTUExportButton domain="engineering" data={{}} prepare={prepareExport} />
        </div>

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
