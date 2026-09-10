'use client';

/**
 * ActionTesterPanel — invariant.testAction macro (keyword match vs authored set).
 * Extracted from invariant/page.tsx.
 */

import { useState, useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Zap, Loader2, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { Invariant } from './invariant-types';

export function ActionTesterPanel() {
  const [testAction, setTestAction] = useState('');
  const [testResult, setTestResult] = useState<{ passed: boolean; message: string } | null>(null);
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

  useLensCommand(
    [{ id: 'focus-test', keys: 't', description: 'Test an action', category: 'actions', action: () => testInputRef.current?.focus() }],
    { lensId: 'invariant' },
  );

  const isTesting = testMut.isPending;

  return (
    <div className="panel p-4">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Zap className="w-4 h-4 text-neon-purple" />
        Action Invariant Tester
      </h2>
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
          className="btn-neon purple focus:outline-none focus:ring-2 focus:ring-amber-500"
          disabled={isTesting || !testAction.trim()}
        >
          {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Test'}
        </button>
      </div>
      {testResult && (
        <div
          className={`mt-4 p-4 rounded-lg flex items-center gap-3 ${
            testResult.passed
              ? 'bg-neon-green/20 text-neon-green'
              : 'bg-neon-pink/20 text-neon-pink'
          }`}
        >
          {testResult.passed ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
          <span>{testResult.message}</span>
        </div>
      )}
    </div>
  );
}
