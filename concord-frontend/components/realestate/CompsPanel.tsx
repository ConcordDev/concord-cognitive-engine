'use client';

/**
 * Comps desk — CMA from the user's tracked listings (cma_generate),
 * side-by-side compare, and AVM. Honest: no MLS-wide fabricated comps.
 */

import { useState } from 'react';
import { BarChart3, Columns3, Calculator } from 'lucide-react';
import { cn } from '@/lib/utils';
import CMAPanel from './CMAPanel';
import PropertyCompare from './PropertyCompare';
import AVMEstimator from './AVMEstimator';
import { useRealEstateSelection } from './RealEstateContext';

type CompsTool = 'cma' | 'compare' | 'avm';

const TOOLS: { id: CompsTool; label: string; icon: typeof BarChart3; hint: string }[] = [
  { id: 'cma', label: 'CMA', icon: BarChart3, hint: 'from your tracked listings' },
  { id: 'compare', label: 'Compare', icon: Columns3, hint: 'side-by-side' },
  { id: 'avm', label: 'AVM', icon: Calculator, hint: 'estimate' },
];

export function CompsPanel() {
  const [tool, setTool] = useState<CompsTool>('cma');
  const { comparePicks, togglePick, clearPicks } = useRealEstateSelection();

  return (
    <div className="space-y-3">
      <nav className="flex items-center gap-1" aria-label="Comps tools">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const on = tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border',
                on
                  ? 'border-[var(--lens-accent)]/40 bg-[var(--lens-accent)]/15 text-[var(--lens-secondary)]'
                  : 'border-transparent text-gray-400 hover:text-white',
              )}
              aria-current={on ? 'page' : undefined}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              <span className="hidden sm:inline text-[10px] text-gray-500">{t.hint}</span>
            </button>
          );
        })}
      </nav>

      {tool === 'cma' && <CMAPanel />}
      {tool === 'compare' && (
        <PropertyCompare
          ids={comparePicks}
          onClear={clearPicks}
          onRemove={togglePick}
        />
      )}
      {tool === 'avm' && <AVMEstimator />}
    </div>
  );
}

export default CompsPanel;
