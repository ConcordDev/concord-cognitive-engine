'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  MapPin
} from 'lucide-react';
import { StatusDot, DISTRICT_META } from '@/components/command-center/cc-primitives';


export function EmergentPanel() {
  const { data } = useQuery({ queryKey: ['cc-emergents'], queryFn: () => apiHelpers.macros.run('emergent.list').then(r => r.data).catch((err) => { console.error('Failed to fetch emergents:', err instanceof Error ? err.message : err); return { emergents: [] }; }), refetchInterval: 30000 });
  const { data: censusData } = useQuery({ queryKey: ['cc-census'], queryFn: () => apiHelpers.macros.run('emergent.district.census').then(r => r.data).catch((err) => { console.error('Failed to fetch census:', err instanceof Error ? err.message : err); return { census: {} }; }), refetchInterval: 30000 });

  const emergents = (data?.emergents || []) as Array<{ id: string; name: string; role: string; district?: string; instanceScope?: string; active: boolean; createdAt: string }>;
  const census = (censusData?.census || {}) as Record<string, Array<{ id: string; name: string; role: string }>>;
  const global = emergents.filter(e => (e.instanceScope || 'local') === 'global');
  const local = emergents.filter(e => (e.instanceScope || 'local') === 'local');

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Emergent Manager</h3>

      {/* District Map */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> District Map</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(DISTRICT_META).map(([id, meta]) => {
            const residents = census[id] || [];
            return (
              <div key={id} className="bg-lattice-surface rounded-lg p-2 border border-lattice-border">
                <p className={`text-xs font-semibold ${meta.color}`}>{meta.label}</p>
                <p className="text-[10px] text-gray-400">{meta.icon}</p>
                <p className="text-lg font-mono font-bold text-white mt-1">{residents.length}</p>
                {residents.slice(0, 3).map(r => (
                  <p key={r.id} className="text-[10px] text-gray-400 truncate">{r.name}</p>
                ))}
                {residents.length > 3 && <p className="text-[10px] text-gray-400">+{residents.length - 3} more</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Global Emergents */}
      {global.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-neon-cyan font-semibold">Global ({global.length})</p>
          {global.map(e => (
            <div key={e.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-sm">
              <StatusDot status={e.active ? 'green' : 'gray'} />
              <span className="text-white font-medium flex-1 truncate">{e.name}</span>
              <span className={`text-[10px] ${DISTRICT_META[e.district || 'commons']?.color || 'text-gray-400'}`}>{DISTRICT_META[e.district || 'commons']?.label || e.district}</span>
              <span className="text-xs text-gray-400">{e.role}</span>
            </div>
          ))}
        </div>
      )}

      {/* Local Emergents */}
      <div className="space-y-2">
        <p className="text-xs text-neon-purple font-semibold">Local ({local.length})</p>
        {local.slice(0, 20).map(e => (
          <div key={e.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-sm">
            <StatusDot status={e.active ? 'green' : 'gray'} />
            <span className="text-white font-medium flex-1 truncate">{e.name}</span>
            <span className={`text-[10px] ${DISTRICT_META[e.district || 'commons']?.color || 'text-gray-400'}`}>{DISTRICT_META[e.district || 'commons']?.label || e.district}</span>
            <span className="text-xs text-gray-400">{e.role}</span>
          </div>
        ))}
        {local.length > 20 && <p className="text-xs text-gray-400">+ {local.length - 20} more</p>}
      </div>
    </div>
  );
}
