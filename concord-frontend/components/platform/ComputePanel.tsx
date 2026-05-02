'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Cpu, Play, ChevronDown, AlertTriangle, Loader2 } from 'lucide-react';

interface ComputeModule {
  name: string;
  description: string;
}

function ComputePanel() {
  const [selectedModule, setSelectedModule] = useState('');
  const [fnName, setFnName] = useState('');
  const [argsText, setArgsText] = useState('[]');
  const [result, setResult] = useState<unknown>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const {
    data: modulesData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['compute-modules'],
    queryFn: () => api.get('/api/compute/modules').then((r) => r.data),
  });

  const runMutation = useMutation({
    mutationFn: (payload: { module: string; fn: string; args: unknown[] }) =>
      api.post('/api/compute/run', payload).then((r) => r.data),
    onSuccess: (data) => {
      setResult(data.result);
      setRunError(null);
    },
    onError: (err: Error) => {
      setRunError(err.message);
      setResult(null);
    },
  });

  const modules: ComputeModule[] = modulesData?.modules ?? [];

  const handleRun = () => {
    if (!selectedModule || !fnName.trim()) return;
    let args: unknown[] = [];
    try {
      args = JSON.parse(argsText);
      if (!Array.isArray(args)) args = [args];
    } catch {
      setRunError('Args must be a valid JSON array');
      return;
    }
    setRunError(null);
    runMutation.mutate({ module: selectedModule, fn: fnName.trim(), args });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Cpu className="w-6 h-6 text-neon-blue" />
        <h2 className="text-xl font-bold text-gray-100">Compute Engine</h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-neon-blue/10 text-neon-blue border border-neon-blue/20">
          Run Modules
        </span>
      </div>

      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5 space-y-4">
        {/* Module selector */}
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Module</label>
          {isLoading ? (
            <div className="h-10 bg-lattice-deep animate-pulse rounded-lg" />
          ) : isError ? (
            <div className="flex items-center gap-2 text-sm text-neon-orange px-3 py-2 bg-neon-orange/5 border border-neon-orange/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Failed to load modules
            </div>
          ) : (
            <div className="relative">
              <select
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                className="w-full appearance-none bg-lattice-deep border border-lattice-border rounded-lg px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-neon-blue/50 pr-10"
              >
                <option value="">— Select a module —</option>
                {modules.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            </div>
          )}
          {selectedModule && modules.find((m) => m.name === selectedModule)?.description && (
            <p className="mt-1.5 text-xs text-gray-500">
              {modules.find((m) => m.name === selectedModule)?.description}
            </p>
          )}
        </div>

        {/* Function name */}
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Function Name</label>
          <input
            type="text"
            value={fnName}
            onChange={(e) => setFnName(e.target.value)}
            placeholder="e.g. add, multiply, transform"
            className="w-full bg-lattice-deep border border-lattice-border rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-blue/50"
          />
        </div>

        {/* Args */}
        <div>
          <label className="text-xs text-gray-400 block mb-1.5">Arguments (JSON array)</label>
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            rows={3}
            placeholder='[1, 2, "example"]'
            className="w-full bg-lattice-deep border border-lattice-border rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-blue/50 font-mono resize-none"
          />
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={!selectedModule || !fnName.trim() || runMutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-neon-blue/10 text-neon-blue border border-neon-blue/20 rounded-lg text-sm font-medium hover:bg-neon-blue/20 disabled:opacity-50 transition-colors"
        >
          {runMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" /> Run
            </>
          )}
        </button>
      </div>

      {/* Error display */}
      {runError && (
        <div className="flex items-start gap-2 px-4 py-3 bg-neon-orange/5 border border-neon-orange/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-neon-orange shrink-0 mt-0.5" />
          <p className="text-sm text-neon-orange">{runError}</p>
        </div>
      )}

      {/* Result display */}
      {result !== null && (
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-neon-green" />
              Result
            </h3>
            {runMutation.data?.executionMs !== undefined && (
              <span className="text-xs text-gray-500 font-mono">
                {runMutation.data.executionMs}ms
              </span>
            )}
          </div>
          <pre className="bg-lattice-deep rounded-lg p-4 text-sm font-mono text-neon-cyan overflow-auto max-h-64">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedComputePanel = withErrorBoundary(ComputePanel);
export { _WrappedComputePanel as ComputePanel };
export default _WrappedComputePanel;
