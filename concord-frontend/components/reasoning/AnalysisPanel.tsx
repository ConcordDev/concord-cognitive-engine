'use client';

/**
 * Deterministic analysis engines over the selected chain's live trace.
 * deepAnalysis / counterArgumentGen / strengthAssessment — registered in
 * server/domains/reasoning.js. counterArgumentGen renders as a badged
 * angle list (never a JSON dump of `angles`). Deliberately does not send
 * mapId — ArgumentMapStudio owns persisted map ids.
 *
 * The engines are stateless over the caller's params (the selected
 * chain's premises/conclusion), so they run through /api/lens/run
 * directly — FIX-reasoning-001: they used to route through a synced
 * 'chain' DTU artifact that only an unrelated panel's seed effect ever
 * created, so the buttons sat disabled (and Assess Strength silently
 * did nothing) whenever that artifact did not exist.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Brain, Play, Loader2, AlertOctagon, ArrowUpRight,
  AlertTriangle, Link2, HelpCircle, Search, Target, Trash2,
} from 'lucide-react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

interface CounterAngle {
  attack: string;
  detail: string;
  source?: string;
  mapId?: string;
  nodeId?: string;
  schemeName?: string;
}

interface Chain {
  id: string;
  ownerId?: string | null;
  question: string;
  type?: string;
  // The list_chains contract: a slim row with stepCount + status, NOT a
  // steps array — reading `steps.length` here showed 0 for every chain
  // (FIX-reasoning-001). `steps` stays as a fallback for other payloads.
  stepCount?: number;
  status?: string;
  steps?: string[];
  conclusion?: { statement?: string; confidence?: number } | null;
}

const ANGLE_TYPE_CONFIG: Record<string, { label: string; icon: typeof Brain; badge: string; accent: string }> = {
  'internal-contradiction': { label: 'Contradiction', icon: AlertOctagon, badge: 'bg-red-400/20 text-red-400', accent: 'border-red-400/30' },
  'unsupported-leap': { label: 'Unsupported Leap', icon: ArrowUpRight, badge: 'bg-yellow-400/20 text-yellow-400', accent: 'border-yellow-400/30' },
  fallacy: { label: 'Fallacy', icon: AlertTriangle, badge: 'bg-orange-400/20 text-orange-400', accent: 'border-orange-400/30' },
  'weak-link': { label: 'Weak Link', icon: Link2, badge: 'bg-rose-400/20 text-rose-400', accent: 'border-rose-400/30' },
  'scheme-critical-question': { label: 'Critical Question', icon: HelpCircle, badge: 'bg-neon-cyan/20 text-neon-cyan', accent: 'border-neon-cyan/30' },
  'demand-evidence': { label: 'Demand Evidence', icon: Search, badge: 'bg-neon-blue/20 text-neon-blue', accent: 'border-neon-blue/30' },
};
const DEFAULT_ANGLE_CONFIG = { label: 'Attack', icon: Target, badge: 'bg-gray-400/20 text-gray-400', accent: 'border-gray-400/30' };

export function AnalysisPanel() {
  const queryClient = useQueryClient();
  const [analysisResult, setAnalysisResult] = useState<Record<string, unknown> | null>(null);
  const [analysisRunning, setAnalysisRunning] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingChain, setDeletingChain] = useState(false);

  // Ownership (FIX-reasoning-005, chains leg): chains carry the creator's
  // stamped ownerId; the delete control renders only on the caller's own
  // chains. The server enforces the same scope on delete_chain regardless.
  const { data: whoamiData } = useQuery({
    queryKey: ['auth-whoami'],
    queryFn: () => lensRun('auth', 'whoami', {}).then((r) => r.data),
  });
  const myUserId = (whoamiData?.result as { actor?: { userId?: string } } | undefined)?.actor?.userId || null;

  const { data: chainsData, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['reasoning-chains'],
    queryFn: () => apiHelpers.reasoning.list().then((r) => r.data),
  });

  const { data: traceData, isError: isError4, error: error4, refetch: refetch4 } = useQuery({
    queryKey: ['reasoning-trace', selectedChain],
    queryFn: () => selectedChain ? apiHelpers.reasoning.trace(selectedChain).then((r) => r.data) : null,
    enabled: !!selectedChain,
  });

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

  const handleDeleteChain = useCallback(async (chainId: string) => {
    setDeletingChain(true);
    try {
      const r = await apiHelpers.reasoning.remove(chainId);
      const out = r.data as { ok?: boolean; error?: string };
      if (out?.ok) {
        if (selectedChain === chainId) setSelectedChain(null);
        setConfirmDeleteId(null);
        queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
      } else {
        setAnalysisResult({ message: `Delete failed: ${out?.error || 'Unknown error'}` });
      }
    } catch (e) {
      setAnalysisResult({ message: `Delete failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setDeletingChain(false);
    }
  }, [selectedChain, queryClient]);

  const handleAnalysisAction = useCallback(async (action: string) => {
    if (!selectedChain) {
      setAnalysisResult({ message: 'Select a chain in the table above first.' });
      return;
    }
    if (chainPremises.length === 0) {
      setAnalysisResult({ message: 'Selected chain has no steps yet — add reasoning steps in the Chains tab first.' });
      return;
    }
    setAnalysisRunning(action);
    setAnalysisResult(null);
    try {
      // Stateless engines over the selected chain's params — the exact
      // pattern server/domains/reasoning.js documents for this panel.
      const res = await lensRun('reasoning', action, { premises: chainPremises, conclusion: chainConclusionText });
      if (!res.data.ok) {
        setAnalysisResult({ message: `Action failed: ${res.data.error || 'Unknown error'}` });
      } else {
        setAnalysisResult((res.data.result as Record<string, unknown>) || { message: 'Analysis complete' });
      }
      queryClient.invalidateQueries({ queryKey: ['reasoning-chains'] });
    } catch (e) {
      console.error(`Analysis action ${action} failed:`, e);
      setAnalysisResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setAnalysisRunning(null);
    }
  }, [selectedChain, chainPremises, chainConclusionText, queryClient]);

  if (isError2 || isError4) {
    const msg = [error2, error4]
      .map((e) => (e instanceof Error ? e.message : ''))
      .find(Boolean) || 'analysis_load_failed';
    return (
      <ErrorState
        message={msg}
        onRetry={() => { refetch2(); refetch4(); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className={ds.sectionHeader}>
        <h2 className={cn(ds.heading2, 'flex items-center gap-2 text-base')}>
          <BarChart3 className="w-5 h-5 text-neon-cyan" />
          Analysis
        </h2>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-950/40 overflow-x-auto">
        {chains.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-lattice-border text-left text-gray-400">
                <th className="py-1.5 px-3 font-medium">Question</th>
                <th className="py-1.5 px-3 font-medium">Type</th>
                <th className="py-1.5 px-3 font-medium">Steps</th>
                <th className="py-1.5 px-3 font-medium">Status</th>
                <th className="py-1.5 px-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {chains.map((chain) => (
                <tr
                  key={chain.id}
                  className={cn(
                    'border-b border-lattice-border/50 hover:bg-violet-500/10',
                    selectedChain === chain.id && 'bg-violet-500/15',
                  )}
                >
                  <td className="py-1.5 px-3 text-white max-w-xs truncate">
                    <button
                      type="button"
                      onClick={() => setSelectedChain(chain.id)}
                      className="text-left w-full truncate"
                    >
                      {chain.question}
                    </button>
                  </td>
                  <td className="py-1.5 px-3">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{chain.type || 'deductive'}</span>
                  </td>
                  <td className="py-1.5 px-3 text-gray-400">{chain.stepCount ?? chain.steps?.length ?? 0}</td>
                  <td className="py-1.5 px-3">
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded',
                      (chain.status ? chain.status === 'concluded' : !!chain.conclusion) ? 'bg-green-400/20 text-green-400' : 'bg-neon-blue/20 text-neon-blue',
                    )}>
                      {(chain.status ? chain.status === 'concluded' : !!chain.conclusion) ? 'Concluded' : 'Open'}
                    </span>
                  </td>
                  <td className="py-1.5 px-3">
                    {myUserId && chain.ownerId === myUserId ? (
                      confirmDeleteId === chain.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteChain(chain.id)}
                            disabled={deletingChain}
                            className="text-[10px] px-2 py-0.5 rounded bg-red-400/20 text-red-300 hover:bg-red-400/30 disabled:opacity-50"
                          >
                            {deletingChain ? 'Deleting…' : 'Confirm delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[10px] px-2 py-0.5 rounded bg-zinc-500/20 text-zinc-300 hover:bg-zinc-500/30"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(chain.id)}
                          aria-label={`Delete chain: ${chain.question}`}
                          title="Delete this chain"
                          className="text-zinc-400 hover:text-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState compact title="No chains to analyze." description="Create chains in the Chains view, then run the engines below." />
        )}
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
        <h3 className={cn(ds.heading3, 'text-sm mb-2 flex items-center gap-2')}>
          <Brain className="w-4 h-4 text-neon-purple" />
          AI-Powered Analysis
        </h3>
        <p className={cn(ds.textMuted, 'mb-3')}>
          Run backend reasoning analysis engines against your arguments and chains.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleAnalysisAction('deepAnalysis')}
            disabled={!!analysisRunning}
            className={cn(ds.btnSmall, 'bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-50 disabled:cursor-not-allowed')}
          >
            {analysisRunning === 'deepAnalysis' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Deep Analysis
          </button>
          <button
            onClick={() => handleAnalysisAction('counterArgumentGen')}
            disabled={!!analysisRunning}
            className={cn(ds.btnSmall, 'bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-50 disabled:cursor-not-allowed')}
          >
            {analysisRunning === 'counterArgumentGen' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Generate Counter-Arguments
          </button>
          <button
            onClick={() => handleAnalysisAction('strengthAssessment')}
            disabled={!!analysisRunning}
            className={cn(ds.btnSmall, 'bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-50 disabled:cursor-not-allowed')}
          >
            {analysisRunning === 'strengthAssessment' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Full Strength Assessment
          </button>
        </div>
        {analysisResult && (
          <div className="mt-3 bg-lattice-deep rounded-lg p-4 text-sm">
            {'message' in analysisResult ? (
              <p className={ds.textMuted}>{String(analysisResult.message)}</p>
            ) : Array.isArray(analysisResult.angles) ? (
              <div className="space-y-3">
                {(typeof analysisResult.validity === 'string' || typeof analysisResult.recommendation === 'string') && (
                  <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-lattice-border/50">
                    {typeof analysisResult.validity === 'string' && (
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', 'bg-neon-purple/20 text-neon-purple')}>
                        {analysisResult.validity}
                      </span>
                    )}
                    {typeof analysisResult.recommendation === 'string' && (
                      <span className="text-xs text-gray-400">{analysisResult.recommendation}</span>
                    )}
                  </div>
                )}
                {(analysisResult.angles as CounterAngle[]).map((angle, i) => {
                  const cfg = ANGLE_TYPE_CONFIG[angle.attack] || DEFAULT_ANGLE_CONFIG;
                  const AngleIcon = cfg.icon;
                  return (
                    <div key={`${angle.attack}-${i}`} className={cn('rounded-lg border p-3 bg-lattice-surface/50', cfg.accent)}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.badge)}>
                          <AngleIcon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                        {angle.schemeName && (
                          <span className="text-xs text-gray-500">{angle.schemeName}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-300">{angle.detail}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-xs text-gray-300 font-mono max-h-48 overflow-y-auto">
                {JSON.stringify(analysisResult, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
