'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * StrategyLibrary — named reasoning techniques with when-to-use guidance.
 * Data comes from the `strategyLibrary` macro; the category filter re-queries
 * the macro so the rendered set is always backend-derived.
 */

import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Strategy {
  id: string;
  name: string;
  category: string;
  when: string;
  how: string;
}

export function StrategyLibrary() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await lensRun('metacognition', 'strategyLibrary', { category });
    if (res.data.ok && res.data.result) {
      const r = res.data.result as any;
      setStrategies((r.strategies as Strategy[]) || []);
      if (Array.isArray(r.categories)) setCategories(r.categories as string[]);
    } else {
      setError(res.data.error || 'Failed to load strategy library');
    }
    setLoading(false);
  }, [category]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading thinking strategies...
      </div>
    );
  }

  return (
    <div className="panel p-4 space-y-4">
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
      )}
      <h3 className="font-semibold flex items-center gap-2">
        <BrainCircuit className="w-4 h-4 text-neon-purple" /> Thinking-Strategy Library
      </h3>
      <p className="text-xs text-gray-500">
        Named reasoning techniques. Pick a category, then expand a strategy for
        when and how to apply it.
      </p>

      <div className="flex flex-wrap gap-1">
        {['all', ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`px-3 py-1 text-xs rounded-full capitalize transition-colors ${
              category === c ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {strategies.map((s) => {
          const isExp = expanded === s.id;
          return (
            <div key={s.id} className="lens-card">
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setExpanded(isExp ? null : s.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">{s.name}</p>
                  <span className="inline-block text-xs bg-neon-purple/10 text-neon-purple px-2 py-0.5 rounded mt-1 capitalize">
                    {s.category}
                  </span>
                </div>
                {isExp ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
              </div>
              {isExp && (
                <div className="mt-3 pt-3 border-t border-gray-700/30 space-y-2 text-xs">
                  <p><span className="text-neon-cyan">When:</span> <span className="text-gray-300">{s.when}</span></p>
                  <p><span className="text-neon-green">How:</span> <span className="text-gray-300">{s.how}</span></p>
                </div>
              )}
            </div>
          );
        })}
        {strategies.length === 0 && (
          <p className="text-center py-6 text-gray-500 text-sm">No strategies in this category.</p>
        )}
      </div>
    </div>
  );
}
