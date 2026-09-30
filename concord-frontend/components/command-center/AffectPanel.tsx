'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';


export function AffectPanel() {
  const { data } = useQuery({
    queryKey: ['cc-affect-state'],
    queryFn: () => api.get('/api/affect/state').then(r => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  const state = data?.state;
  if (!state) return <p className="text-xs text-gray-400">Affect state unavailable</p>;

  const dims = [
    { key: 'v', label: 'Valence', color: 'bg-pink-400' },
    { key: 'a', label: 'Arousal', color: 'bg-orange-400' },
    { key: 's', label: 'Stability', color: 'bg-green-400' },
    { key: 'c', label: 'Coherence', color: 'bg-blue-400' },
    { key: 'g', label: 'Agency', color: 'bg-purple-400' },
    { key: 't', label: 'Trust', color: 'bg-cyan-400' },
    { key: 'f', label: 'Fatigue', color: 'bg-yellow-400' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Affect Engine</h3>

      {/* Mood projection */}
      <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border">
        <p className="text-xs text-gray-400 mb-1">Current Mood</p>
        <p className="text-sm font-semibold text-white capitalize">{state.label || 'Unknown'}</p>
        {state.summary && <p className="text-[10px] text-gray-400 mt-0.5">{state.summary}</p>}
        {state.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {state.tags.map((tag: string) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-lattice-elevated text-gray-300 border border-lattice-border">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* 7-dimension bars */}
      <div className="space-y-2">
        {dims.map(d => (
          <div key={d.key} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-gray-400">{d.label}</span>
            <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${d.color}`} style={{ width: `${Math.max(2, (state[d.key] ?? 0) * 100)}%` }} />
            </div>
            <span className="w-8 text-right text-gray-400 font-mono">{((state[d.key] ?? 0) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
