'use client';

/**
 * ReasoningTraceTree — renders an HLR reasoning trace as an explorable
 * inference tree: the trace is the root, each reasoning chain is a branch,
 * and each chain step (premise_collection → deduction → conclusion) is a
 * leaf the user can expand to inspect the claims it derived.
 *
 * All data is a real HLR trace returned by `hlr.run` / `hlr.trace` /
 * `cognition.compareModes` — no synthetic nodes.
 */

import { useMemo } from 'react';
import { TreeDiagram, type TreeNode } from '@/components/viz/TreeDiagram';

export interface TraceStep {
  stepIndex: number;
  type: string;
  description: string;
  claims?: string[];
  confidence?: number;
}

export interface TraceChain {
  chainId: string;
  mode?: string;
  conclusion?: string;
  confidence?: number;
  stepCount?: number;
  steps?: TraceStep[];
}

export interface ReasoningTrace {
  traceId?: string;
  input?: { topic?: string | null; question?: string | null; mode?: string; depth?: number };
  mode?: string;
  evaluation?: { confidence?: number; convergence?: number; novelty?: number };
  output?: { synthesizedConclusion?: string };
  synthesizedConclusion?: string;
  chains?: TraceChain[];
}

function stepTone(type: string): TreeNode['tone'] {
  if (type === 'conclusion') return 'good';
  if (type === 'premise_collection' || type === 'observation_collection') return 'info';
  return 'default';
}

function pct(n?: number): string {
  return n == null || !Number.isFinite(n) ? '—' : `${Math.round(n * 100)}%`;
}

function buildTree(trace: ReasoningTrace): TreeNode {
  const chains = Array.isArray(trace.chains) ? trace.chains : [];
  const rootLabel =
    trace.input?.question || trace.input?.topic || 'Reasoning trace';
  return {
    id: trace.traceId || 'trace-root',
    label: rootLabel,
    detail: `${chains.length} chain${chains.length === 1 ? '' : 's'} · mode ${
      trace.input?.mode || trace.mode || '—'
    } · confidence ${pct(trace.evaluation?.confidence)}`,
    tone: 'info',
    children: chains.map((chain, ci) => {
      const steps = Array.isArray(chain.steps) ? chain.steps : [];
      return {
        id: chain.chainId || `chain-${ci}`,
        label: `Chain ${ci + 1} — ${chain.mode || trace.mode || 'reasoning'}`,
        detail: `${steps.length || chain.stepCount || 0} steps · confidence ${pct(
          chain.confidence,
        )}`,
        tone: 'default',
        children: [
          ...steps.map((step) => ({
            id: `${chain.chainId || ci}-step-${step.stepIndex}`,
            label: `${step.stepIndex + 1}. ${step.type.replace(/_/g, ' ')}`,
            detail: `${step.description} · ${pct(step.confidence)}`,
            tone: stepTone(step.type),
            children: (step.claims || []).map((claim, idx) => ({
              id: `${chain.chainId || ci}-step-${step.stepIndex}-claim-${idx}`,
              label: claim,
              tone: 'default' as const,
            })),
          })),
          ...(chain.conclusion
            ? [
                {
                  id: `${chain.chainId || ci}-conclusion`,
                  label: `⇒ ${chain.conclusion}`,
                  tone: 'good' as const,
                },
              ]
            : []),
        ],
      };
    }),
  };
}

export function ReasoningTraceTree({ trace }: { trace: ReasoningTrace | null }) {
  const tree = useMemo(() => (trace ? buildTree(trace) : null), [trace]);

  if (!trace || !tree) {
    return (
      <p className="text-xs text-violet-700">
        No trace selected yet — run a reasoning pass to see its inference tree.
      </p>
    );
  }
  if (!tree.children || tree.children.length === 0) {
    return (
      <p className="text-xs text-violet-700">
        This trace has no chains to display.
      </p>
    );
  }

  const conclusion =
    trace.output?.synthesizedConclusion || trace.synthesizedConclusion;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-3">
        <TreeDiagram root={tree} />
      </div>
      {conclusion && (
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-600">
            Synthesized conclusion
          </div>
          <p className="text-sm text-emerald-100">{conclusion}</p>
        </div>
      )}
    </div>
  );
}
