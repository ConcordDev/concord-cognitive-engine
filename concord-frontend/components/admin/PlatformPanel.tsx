'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Box, Cpu, Download, Globe, Power, Search, Shield, Zap } from 'lucide-react';

export function PlatformPanel() {
  return (
    <div className="space-y-8">
      <PluginManagerSection />
      <MacroExplorerSection />
      <QualitySection />
      <PipelineSection />
      <ExtensionSection />
    </div>
  );
}

function PluginManagerSection() {
  const { data: pluginData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-plugins'],
    queryFn: () => apiHelpers.plugins.list().then((r) => r.data),
  });
  const { data: metricsData } = useQuery({
    queryKey: ['admin-plugins-metrics'],
    queryFn: () => apiHelpers.plugins.metrics().then((r) => r.data),
    retry: false,
  });

  const plugins = pluginData?.plugins || [];
  const metrics = metricsData;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Box className="w-4 h-4" /> Plugins
      </h2>
      {isLoading && <Skeleton variant="block" height={80} />}
      {isError && (
        <ErrorState
          variant="inline"
          message={error instanceof Error ? error.message : 'Failed to list plugins'}
          onRetry={() => void refetch()}
        />
      )}
      {!isLoading && !isError && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat n={metrics?.loadedCount ?? plugins.length} label="Loaded" />
            <Stat n={metrics?.pendingGovernanceCount ?? 0} label="Pending" />
            <Stat n={metrics?.metrics?.totalHookCalls ?? 0} label="Hook calls" />
            <Stat n={metrics?.metrics?.totalMacroCalls ?? 0} label="Macro calls" />
          </div>
          {plugins.length === 0 ? (
            <EmptyState title="No plugins installed" compact />
          ) : (
            <div className="space-y-2">
              {plugins.map(
                (plugin: {
                  id: string;
                  name: string;
                  version?: string;
                  description?: string;
                  isEmergentGen?: boolean;
                  macros?: string[];
                  hooks?: string[];
                }) => (
                  <div
                    key={plugin.id}
                    className="p-3 rounded-lg bg-lattice-deep border border-lattice-border flex items-center justify-between"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">{plugin.name || plugin.id}</span>
                        {plugin.version && <span className="text-xs text-gray-400">v{plugin.version}</span>}
                        {plugin.isEmergentGen && (
                          <span className="text-xs px-1.5 py-0.5 bg-white/10 text-gray-300 rounded">emergent</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {plugin.description ||
                          `${(plugin.macros || []).length} macros, ${(plugin.hooks || []).length} hooks`}
                      </p>
                    </div>
                    <Power className="w-4 h-4 text-green-400" />
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MacroExplorerSection() {
  const [macroSearch, setMacroSearch] = useState('');
  const { data: macroData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-macros-all'],
    queryFn: () => apiHelpers.adminMacros.all().then((r) => r.data),
  });

  const macros = useMemo(() => macroData?.macros || [], [macroData?.macros]);
  const domainCount = macroData?.domainCount || 0;
  const totalMacros = macroData?.totalMacros || macros.length;

  const grouped = useMemo(() => {
    const searchLower = macroSearch.toLowerCase();
    const filtered = macros.filter(
      (m: { name: string; domain: string; description?: string }) =>
        !macroSearch ||
        m.name.toLowerCase().includes(searchLower) ||
        m.domain.toLowerCase().includes(searchLower) ||
        (m.description || '').toLowerCase().includes(searchLower),
    );
    const groups: Record<
      string,
      Array<{ name: string; domain: string; description?: string; public?: boolean; plugin?: string | null }>
    > = {};
    for (const m of filtered) {
      if (!groups[m.domain]) groups[m.domain] = [];
      groups[m.domain].push(m);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [macros, macroSearch]);

  return (
    <section className="space-y-3" data-lens-theme="admin">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4" /> Macros
        </h2>
        <p className="text-xs text-gray-400 font-mono">
          {totalMacros} across {domainCount} domains
        </p>
      </div>
      {isLoading && <Skeleton variant="block" height={120} />}
      {isError && (
        <ErrorState
          variant="inline"
          message={error instanceof Error ? error.message : 'Failed to load macros'}
          onRetry={() => void refetch()}
        />
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          value={macroSearch}
          onChange={(e) => setMacroSearch(e.target.value)}
          placeholder="Search macros by name, domain, or description…"
          className={`${ds.input} pl-10`}
        />
      </div>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {grouped.length === 0 && !isLoading ? (
          <EmptyState title="No macros match" description="Try a different search." compact />
        ) : (
          grouped.map(([domain, domainMacros]) => (
            <div key={domain}>
              <div className="flex items-center gap-2 mb-1.5">
                <Zap className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-medium text-gray-300 uppercase tracking-wider">{domain}</span>
                <span className="text-xs text-gray-500">({domainMacros.length})</span>
              </div>
              <div className="space-y-1 ml-5">
                {domainMacros.map((m) => (
                  <div
                    key={`${m.domain}.${m.name}`}
                    className="flex items-center justify-between py-1.5 px-2 rounded bg-lattice-deep/50 hover:bg-lattice-deep"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-white font-mono">{m.name}</span>
                      {m.description && (
                        <span className="text-xs text-gray-400 ml-2 truncate">{m.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {m.plugin && (
                        <span className="text-xs px-1.5 py-0.5 bg-white/10 text-gray-300 rounded">plugin</span>
                      )}
                      {m.public && (
                        <span className="text-xs px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded">public</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function QualitySection() {
  const { data: qualityData } = useQuery({
    queryKey: ['admin-quality-thresholds'],
    queryFn: () => api.get('/api/quality/thresholds').then((r) => r.data),
    refetchInterval: 30000,
  });
  const { data: flywheelData } = useQuery({
    queryKey: ['admin-flywheel'],
    queryFn: () => api.get('/api/flywheel/metrics').then((r) => r.data),
    refetchInterval: 30000,
  });
  const { data: flywheelHistoryData } = useQuery({
    queryKey: ['admin-flywheel-history'],
    queryFn: () => api.get('/api/flywheel/history').then((r) => r.data),
    refetchInterval: 60000,
  });

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Shield className="w-4 h-4" /> Quality & flywheel
      </h2>
      {qualityData ? (
        <pre className="text-xs text-gray-300 p-3 bg-lattice-deep rounded-lg border border-lattice-border overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(qualityData, null, 2)}
        </pre>
      ) : (
        <p className="text-sm text-gray-400">Loading quality thresholds…</p>
      )}
      {flywheelData && (
        <div className="p-3 bg-lattice-deep rounded-lg border border-lattice-border">
          <p className="text-xs text-gray-400 mb-1">Flywheel velocity</p>
          <p className="text-lg font-mono tabular-nums text-white">
            {Math.round((flywheelData.velocity ?? flywheelData.metrics?.velocity ?? 0) * 100)}%
          </p>
        </div>
      )}
      {flywheelHistoryData?.history?.length > 0 && (
        <div className="p-3 bg-lattice-deep rounded-lg border border-lattice-border space-y-2">
          <p className="text-xs text-gray-400 font-medium">Flywheel history</p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {flywheelHistoryData.history.map(
              (
                entry: { timestamp?: string; date?: string; velocity?: number; score?: number },
                idx: number,
              ) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{entry.timestamp ?? entry.date ?? `Entry ${idx + 1}`}</span>
                  <span className="text-white font-mono">
                    {Math.round((entry.velocity ?? entry.score ?? 0) * 100)}%
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PipelineSection() {
  const { data: pipelineExecsData } = useQuery({
    queryKey: ['admin-pipeline-executions'],
    queryFn: () => api.get('/api/pipeline/executions').then((r) => r.data),
    refetchInterval: 30000,
  });
  const executions = pipelineExecsData?.executions || [];
  if (executions.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Cpu className="w-4 h-4" /> Pipeline executions
        </h2>
        <EmptyState title="No pipeline executions" description="/api/pipeline/executions is empty." compact />
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Cpu className="w-4 h-4" /> Pipeline executions
      </h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {executions.map(
          (
            exec: { id: string; name?: string; status?: string; startedAt?: string; duration?: number },
            idx: number,
          ) => (
            <div
              key={exec.id ?? idx}
              className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg border border-lattice-border"
            >
              <div>
                <p className="text-sm text-white font-medium">{exec.name ?? exec.id}</p>
                {exec.startedAt && <p className="text-xs text-gray-400">{exec.startedAt}</p>}
              </div>
              <div className="flex items-center gap-2">
                {exec.duration !== undefined && (
                  <span className="text-xs text-gray-400 font-mono">{exec.duration}ms</span>
                )}
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    exec.status === 'success'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : exec.status === 'failed'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                  }`}
                >
                  {exec.status ?? 'unknown'}
                </span>
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function ExtensionSection() {
  return (
    <section className={ds.panel}>
      <h2 className="font-semibold mb-2 flex items-center gap-2 text-sm">
        <Globe className="w-4 h-4" /> Browser extension
      </h2>
      <p className="text-sm text-gray-400 mb-3">
        Install the Concord Lens browser extension for structural truth overlays. The installer page is not
        shipped yet — this is an honest placeholder, not a live download.
      </p>
      <div className="flex items-center gap-3">
        {/* @broken-link-ok: extension installer page not yet built; the
            button is a placeholder until the extension ships. */}
        <a
          href="#extension-installer-coming-soon"
          className="flex items-center gap-2 px-4 py-2 border border-lattice-border rounded-lg hover:bg-white/5 text-sm"
        >
          <Download className="w-4 h-4" />
          Install Concord Browser Extension
        </a>
        <span className="text-xs text-gray-500">v0.1.0 — Chrome / Firefox (Manifest V3)</span>
      </div>
    </section>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="p-3 rounded-lg bg-lattice-deep border border-lattice-border text-center">
      <p className="text-xl font-mono tabular-nums text-white">{n}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
