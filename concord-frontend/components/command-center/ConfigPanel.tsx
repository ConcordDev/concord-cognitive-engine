'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Settings
} from 'lucide-react';


export function ConfigPanel() {
  const qc = useQueryClient();
  const settingsMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) => apiHelpers.macros.run('settings.update', updates),
    onSuccess: () => qc.invalidateQueries(),
    onError: (err) => console.error('Settings update failed:', err instanceof Error ? err.message : err),
  });

  const settings = [
    { key: 'heartbeatEnabled', label: 'Heartbeat', type: 'boolean' as const },
    { key: 'heartbeatMs', label: 'Heartbeat Interval (ms)', type: 'number' as const, min: 2000, max: 120000 },
    { key: 'globalTickMs', label: 'Global Tick (ms)', type: 'number' as const, min: 60000, max: 600000 },
    { key: 'autogenEnabled', label: 'Autogen', type: 'boolean' as const },
    { key: 'registrationEnabled', label: 'Registration', type: 'boolean' as const },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Configuration</h3>
      <div className="space-y-2">
        {settings.map(s => (
          <div key={s.key} className="flex items-center justify-between bg-lattice-surface rounded p-2.5 border border-lattice-border">
            <span className="text-sm text-gray-300">{s.label}</span>
            {s.type === 'boolean' ? (
              <button
                onClick={() => settingsMutation.mutate({ [s.key]: true })}
                disabled={settingsMutation.isPending}
                className="text-xs px-2 py-1 rounded bg-neon-green/20 text-neon-green border border-neon-green/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {settingsMutation.isPending ? '...' : 'Toggle'}
              </button>
            ) : (
              <span className="text-xs text-gray-400">{s.min}–{s.max}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
