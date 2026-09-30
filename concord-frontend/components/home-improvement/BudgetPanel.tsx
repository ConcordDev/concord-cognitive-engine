'use client';

/**
 * Budget panel — aggregates from real project-list spent/budget fields.
 * Extracted from page.tsx; no invented macros.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { lensRun } from '@/lib/api/client';
import { DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DOMAIN, cardVariants, type HiProject } from './hi-shared';

export function BudgetPanel() {
  const [projects, setProjects] = useState<HiProject[]>([]);

  const loadProjects = useCallback(async () => {
    const { data } = await lensRun<{ projects: HiProject[] }>(DOMAIN, 'project-list', {});
    if (data.ok && data.result) setProjects(data.result.projects || []);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadProjects(); }, []);

  const stats = useMemo(() => ({
    totalBudget: projects.reduce((s, p) => s + (p.budget || 0), 0),
    totalSpent: projects.reduce((s, p) => s + (p.spent || 0), 0),
  }), [projects]);

  const budgetRemaining = stats.totalBudget - stats.totalSpent;
  const budgetPercent = stats.totalBudget > 0 ? (stats.totalSpent / stats.totalBudget) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="panel p-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4 text-neon-green" />Budget Overview</h2>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase">Budget</p>
            <p className="text-xl font-bold text-neon-green">${stats.totalBudget.toLocaleString()}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase">Spent</p>
            <p className="text-xl font-bold text-red-400">${stats.totalSpent.toLocaleString()}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase">Remaining</p>
            <p className={cn('text-xl font-bold', budgetRemaining >= 0 ? 'text-neon-cyan' : 'text-red-400')}>
              ${Math.abs(budgetRemaining).toLocaleString()}{budgetRemaining < 0 ? ' over' : ''}
            </p>
          </div>
        </div>
        <div className="h-4 bg-lattice-deep rounded-full overflow-hidden mb-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(budgetPercent, 100)}%` }}
            transition={{ duration: 0.8 }}
            className={cn('h-full rounded-full', budgetPercent > 100 ? 'bg-red-400' : budgetPercent > 80 ? 'bg-yellow-400' : 'bg-neon-green')}
          />
        </div>
        <p className="text-xs text-gray-400 text-right">{budgetPercent.toFixed(1)}% spent</p>
      </div>

      <div className="panel p-4">
        <h3 className="font-semibold mb-4">Budget vs Actual by Project</h3>
        <div className="space-y-3">
          {projects.filter(p => p.budget > 0).map((p, i) => {
            const pct = (p.spent || 0) / p.budget * 100;
            return (
              <motion.div
                key={p.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
              >
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-white truncate">{p.name}</span>
                  <span className="text-xs text-gray-400">${(p.spent || 0).toLocaleString()} / ${p.budget.toLocaleString()}</span>
                </div>
                <div className="h-2.5 bg-lattice-deep rounded-full overflow-hidden relative">
                  <div className="absolute inset-0 bg-neon-green/10 rounded-full" style={{ width: '100%' }} />
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(pct, 100)}%` }}
                    transition={{ duration: 0.6, delay: i * 0.1 }}
                    className={cn('h-full rounded-full relative z-10', pct > 100 ? 'bg-red-400' : pct > 80 ? 'bg-yellow-400' : 'bg-neon-green')}
                  />
                </div>
              </motion.div>
            );
          })}
          {projects.filter(p => p.budget > 0).length === 0 && (
            <p className="text-gray-400 text-sm text-center py-4">No projects with budgets yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
