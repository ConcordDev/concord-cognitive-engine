'use client';

/**
 * Linear proof construction — premise → justified step → conclusion.
 * Wires the family-#3 chain engine via /api/reasoning/chains* (apiHelpers.reasoning).
 * Domain actions (validate_logic / check_fallacies / assess_strength) run against
 * the selected chain's live trace — one call site each.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Workflow, ArrowRight, CheckCircle2, AlertTriangle, Zap, Loader2, Search,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';

type ChainType = 'deductive' | 'inductive' | 'abductive' | 'analogical' | 'causal' | 'modal';

interface Chain {
  id: string;
  question: string;
  type?: string;
  steps?: string[];
  conclusion?: { statement?: string; confidence?: number } | null;
  status?: string;
  createdAt?: string;
}

const CHAIN_TYPES: { value: ChainType; label: string; description: string }[] = [
  { value: 'deductive', label: 'Deductive', description: 'Conclusion necessarily follows from premises' },
  { value: 'inductive', label: 'Inductive', description: 'Conclusion is probable given the evidence' },
  { value: 'abductive', label: 'Abductive', description: 'Best explanation for observed facts' },
  { value: 'analogical', label: 'Analogical', description: 'Reasoning by similarity to known cases' },
  { value: 'causal', label: 'Causal', description: 'Establishing cause-and-effect relationships' },
  { value: 'modal', label: 'Modal', description: 'Reasoning about possibility and necessity' },
];

export function ChainProofPanel() {
  const queryClient = useQueryClient();
  const [newPremise, setNewPremise] = useState('');
  const [chainType, setChainType] = useState<ChainType>('deductive');
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [newStep, setNewStep] = useState('');
  const [newStepJustification, setNewStepJustification] = useState('');
  const [newConclusionStatement, setNewConclusionStatement] = useState('');
  const [domainActionResult, setDomainActionResult] = useState<Record<string, unknown> | null>(null);

  const { data: chainsData, isError: isError2, error: error2, refetch: refetch2, isLoading: chainsLoading } = useQuery({
    queryKey: ['reasoning-chains'],
    queryFn: () => apiHelpers.reasoning.list().then((r) => r.data),
    refetchInterval: 10000,
  });

  const { data: traceData, isError: isError4, error: error4, refetch: refetch4 } = useQuery({
    queryKey: ['reasoning-trace', selectedChain],
    queryFn: () => selectedChain ? apiHelpers.reasoning.trace(selectedChain).then((r) => r.data) : null,
    enabled: !!selectedChain,
  });

  const { items: chainArtifacts, create: createChainArtifact, isError, error, refetch } = useLensData('reasoning', 'chain', { noSeed: true });
  const runAction = useRunArtifact('reasoning');

  const chainSeeded = useRef(false);
  useEffect(() => {
    if (chainSeeded.current || chainArtifacts.length > 0 || !chainsData) return;
    const allChains: Chain[] = chainsData?.chains || chainsData || [];
    if (allChains.length > 0) {
      chainSeeded.current = true;
      const first = allChains[0];
      createChainArtifact({
        title: first.question || 'Reasoning Chain',
        data: { chainId: first.id, type: first.type, question: first.question },
        meta: { status: first.status || 'active', tags: ['auto-synced'] },
      });
    }
  }, [chainsData, chainArtifacts.length, createChainArtifact]);

  const chains: Chain[] = chainsData?.chains || chainsData || [];
  const trace: Record<string, unknown> = useMemo(
    () => traceData?.trace || traceData || {},
    [traceData],
  );

  const chainPremises = useMemo(() => {
    const stepsArr = (trace?.steps as Record<string, unknown>[] | undefined) || [];
    return stepsArr.map((s) => String(s.conclusion || '')).filter(Boolean);
  }, [trace]);
  const chainConclusionText = useMemo(() => {
    const c = (trace?.conclusion as { statement?: string } | null) || null;
    if (c?.statement) return c.statement;
    return chainPremises.length ? chainPremises[chainPremises.length - 1] : '';
  }, [trace, chainPremises]);

  const createChain = useMutation({
    mutationFn: () => apiHelpers.reasoning.create({ question: newPremise, type: chainType }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
      setNewPremise('');
      const id = res.data?.chain?.id || res.data?.id;
      if (id) setSelectedChain(id);
    },
    onError: (err) => console.error('createChain failed:', err instanceof Error ? err.message : err),
  });

  const addStep = useMutation({
    mutationFn: () => {
      if (!selectedChain) return Promise.reject('No chain selected');
      const priorSteps = (trace?.steps as Record<string, unknown>[] | undefined) || [];
      const lastConclusion = priorSteps.length ? (priorSteps[priorSteps.length - 1].conclusion as string) : '';
      return apiHelpers.reasoning.addStep(selectedChain, {
        conclusion: newStep,
        justification: newStepJustification,
        premises: lastConclusion ? [lastConclusion] : [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
      queryClient.invalidateQueries({ queryKey: ['reasoning-trace', selectedChain] });
      setNewStep('');
      setNewStepJustification('');
    },
    onError: (err) => console.error('addStep failed:', err instanceof Error ? err.message : err),
  });

  const concludeChain = useMutation({
    mutationFn: () => {
      if (!selectedChain) return Promise.reject('No chain selected');
      return apiHelpers.reasoning.conclude(selectedChain, { statement: newConclusionStatement });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
      queryClient.invalidateQueries({ queryKey: ['reasoning-trace', selectedChain] });
      setNewConclusionStatement('');
    },
    onError: (err) => console.error('concludeChain failed:', err instanceof Error ? err.message : err),
  });

  const handleValidateLogic = useCallback(() => {
    if (!selectedChain || chainPremises.length === 0) return;
    const artifactId = chainArtifacts[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action: 'validate_logic', params: { premises: chainPremises, conclusion: chainConclusionText } },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
          setDomainActionResult((res as { result?: Record<string, unknown> })?.result ?? null);
        },
        onError: (e) => { console.error('Action failed:', e); },
      },
    );
  }, [selectedChain, chainArtifacts, chainPremises, chainConclusionText, runAction, queryClient]);

  const handleCheckFallacies = useCallback(() => {
    if (!selectedChain) return;
    const artifactId = chainArtifacts[0]?.id;
    if (!artifactId) return;
    const argumentText = [...chainPremises, chainConclusionText].filter(Boolean).join('. ');
    runAction.mutate(
      { id: artifactId, action: 'check_fallacies', params: { argument: argumentText } },
      {
        onSuccess: (res) => {
          setDomainActionResult((res as { result?: Record<string, unknown> })?.result ?? null);
        },
        onError: (e) => { console.error('Action failed:', e); },
      },
    );
  }, [selectedChain, chainArtifacts, chainPremises, chainConclusionText, runAction]);

  const handleAssessStrength = useCallback(() => {
    if (!selectedChain || chainPremises.length === 0) return;
    const artifactId = chainArtifacts[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action: 'assess_strength', params: { premises: chainPremises, conclusion: chainConclusionText } },
      {
        onSuccess: (res) => {
          setDomainActionResult((res as { result?: Record<string, unknown> })?.result ?? null);
        },
        onError: (e) => { console.error('Action failed:', e); },
      },
    );
  }, [selectedChain, chainArtifacts, chainPremises, chainConclusionText, runAction]);

  if (isError || isError2 || isError4) {
    const msg = [error, error2, error4]
      .map((e) => (e instanceof Error ? e.message : ''))
      .find(Boolean) || 'chain_load_failed';
    return (
      <ErrorState
        message={msg}
        onRetry={() => { refetch(); refetch2(); refetch4(); }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,20rem)_1fr] gap-3">
      <aside className="space-y-3">
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
          <h2 className={cn(ds.heading3, 'flex items-center gap-2 text-sm mb-3')}>
            <Workflow className="w-4 h-4 text-neon-cyan" /> Chain builder
          </h2>
          <div className="space-y-2">
            <input
              type="text"
              value={newPremise}
              onChange={(e) => setNewPremise(e.target.value)}
              placeholder="Starting question…"
              className={cn(ds.input, 'text-xs font-mono')}
            />
            <select
              value={chainType}
              onChange={(e) => setChainType(e.target.value as ChainType)}
              className={cn(ds.select, 'text-xs')}
            >
              {CHAIN_TYPES.map((ct) => (
                <option key={ct.value} value={ct.value}>{ct.label} — {ct.description}</option>
              ))}
            </select>
            <button
              onClick={() => createChain.mutate()}
              disabled={!newPremise || createChain.isPending}
              className={cn(ds.btnPrimary, 'w-full text-sm')}
            >
              {createChain.isPending ? 'Creating…' : 'Create chain'}
            </button>
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950/40 max-h-[22rem] overflow-y-auto">
          {chainsLoading && <div className="p-3 space-y-2"><Skeleton variant="line" /><Skeleton variant="line" /></div>}
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => setSelectedChain(chain.id)}
              className={cn(
                'w-full text-left px-3 py-2 border-b border-zinc-800/80 hover:bg-violet-500/10',
                selectedChain === chain.id && 'bg-violet-500/15 ring-1 ring-inset ring-violet-400/40',
              )}
            >
              <p className="text-xs font-medium truncate text-white">{chain.question}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-[10px] text-zinc-500">{chain.type || 'deductive'}</span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded',
                  chain.conclusion ? 'bg-green-400/20 text-green-400' : 'bg-neon-blue/20 text-neon-blue',
                )}>
                  {chain.conclusion ? 'concluded' : 'open'}
                </span>
              </div>
            </button>
          ))}
          {!chainsLoading && chains.length === 0 && (
            <EmptyState compact title="No chains yet" description="Create a chain from a starting question. Each step needs a justification — the engine rejects bare conclusions." />
          )}
        </div>
      </aside>

      <section className="rounded border border-zinc-800 bg-zinc-950/40 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleValidateLogic}
            disabled={!selectedChain || chainPremises.length === 0 || runAction.isPending}
            className={cn(ds.btnSmall, 'bg-green-400/10 text-green-400 border border-green-400/30 hover:bg-green-400/20')}
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Validate Logic
          </button>
          <button
            onClick={handleCheckFallacies}
            disabled={!selectedChain || runAction.isPending}
            className={cn(ds.btnSmall, 'bg-red-400/10 text-red-400 border border-red-400/30 hover:bg-red-400/20')}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Check Fallacies
          </button>
          <button
            onClick={handleAssessStrength}
            disabled={!selectedChain || chainPremises.length === 0 || runAction.isPending}
            className={cn(ds.btnSmall, 'bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20')}
          >
            <Zap className="w-3.5 h-3.5" /> Assess Strength
          </button>
          {runAction.isPending && (
            <span className={cn(ds.textMuted, 'flex items-center gap-1')}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…
            </span>
          )}
        </div>
        {domainActionResult && (
          <pre className="whitespace-pre-wrap text-[10px] text-gray-300 font-mono max-h-32 overflow-y-auto rounded border border-zinc-800 p-2">
            {'message' in domainActionResult
              ? String(domainActionResult.message)
              : JSON.stringify(domainActionResult, null, 2)}
          </pre>
        )}

        {!selectedChain ? (
          <EmptyState
            compact
            icon={<Search className="h-5 w-5 text-zinc-600" />}
            title="No chain selected"
            description="Pick a chain on the left. Steps are a proof: conclusion + required justification."
          />
        ) : (
          <>
            <h2 className={cn(ds.heading3, 'flex items-center gap-2 text-sm')}>
              <Search className="w-4 h-4 text-neon-green" /> Chain trace
            </h2>
            <div className="space-y-2">
              {(trace?.steps as Record<string, unknown>[] | undefined)?.map?.((step: Record<string, unknown>, i: number) => (
                <div key={i} className="flex items-start gap-3">
                  <div
                    className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                      Number(step.confidence ?? 0) >= 0.75 ? 'bg-green-400/20 text-green-400' : 'bg-lattice-surface text-gray-400 border border-lattice-border',
                    )}
                    title={`confidence ${Math.round(Number(step.confidence ?? 0) * 100)}%`}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0 rounded border border-zinc-800 px-2 py-1.5">
                    <p className="text-xs text-white">{step.conclusion as string}</p>
                    {Boolean(step.justification) && (
                      <p className="text-[10px] text-gray-400 mt-0.5">because {step.justification as string}</p>
                    )}
                    {Boolean(step.type) && <span className="font-mono text-[10px] text-zinc-500">{step.type as string}</span>}
                  </div>
                </div>
              ))}
            </div>

            {Boolean((trace?.conclusion as { statement?: string } | null)?.statement) && (
              <div className="p-3 rounded-lg bg-green-400/10 border border-green-400/30">
                <p className="text-sm font-semibold text-green-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Conclusion
                </p>
                <p className="text-sm mt-1 text-white">{(trace.conclusion as { statement?: string }).statement}</p>
                {typeof (trace.conclusion as { confidence?: number })?.confidence === 'number' && (
                  <p className="text-xs text-green-300/70 mt-1">
                    confidence {Math.round(((trace.conclusion as { confidence?: number }).confidence || 0) * 100)}%
                  </p>
                )}
              </div>
            )}

            {!(trace?.conclusion as { statement?: string } | null)?.statement && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newStep}
                    onChange={(e) => setNewStep(e.target.value)}
                    placeholder="This step concludes…"
                    className={cn(ds.input, 'flex-1 text-xs')}
                  />
                  <button
                    onClick={() => addStep.mutate()}
                    disabled={!newStep.trim() || !newStepJustification.trim() || addStep.isPending}
                    className={ds.btnPrimary}
                    aria-label="Add reasoning step"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={newStepJustification}
                  onChange={(e) => setNewStepJustification(e.target.value)}
                  placeholder="…because (justification, required)"
                  className={cn(ds.input, 'w-full text-xs')}
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newConclusionStatement}
                    onChange={(e) => setNewConclusionStatement(e.target.value)}
                    placeholder="Final conclusion statement…"
                    className={cn(ds.input, 'flex-1 text-xs')}
                  />
                  <button
                    onClick={() => concludeChain.mutate()}
                    disabled={!newConclusionStatement.trim() || concludeChain.isPending}
                    className={ds.btnSecondary}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Conclude
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
