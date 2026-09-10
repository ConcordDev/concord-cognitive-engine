'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { Bot, Search, Loader2 } from 'lucide-react';

export function AgentStatusPanel() {
  const [researchTopic, setResearchTopic] = useState('');
  const queryClient = useQueryClient();

  const { data: statusData, isLoading } = useQuery({
    queryKey: ['agents-status'],
    queryFn: () => apiHelpers.agents.status().then(r => r.data),
    refetchInterval: 10000,
  });

  const spawnMutation = useMutation({
    mutationFn: (topic: string) => apiHelpers.agents.spawnResearch(topic).then(r => r.data),
    onSuccess: () => {
      setResearchTopic('');
      queryClient.invalidateQueries({ queryKey: ['agents-status'] });
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Entity operation failed. The server may still be loading.' });
    },
  });

  const agents = statusData?.agents || [];
  const active = statusData?.active || 0;
  const paused = statusData?.paused || 0;

  return (
    <div className="panel p-4 space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Bot className="w-4 h-4 text-neon-cyan" />
          Active Agents
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />{active} active</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />{paused} paused</span>
        </div>
      </div>

      {/* Research Spawning */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={researchTopic}
            onChange={e => setResearchTopic(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && researchTopic.trim() && !spawnMutation.isPending) {
                spawnMutation.mutate(researchTopic.trim());
              }
            }}
            placeholder="Research topic X..."
            className="input-lattice w-full pl-9 text-sm"
            disabled={spawnMutation.isPending}
          />
        </div>
        <button
          onClick={() => researchTopic.trim() && spawnMutation.mutate(researchTopic.trim())}
          disabled={!researchTopic.trim() || spawnMutation.isPending}
          className="btn-neon cyan text-sm"
        >
          {spawnMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Spawn Research Agent'}
        </button>
      </div>

      {spawnMutation.data && (
        <div className="bg-zinc-900 rounded p-2 text-xs border border-cyan-900/40">
          <p className="text-cyan-400 font-medium">Agent spawned for &quot;{spawnMutation.data.topic}&quot;</p>
          <p className="text-gray-400">{spawnMutation.data.findingsCount} initial findings from lattice scan</p>
        </div>
      )}

      {/* Agent list */}
      {isLoading ? (
        <p className="text-xs text-gray-400">Loading agents...</p>
      ) : agents.length === 0 ? (
        <p className="text-xs text-gray-400">No agents deployed. Spawn a research agent above.</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {agents.slice(0, 20).map((a: Record<string, unknown>) => (
            <div key={a.agentId as string} className="flex items-center gap-2 text-xs bg-zinc-900 rounded p-2 border border-zinc-800">
              <span className={`w-2 h-2 rounded-full ${a.status === 'active' ? 'bg-green-400' : 'bg-yellow-400'}`} />
              <span className="text-white font-medium capitalize">{a.type as string}</span>
              <span className="text-gray-400 truncate flex-1">{a.territory as string}</span>
              <span className="text-gray-600 tabular-nums">{a.runCount as number} runs</span>
              <span className="text-gray-600 tabular-nums">{a.findingsCount as number} findings</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
