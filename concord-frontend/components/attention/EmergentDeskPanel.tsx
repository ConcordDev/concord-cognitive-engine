'use client';

/**
 * Emergent cognition desk — attention allocation, entities, dream,
 * forgetting, repair cortex, growth dashboard, and AttentionThreads.
 * Extracted verbatim from the welded attention page stack.
 */

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useMemo } from 'react';
import {
  Activity, Brain, Cpu, Clock, Zap,
} from 'lucide-react';
import { AttentionThreads } from '@/components/attention/AttentionThreads';
import { AttentionPanel as EmergentAttentionPanel } from '@/components/emergent/AttentionPanel';
import { DreamPanel } from '@/components/emergent/DreamPanel';
import { ForgettingPanel } from '@/components/emergent/ForgettingPanel';
import { RepairPanel } from '@/components/emergent/RepairPanel';
import { EmergentCard, type EmergentEntity } from '@/components/emergent/EmergentCard';
import { EmergentPanel } from '@/components/emergent/EmergentPanel';
import { EntityGrowthDashboard } from '@/components/emergent/EntityGrowthDashboard';

interface Thread {
  id: string;
  type: string;
  priority: number;
  status: string;
  description: string;
  createdAt: string;
}

export function EmergentDeskPanel() {
  const { data: threads } = useQuery({
    queryKey: ['attention-threads'],
    queryFn: () => apiHelpers.attention.threads().then((r) => r.data),
    refetchInterval: 5000,
  });
  const threadList: Thread[] = useMemo(() => threads?.threads || [], [threads]);
  const activeThreads = threadList.filter(t => t.status === 'active');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan" /> Attention Allocation
          </h2>
          <EmergentAttentionPanel />
        </div>

        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Brain className="w-4 h-4 text-neon-purple" /> Emergent Entities
          </h2>
          <EmergentPanel />
          {activeThreads.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Active Thread Entities</p>
              {activeThreads.map(t => (
                <EmergentCard
                  key={t.id}
                  emergent={{
                    id: t.id,
                    role: t.type === 'creative' ? 'builder' : t.type === 'analysis' ? 'critic' : 'synthesizer',
                    name: `${t.type}: ${t.description}`,
                    active: true,
                    state: 'active',
                  } as EmergentEntity}
                />
              ))}
            </div>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-neon-blue" /> Dream Journal
          </h2>
          <DreamPanel />
        </div>

        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-neon-yellow" /> Forgetting Engine
          </h2>
          <ForgettingPanel />
        </div>

        <div className="panel p-4 border border-orange-500/20">
          <h2
            id="repair-cortex"
            tabIndex={-1}
            className="font-semibold mb-3 flex items-center gap-2 scroll-mt-20 focus:outline-none"
          >
            <Zap className="w-4 h-4 text-neon-green" /> Repair Cortex
          </h2>
          <RepairPanel />
        </div>
      </div>

      <div className="panel p-4">
        <EntityGrowthDashboard />
      </div>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <AttentionThreads />
      </section>
    </div>
  );
}
