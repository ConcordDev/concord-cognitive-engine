'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Focus
} from 'lucide-react';
import { StatusDot, Stat } from '@/components/command-center/cc-primitives';


export function CognitiveEnginesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['cc-cognitive-status'],
    queryFn: () => api.get('/api/cognitive/status').then(r => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  if (isLoading) return <div className="h-32 bg-lattice-deep animate-pulse rounded-lg" />;
  if (!data?.ok) return <p className="text-xs text-gray-400">Cognitive status unavailable</p>;

  const engines = [
    { name: 'Goal System', status: data.goals ? 'active' : 'idle', detail: data.goals ? `${data.goals.activeCount} active / ${data.goals.totalRegistered} total` : null },
    { name: 'Attention', status: data.attention ? 'active' : 'idle', detail: data.attention ? `Focus: ${data.attention.focus || 'none'} | ${data.attention.activeThreads} threads` : null },
    { name: 'Reflection', status: data.reflection ? 'active' : 'idle', detail: data.reflection ? `${data.reflection.reflections} reflections | Cal: ${typeof data.reflection.calibration === 'number' ? data.reflection.calibration.toFixed(2) : '?'}` : null },
    { name: 'Experience Learning', status: data.experience ? 'active' : 'idle', detail: data.experience ? `${data.experience.episodes} episodes | ${data.experience.patterns} patterns` : null },
    { name: 'Hypothesis Engine', status: data.hypothesis ? 'active' : 'idle', detail: data.hypothesis ? `${data.hypothesis.active} active | ${data.hypothesis.confirmed} confirmed` : null },
    { name: 'Metacognition', status: data.metacognition ? 'active' : 'idle', detail: data.metacognition ? `${data.metacognition.predictions} predictions | ${data.metacognition.blindSpots} blind spots` : null },
    { name: 'World Model', status: data.worldModel ? 'active' : 'idle', detail: data.worldModel ? `${data.worldModel.entities} entities | ${data.worldModel.relations} relations` : null },
    { name: 'Reasoning Chains', status: data.reasoning ? 'active' : 'idle', detail: data.reasoning ? `${data.reasoning.chains} chains | ${data.reasoning.steps} steps` : null },
  ];

  const activeCount = engines.filter(e => e.status === 'active').length;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Cognitive Engines</h3>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Active Engines" value={`${activeCount}/${engines.length}`} />
        <Stat label="Active Goals" value={data.goals?.activeCount ?? 0} />
      </div>

      {/* Goal System — current goals */}
      {data.goals?.active?.length > 0 && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-neon-green">Active Goals</p>
          {(data.goals.active as Array<{ id: string; description?: string; priority?: number; status?: string }>).slice(0, 5).map((g: { id: string; description?: string; priority?: number; status?: string }) => (
            <div key={g.id} className="flex items-center gap-2 text-xs">
              <StatusDot status="green" />
              <span className="text-gray-300 flex-1 truncate">{g.description || g.id}</span>
              {g.priority != null && <span className="text-gray-400">P{g.priority}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Reflection self-scores */}
      {data.reflection && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-blue-400">Reflection Self-Model</p>
          {data.reflection.strengths?.length > 0 && (
            <div className="text-[10px] text-green-300">Strengths: {data.reflection.strengths.join(', ')}</div>
          )}
          {data.reflection.weaknesses?.length > 0 && (
            <div className="text-[10px] text-red-300">Weaknesses: {data.reflection.weaknesses.join(', ')}</div>
          )}
        </div>
      )}

      {/* Engine status list */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400">Engine Status</p>
        {engines.map(e => (
          <div key={e.name} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-xs">
            <StatusDot status={e.status === 'active' ? 'green' : 'gray'} />
            <span className="text-white font-medium w-36">{e.name}</span>
            <span className="text-gray-400 flex-1 truncate">{e.detail || 'No data'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
