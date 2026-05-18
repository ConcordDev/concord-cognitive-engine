'use client';

import type { BrowserBudget, BrowserTask } from '@/lib/api/browser-agent';
import { Coins, Calendar, Zap } from 'lucide-react';

interface Props {
  task: BrowserTask | null;
  budget: BrowserBudget & { dailySpentCents?: number; monthlySpentCents?: number; concurrentActive?: number };
}

function Bar({ used, cap, color }: { used: number; cap: number; color: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  return (
    <div className="h-2 bg-white/5 rounded relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function BrowserCostMeter({ task, budget }: Props) {
  const dailySpent = budget.dailySpentCents ?? 0;
  const monthlySpent = budget.monthlySpentCents ?? 0;
  const concurrent = budget.concurrentActive ?? 0;

  return (
    <div className="p-3 space-y-3 border-b border-white/10">
      <h3 className="text-xs uppercase tracking-wide text-white/40 flex items-center gap-1">
        <Coins className="w-3 h-3" /> Cost
      </h3>

      {task && (
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-white/70">This task</span>
            <span className="text-white font-mono">{task.total_cost_cents}¢ / {task.max_cost_cents ?? budget.per_task_default_cents}¢</span>
          </div>
          <Bar used={task.total_cost_cents} cap={task.max_cost_cents ?? budget.per_task_default_cents} color="#22d3ee" />
          <div className="mt-1 text-xs text-white/40 flex items-center justify-between">
            <span>{task.total_steps} / {task.max_steps} steps</span>
            {task.total_tokens > 0 && <span>{task.total_tokens} tokens</span>}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-white/70 flex items-center gap-1"><Calendar className="w-3 h-3" /> Today</span>
          <span className="text-white font-mono">${(dailySpent / 100).toFixed(2)} / ${(budget.daily_cents_cap / 100).toFixed(2)}</span>
        </div>
        <Bar used={dailySpent} cap={budget.daily_cents_cap} color={dailySpent > budget.daily_cents_cap * 0.8 ? "#f59e0b" : "#06b6d4"} />
      </div>

      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-white/70">Month</span>
          <span className="text-white font-mono">${(monthlySpent / 100).toFixed(2)} / ${(budget.monthly_cents_cap / 100).toFixed(2)}</span>
        </div>
        <Bar used={monthlySpent} cap={budget.monthly_cents_cap} color={monthlySpent > budget.monthly_cents_cap * 0.8 ? "#f59e0b" : "#06b6d4"} />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-white/70 flex items-center gap-1"><Zap className="w-3 h-3" /> Concurrent</span>
        <span className={`font-mono ${concurrent >= budget.concurrent_task_max ? 'text-amber-300' : 'text-white'}`}>{concurrent} / {budget.concurrent_task_max}</span>
      </div>
    </div>
  );
}
