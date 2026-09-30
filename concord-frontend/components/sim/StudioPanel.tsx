'use client';

import { useState } from 'react';
import { SystemDynamicsBuilder } from '@/components/sim/SystemDynamicsBuilder';
import { AgentBasedRunner } from '@/components/sim/AgentBasedRunner';
import { DiscreteEventRunner } from '@/components/sim/DiscreteEventRunner';
import { SimToolkit } from '@/components/sim/SimToolkit';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { TrendingUp, Users, Boxes, Sigma } from 'lucide-react';

// ─── STUDIO TAB ──────────────────────────────────────────────────────────────
// AnyLogic / Vensim parity: the marquee simulation paradigms (system dynamics,
// agent-based, discrete-event) plus the analysis toolkit (formula evaluator,
// goal-seek, scenario diff, calibration) — every panel wired to a real sim
// domain macro running real computation.

type StudioMode = 'system-dynamics' | 'agent-based' | 'discrete-event' | 'toolkit';

const STUDIO_MODES: Array<{ key: StudioMode; label: string; icon: React.ReactNode; blurb: string }> = [
  { key: 'system-dynamics', label: 'System Dynamics', icon: <TrendingUp className="w-4 h-4" />, blurb: 'Visual stock-and-flow model builder with Euler integration and feedback-loop detection.' },
  { key: 'agent-based', label: 'Agent-Based', icon: <Users className="w-4 h-4" />, blurb: 'SIR epidemic, Schelling segregation, and predator-prey agent runtimes on a spatial grid.' },
  { key: 'discrete-event', label: 'Discrete-Event', icon: <Boxes className="w-4 h-4" />, blurb: 'Event-driven M/M/c queue simulation with wait, utilization, and stability metrics.' },
  { key: 'toolkit', label: 'Analysis Toolkit', icon: <Sigma className="w-4 h-4" />, blurb: 'Formula evaluator, goal-seek, scenario diff, calibration, rule-based scenario run, parameter sweep, distribution Monte Carlo, and elasticity tornado charts.' },
];

export function StudioPanel() {
  const [mode, setMode] = useState<StudioMode>('system-dynamics');
  const active = STUDIO_MODES.find(m => m.key === mode);

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel)}>
        <div className="flex flex-wrap gap-2">
          {STUDIO_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                ds.btnSmall, 'flex items-center gap-1.5',
                mode === m.key ? ds.btnPrimary : ds.btnSecondary,
              )}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        {active && <p className={cn(ds.textMuted, 'mt-3')}>{active.blurb}</p>}
      </div>

      {mode === 'system-dynamics' && <SystemDynamicsBuilder />}
      {mode === 'agent-based' && <AgentBasedRunner />}
      {mode === 'discrete-event' && <DiscreteEventRunner />}
      {mode === 'toolkit' && <SimToolkit />}
    </div>
  );
}
