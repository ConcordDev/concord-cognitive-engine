'use client';

/**
 * ActionTesterPanel — S-INV-1 (F8). Two checks, honestly separated:
 * (1) a MONITOR EVALUATION — give the state an action would leave
 * behind and the registered monitors evaluate it for real (a dry run:
 * nothing is recorded). This is the verdict path.
 * (2) a KEYWORD AID over the authored ethos sets — text overlap only.
 * It previously rendered its keyword result as a green pass/fail bar
 * while never consulting the monitors: a verdict produced by a
 * different procedure than the one named (generation-as-execution). It
 * is now labelled as what it is and cannot certify anything.
 */

import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Zap, Loader2, Check, X, ShieldAlert } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { Invariant } from './invariant-types';

interface MonitorVerdict { monitorId: string; name: string; status: string; evaluatedValue: unknown; error: string | null }

export function ActionTesterPanel() {
  const [testAction, setTestAction] = useState('');
  const [testResult, setTestResult] = useState<{ passed: boolean; message: string } | null>(null);
  const [stateText, setStateText] = useState('');
  const [verdicts, setVerdicts] = useState<MonitorVerdict[] | null>(null);
  const [evalError, setEvalError] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const testInputRef = useRef<HTMLInputElement>(null);

  const { items: invariantItems } = useLensData<Invariant>('invariant', 'invariant', { seed: [] });
  const invariants: Invariant[] = invariantItems.map((item) => {
    const d = item.data as unknown as Invariant;
    return {
      id: item.id,
      name: d.name ?? item.title,
      description: d.description ?? '',
      status: d.status ?? 'enforced',
      category: d.category ?? 'ethos',
      frozen: d.frozen ?? true,
    };
  });

  const testMut = useMutation({
    mutationFn: async (text: string) => {
      const invariantSpecs = invariants.map((inv) => ({ name: inv.name, description: inv.description }));
      const { data } = await lensRun<{ passed: boolean; message: string; violations?: string[] }>(
        'invariant', 'testAction', { text, invariants: invariantSpecs }
      );
      if (!data.ok || !data.result) throw new Error(data.error || 'Invariant test failed');
      return data.result;
    },
    onError: (err) => console.error('testMut failed:', err instanceof Error ? err.message : err),
  });

  const handleTestAction = useCallback(async () => {
    if (!testAction.trim()) return;
    setTestResult(null);
    try {
      const result = await testMut.mutateAsync(testAction);
      setTestResult({ passed: result.passed, message: result.message });
    } catch (e) {
      setTestResult({
        passed: false,
        message: `Check failed: ${e instanceof Error ? e.message : 'backend error'}`,
      });
    }
  }, [testAction, testMut]);

  const handleEvaluate = useCallback(async () => {
    setEvalError('');
    setVerdicts(null);
    let state: Record<string, unknown>;
    try {
      state = JSON.parse(stateText) as Record<string, unknown>;
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('not an object');
    } catch {
      setEvalError('The resulting state must be a JSON object, e.g. { "balance": -5 }.');
      return;
    }
    setEvaluating(true);
    try {
      const { data } = await lensRun<{ checked?: MonitorVerdict[]; summary?: { evaluated: number } }>(
        'invariant', 'checkMonitors', { state, dryRun: true }
      );
      if (!data.ok) { setEvalError(data.error || 'Evaluation failed.'); return; }
      const checked = data.result?.checked ?? [];
      if ((data.result?.summary?.evaluated ?? checked.length) === 0) {
        setEvalError('No active monitors to evaluate against — register one in the Workbench first.');
        return;
      }
      setVerdicts(checked);
    } catch (e) {
      setEvalError(`Evaluation failed: ${e instanceof Error ? e.message : 'backend error'}`);
    } finally {
      setEvaluating(false);
    }
  }, [stateText]);

  useLensCommand(
    [{ id: 'focus-test', keys: 't', description: 'Test an action', category: 'actions', action: () => testInputRef.current?.focus() }],
    { lensId: 'invariant' },
  );

  const isTesting = testMut.isPending;
  const anyViolation = verdicts?.some((v) => v.status !== 'pass');

  return (
    <div className="panel p-4 space-y-5">
      <h2 className="font-semibold flex items-center gap-2">
        <Zap className="w-4 h-4 text-neon-purple" />
        Action Invariant Tester
      </h2>

      <div>
        <p className="text-sm text-gray-300 mb-1">Evaluate an action&rsquo;s resulting state against your monitors</p>
        <p className="text-xs text-gray-500 mb-2">
          Describe the state the action would leave behind, as JSON. Your active monitors evaluate it for
          real — a dry run: verdicts are shown, nothing is recorded in your violation history.
        </p>
        <textarea
          value={stateText}
          onChange={(e) => setStateText(e.target.value)}
          placeholder='{ "balance": -5 }'
          rows={3}
          className="input-lattice w-full font-mono text-sm"
          aria-label="Resulting state (JSON)"
        />
        <button
          type="button"
          onClick={handleEvaluate}
          className="btn-neon purple mt-2 focus:outline-none"
          disabled={evaluating || !stateText.trim()}
        >
          {evaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Evaluate against monitors'}
        </button>
        {evalError && <p className="mt-2 text-sm text-yellow-300">{evalError}</p>}
        {verdicts && (
          <div className={`mt-3 rounded-lg p-3 ${anyViolation ? 'bg-neon-pink/15' : 'bg-neon-green/15'}`}>
            <p className={`text-sm font-medium flex items-center gap-2 ${anyViolation ? 'text-neon-pink' : 'text-neon-green'}`}>
              {anyViolation ? <ShieldAlert className="w-4 h-4" /> : <Check className="w-4 h-4" />}
              {anyViolation ? 'This state violates a registered monitor.' : 'This state passes every active monitor.'}
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {verdicts.map((v) => (
                <li key={v.monitorId} className="flex items-center gap-2">
                  {v.status === 'pass' ? <Check className="w-3 h-3 text-neon-green" /> : <X className="w-3 h-3 text-neon-pink" />}
                  <span className="font-mono">{v.name}</span>
                  <span className="text-gray-400">
                    {v.status === 'pass' ? 'passes' : v.status === 'error' ? `could not evaluate (${v.error ?? 'error'})` : `violated — evaluated to ${String(v.evaluatedValue)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-white/5 pt-4">
        <p className="text-sm text-gray-300 mb-1">Keyword aid — text overlap only</p>
        <p className="text-xs text-gray-500 mb-2">
          Checks an action&rsquo;s wording against your authored ethos sets&rsquo; names and descriptions.
          This is a text check, not an evaluation — it cannot pass or block an action.
        </p>
        <div className="flex gap-2">
          <input
            ref={testInputRef}
            type="text"
            value={testAction}
            onChange={(e) => setTestAction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTestAction()}
            placeholder="e.g., 'track user behavior' or 'process locally'  ·  t to focus"
            className="input-lattice flex-1"
          />
          <button
            type="button"
            onClick={handleTestAction}
            className="btn-secondary text-sm focus:outline-none"
            disabled={isTesting || !testAction.trim()}
          >
            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Check keywords'}
          </button>
        </div>
        {testResult && (
          <p className="mt-3 text-sm text-gray-300">
            {testResult.passed
              ? `Keyword aid: ${testResult.message} (No evaluation was performed.)`
              : `Keyword aid: ${testResult.message}`}
          </p>
        )}
      </div>
    </div>
  );
}
