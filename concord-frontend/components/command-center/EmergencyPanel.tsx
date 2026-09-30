'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Pause, Play, Save, Trash2, XCircle
} from 'lucide-react';
import { ConfirmButton } from '@/components/command-center/cc-primitives';


export function EmergencyPanel() {
  const qc = useQueryClient();
  const settingsMutation = useMutation({ mutationFn: (updates: Record<string, unknown>) => apiHelpers.macros.run('settings.update', updates), onSuccess: () => qc.invalidateQueries(), onError: (err) => console.error('Emergency settings update failed:', err instanceof Error ? err.message : err) });
  const saveMutation = useMutation({ mutationFn: () => apiHelpers.db.sync(), onError: (err) => console.error('State save failed:', err instanceof Error ? err.message : err) });
  const flushMutation = useMutation({ mutationFn: () => apiHelpers.perf.gc(), onError: (err) => console.error('Queue flush failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Emergency Controls</h3>
      <div className="space-y-3">
        <ConfirmButton label="Pause All Processing" icon={Pause} color="red"
          description="Stops autogen, heartbeat, global tick, meta-derivation. User-facing requests still work."
          onConfirm={() => settingsMutation.mutate({ autogenEnabled: false, heartbeatEnabled: false })} />
        <ConfirmButton label="Disable Registration" icon={XCircle} color="red"
          description="No new user signups. Existing users unaffected."
          onConfirm={() => settingsMutation.mutate({ registrationEnabled: false })} />
        <ConfirmButton label="Force State Save" icon={Save} color="yellow"
          description="Immediately saves current state to disk."
          onConfirm={() => saveMutation.mutate()} />
        <ConfirmButton label="Flush LLM Queue" icon={Trash2} color="red"
          description="Drops all pending LLM calls. Active calls finish."
          onConfirm={() => flushMutation.mutate()} />
        <ConfirmButton label="Resume All" icon={Play} color="green"
          description="Restarts autogen, heartbeat, and all background processing."
          onConfirm={() => settingsMutation.mutate({ autogenEnabled: true, heartbeatEnabled: true })} />
      </div>
    </div>
  );
}
