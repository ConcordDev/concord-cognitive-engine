'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * BiasChecklist — pre-decision prompt that surfaces likely cognitive biases.
 * The checklist itself comes from the `biasChecklist` macro; checked items
 * are a local working surface to confirm the user genuinely considered each.
 */

import { useEffect, useState } from 'react';
import { ShieldAlert, Loader2, CheckSquare, Square, RotateCcw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface BiasItem { id: string; name: string; prompt: string }

export function BiasChecklist() {
  const [items, setItems] = useState<BiasItem[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await lensRun('metacognition', 'biasChecklist', {});
      if (res.data.ok && res.data.result) {
        setItems(((res.data.result as any).checklist as BiasItem[]) || []);
      } else {
        setError(res.data.error || 'Failed to load bias checklist');
      }
      setLoading(false);
    })();
  }, []);

  const reviewed = Object.values(checked).filter(Boolean).length;
  const allClear = items.length > 0 && reviewed === items.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading bias checklist...
      </div>
    );
  }

  return (
    <div className="panel p-4 space-y-4">
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-neon-yellow" /> Pre-Decision Bias Checklist
        </h3>
        <button
          onClick={() => setChecked({})}
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Run this before committing to a decision. Tick each bias once you have
        genuinely asked yourself the question.
      </p>

      <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${allClear ? 'bg-green-500' : 'bg-yellow-500'}`}
          style={{ width: `${items.length ? (reviewed / items.length) * 100 : 0}%` }}
        />
      </div>
      <p className="text-xs text-gray-400">
        {reviewed} / {items.length} biases reviewed
        {allClear && <span className="text-green-400 ml-1">— all clear, decide with eyes open</span>}
      </p>

      <div className="space-y-2">
        {items.map((b) => {
          const on = !!checked[b.id];
          return (
            <button
              key={b.id}
              onClick={() => setChecked((c) => ({ ...c, [b.id]: !on }))}
              className={`w-full text-left p-3 rounded-lg border transition-colors flex items-start gap-3 ${
                on ? 'border-green-500/30 bg-green-500/5' : 'border-gray-700/40 bg-lattice-deep hover:border-yellow-500/30'
              }`}
            >
              {on
                ? <CheckSquare className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                : <Square className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />}
              <div>
                <p className="text-sm font-medium text-gray-200">{b.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{b.prompt}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
