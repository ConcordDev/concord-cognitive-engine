'use client';

import { HardDrive, Copy } from 'lucide-react';
import { useDebugDesk } from '@/components/debug/useDebugDesk';

export function InspectorPanel() {
  const {
    inspectType, setInspectType, inspectEntity, setInspectEntity,
    inspectResult, inspectMutation,
  } = useDebugDesk();

  return (
<div className="panel p-4 space-y-4">
  <h2 className="font-semibold flex items-center gap-2">
    <HardDrive className="w-4 h-4 text-neon-blue" />
    Object Inspector
  </h2>
  <div className="flex gap-3">
    <select
      className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
      value={inspectType}
      onChange={(e) => setInspectType(e.target.value)}
    >
      <option value="dtu">DTU</option>
      <option value="artifact">Artifact</option>
      <option value="job">Job</option>
      <option value="listing">Listing</option>
    </select>
    <input
      className="flex-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-blue outline-none font-mono"
      placeholder="Enter entity ID..."
      value={inspectEntity}
      onChange={(e) => setInspectEntity(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && inspectEntity.trim()) {
          inspectMutation.mutate({ type: inspectType, id: inspectEntity.trim() });
        }
      }}
    />
    <button
      className="btn-neon text-sm"
      disabled={!inspectEntity.trim() || inspectMutation.isPending}
      onClick={() =>
        inspectMutation.mutate({ type: inspectType, id: inspectEntity.trim() })
      }
    >
      {inspectMutation.isPending ? 'Inspecting...' : 'Inspect'}
    </button>
  </div>
  {inspectResult != null && (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Result</h3>
        <button
          onClick={() =>
            navigator.clipboard?.writeText(JSON.stringify(inspectResult, null, 2))
          }
          className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
        >
          <Copy className="w-3 h-3" /> Copy
        </button>
      </div>
      <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-[400px] text-xs font-mono text-gray-300">
        {JSON.stringify(inspectResult, null, 2)}
      </pre>
    </div>
  )}
</div>

  );
}
