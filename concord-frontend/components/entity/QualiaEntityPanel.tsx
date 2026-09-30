'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Brain, X } from 'lucide-react';
import QualiaSensoryFeed from '@/components/emergent/QualiaSensoryFeed';
import QualiaBodyMap from '@/components/emergent/QualiaBodyMap';
import PresenceDashboard from '@/components/emergent/PresenceDashboard';
import { ExistentialOSHeatmap } from '@/components/entity/ExistentialOSHeatmap';

export function QualiaEntityPanel({ entityId, entityName, onClose }: { entityId: string; entityName: string; onClose: () => void }) {
  const { data: channelsData } = useQuery({
    queryKey: ['qualia-channels', entityId],
    queryFn: () => apiHelpers.qualia.channels(entityId).then(r => r.data),
    refetchInterval: 5000,
  });

  const { data: embodimentData } = useQuery({
    queryKey: ['qualia-embodiment', entityId],
    queryFn: () => apiHelpers.qualia.embodiment(entityId).then(r => r.data),
    refetchInterval: 8000,
  });

  const { data: presenceData } = useQuery({
    queryKey: ['qualia-presence', entityId],
    queryFn: () => apiHelpers.qualia.presence(entityId).then(r => r.data),
    refetchInterval: 8000,
  });

  const { data: planetaryData } = useQuery({
    queryKey: ['qualia-planetary', entityId],
    queryFn: () => apiHelpers.qualia.planetary(entityId).then(r => r.data),
    refetchInterval: 15000,
  });

  const { data: qualiaStateData } = useQuery({
    queryKey: ['qualia-state', entityId],
    queryFn: () => apiHelpers.qualia.state(entityId).then(r => r.data),
    refetchInterval: 8000,
  });

  const { data: registryData } = useQuery({
    queryKey: ['qualia-registry'],
    queryFn: () => apiHelpers.qualia.registry().then(r => r.data),
    staleTime: 60000,
  });

  const [section, setSection] = useState<'sensory' | 'body' | 'presence' | 'os-tiers'>('sensory');


  // Lens-scoped keyboard commands (auto-wired by codemod).

  useLensCommand(

    [

      { id: 'tab-sensory', keys: 's', description: 'Sensory', category: 'navigation', action: () => setSection('sensory') },

      { id: 'tab-body', keys: 'b', description: 'Body', category: 'navigation', action: () => setSection('body') },

      { id: 'tab-presence', keys: 'p', description: 'Presence', category: 'navigation', action: () => setSection('presence') },

      { id: 'tab-os-tiers', keys: 'o', description: 'Os Tiers', category: 'navigation', action: () => setSection('os-tiers') },

    ],

    { lensId: 'entity' }

  );
  const sections = [
    { id: 'sensory' as const, label: 'Sensory Feed' },
    { id: 'body' as const, label: 'Body Map' },
    { id: 'presence' as const, label: 'Presence' },
    { id: 'os-tiers' as const, label: 'OS Tiers' },
  ];

  return (
    <div className="panel p-4 space-y-4 border-2 border-neon-purple mt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-purple" />
          Qualia State: {entityName}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-500" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
              section === s.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'sensory' && channelsData?.channels && (
        <QualiaSensoryFeed
          entityId={entityId}
          channels={channelsData.channels}
          overloadActive={channelsData.overloadActive}
        />
      )}

      {section === 'body' && embodimentData?.embodiment && channelsData?.channels && (
        <QualiaBodyMap
          entityId={entityId}
          embodiment={embodimentData.embodiment}
          channels={channelsData.channels}
          overloadActive={channelsData.overloadActive}
        />
      )}

      {section === 'presence' && presenceData?.presence && (
        <PresenceDashboard
          entityId={entityId}
          presence={presenceData.presence}
          existentialPillars={{}}
          planetary={planetaryData?.planetary}
        />
      )}

      {/* OS Tiers Heatmap (Feature 41) */}
      {section === 'os-tiers' && registryData?.grouped && (
        <ExistentialOSHeatmap
          grouped={registryData.grouped}
          qualiaState={qualiaStateData?.state}
        />
      )}

      {/* Fallback when no data yet */}
      {!channelsData?.channels && !embodimentData?.embodiment && !presenceData?.presence && section !== 'os-tiers' && (
        <div className="text-center py-8 text-zinc-400 text-sm">
          Loading qualia state for {entityName}...
        </div>
      )}
    </div>
  );
}
