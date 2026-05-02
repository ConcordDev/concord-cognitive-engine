'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Shield,
  Zap,
  ChevronDown,
  ChevronUp,
  Loader2,
  Brain,
  Sparkles,
  Wrench,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BRAIN_ICONS: Record<string, React.ElementType> = {
  'brain.conscious': Brain,
  'brain.subconscious': Sparkles,
  'brain.utility': Wrench,
  'brain.repair': Shield,
  'api.ollama': Zap,
};

const STATUS_COLORS: Record<string, string> = {
  healthy: 'text-green-400',
  degraded: 'text-yellow-400',
  critical: 'text-red-400',
  dead: 'text-gray-500',
  closed: 'text-green-400',
  open: 'text-red-400',
  'half-open': 'text-yellow-400',
};

function NervousSystem({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'pulse' | 'circuits' | 'events' | 'traces' | 'integrity' | 'wisdom'
  >('pulse');
  const queryClient = useQueryClient();

  const { data: pulseData } = useQuery({
    queryKey: ['system-pulse'],
    queryFn: () => api.get('/api/pulse').then((r) => r.data),
    refetchInterval: 10000,
  });

  const { data: circuitData } = useQuery({
    queryKey: ['circuits'],
    queryFn: () => api.get('/api/circuits').then((r) => r.data),
    refetchInterval: 15000,
  });

  const { data: busData } = useQuery({
    queryKey: ['event-bus'],
    queryFn: () => api.get('/api/events/bus?limit=20').then((r) => r.data),
    refetchInterval: 10000,
    enabled: expanded && activeTab === 'events',
  });

  const { data: traceData } = useQuery({
    queryKey: ['traces'],
    queryFn: () => api.get('/api/traces?limit=10').then((r) => r.data),
    enabled: expanded && activeTab === 'traces',
  });

  const { data: integrityData } = useQuery({
    queryKey: ['integrity'],
    queryFn: () => api.get('/api/integrity/check').then((r) => r.data),
    enabled: expanded && activeTab === 'integrity',
  });

  const resetBreaker = useMutation({
    mutationFn: (name: string) => api.post(`/api/circuits/${name}/reset`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['circuits'] }),
  });

  const fixIntegrity = useMutation({
    mutationFn: () => api.post('/api/integrity/fix'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrity'] }),
  });

  const [wisdomQ, setWisdomQ] = useState('');
  const [wisdomResult, setWisdomResult] = useState<{
    synthesis: string;
    domains?: Record<string, unknown>;
    validation?: { severity: string; vulnerabilities?: unknown[] };
  } | null>(null);
  const wisdomMutation = useMutation({
    mutationFn: (q: string) => api.post('/api/wisdom/synthesize', { question: q }),
    onSuccess: (r) => {
      setWisdomResult(r.data);
      setWisdomQ('');
    },
  });

  const overallStatus = pulseData?.status || 'checking';
  const overallScore = pulseData?.score || 0;

  return (
    <div
      className={cn(
        'bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'p-2 rounded-lg',
              overallStatus === 'healthy'
                ? 'bg-green-500/20'
                : overallStatus === 'degraded'
                  ? 'bg-yellow-500/20'
                  : 'bg-red-500/20'
            )}
          >
            <Activity className={cn('w-5 h-5', STATUS_COLORS[overallStatus] || 'text-gray-400')} />
          </div>
          <div>
            <h3 className="font-medium text-white">Nervous System</h3>
            <p className="text-xs text-gray-500">
              System {overallStatus} — score: {overallScore}/100
              {pulseData?.issues?.length > 0 && ` — ${pulseData.issues.length} issues`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Circuit breaker status dots */}
          <div className="flex items-center gap-1">
            {(
              Object.entries(circuitData?.breakers || {}) as [
                string,
                {
                  state: string;
                  stats: { totalCalls: number; totalFailures: number; opens: number };
                },
              ][]
            ).map(([name, breaker]) => (
              <div
                key={name}
                className={cn(
                  'w-2 h-2 rounded-full',
                  breaker.state === 'closed'
                    ? 'bg-green-400'
                    : breaker.state === 'open'
                      ? 'bg-red-400'
                      : 'bg-yellow-400'
                )}
                title={`${name}: ${breaker.state}`}
              />
            ))}
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Component health grid */}
      <div className="p-4 grid grid-cols-5 gap-2">
        {(
          Object.entries(pulseData?.components || {}) as [
            string,
            { status: string; score: number },
          ][]
        ).map(([name, comp]) => {
          const Icon = BRAIN_ICONS[name] || Activity;
          return (
            <div key={name} className="text-center">
              <Icon
                className={cn('w-4 h-4 mx-auto', STATUS_COLORS[comp.status] || 'text-gray-400')}
              />
              <p className="text-[10px] text-gray-500 mt-0.5">{name.replace('brain.', '')}</p>
              <p className={cn('text-xs font-bold', STATUS_COLORS[comp.status])}>{comp.score}</p>
            </div>
          );
        })}
      </div>

      {/* Expanded sections */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Tab bar */}
            <div className="px-4 py-2 border-t border-lattice-border flex items-center gap-2 overflow-x-auto">
              {(['pulse', 'circuits', 'events', 'traces', 'integrity', 'wisdom'] as const).map(
                (tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      'px-2 py-1 text-xs rounded-lg whitespace-nowrap capitalize transition-colors',
                      activeTab === tab
                        ? 'bg-neon-cyan/20 text-neon-cyan'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    {tab}
                  </button>
                )
              )}
            </div>

            <div className="p-4 border-t border-lattice-border max-h-96 overflow-y-auto">
              {/* Pulse tab */}
              {activeTab === 'pulse' && pulseData?.components && (
                <div className="space-y-2">
                  {(
                    Object.entries(pulseData.components) as [
                      string,
                      { status: string; score: number },
                    ][]
                  ).map(([name, comp]) => (
                    <div
                      key={name}
                      className="p-2 bg-lattice-deep rounded-lg flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full',
                            comp.status === 'healthy'
                              ? 'bg-green-400'
                              : comp.status === 'degraded'
                                ? 'bg-yellow-400'
                                : 'bg-red-400'
                          )}
                        />
                        <span className="text-sm text-white">{name}</span>
                      </div>
                      <span className={cn('text-xs', STATUS_COLORS[comp.status])}>
                        {comp.score}/100
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Circuits tab */}
              {activeTab === 'circuits' && circuitData?.breakers && (
                <div className="space-y-2">
                  {(
                    Object.entries(circuitData.breakers) as [
                      string,
                      {
                        state: string;
                        stats: { totalCalls: number; totalFailures: number; opens: number };
                      },
                    ][]
                  ).map(([name, breaker]) => (
                    <div key={name} className="p-2 bg-lattice-deep rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Lock className={cn('w-3.5 h-3.5', STATUS_COLORS[breaker.state])} />
                          <span className="text-sm text-white">{name}</span>
                          <span className={cn('text-xs capitalize', STATUS_COLORS[breaker.state])}>
                            {breaker.state}
                          </span>
                        </div>
                        {breaker.state === 'open' && (
                          <button
                            onClick={() => resetBreaker.mutate(name)}
                            className="text-xs text-neon-cyan hover:text-neon-cyan/80"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                        <span>Calls: {breaker.stats.totalCalls}</span>
                        <span>Fails: {breaker.stats.totalFailures}</span>
                        <span>Opens: {breaker.stats.opens}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Events tab */}
              {activeTab === 'events' && (
                <div className="space-y-1">
                  {busData?.stats && (
                    <div className="flex gap-3 text-xs text-gray-500 mb-2">
                      <span>Emitted: {busData.stats.emitted}</span>
                      <span>Delivered: {busData.stats.delivered}</span>
                      <span>Errors: {busData.stats.errors}</span>
                    </div>
                  )}
                  {(busData?.events || []).map(
                    (evt: { type: string; timestamp: string }, i: number) => (
                      <div
                        key={i}
                        className="p-1.5 bg-lattice-deep rounded text-[10px] flex items-center gap-2"
                      >
                        <span className="text-neon-cyan">{evt.type}</span>
                        <span className="text-gray-500 ml-auto">
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Traces tab */}
              {activeTab === 'traces' && (
                <div className="space-y-2">
                  {(traceData?.traces || []).map(
                    (trace: {
                      traceId: string;
                      trigger?: { type: string };
                      totalDuration?: number;
                      spans?: { name: string; status: string }[];
                    }) => (
                      <div key={trace.traceId} className="p-2 bg-lattice-deep rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white">
                            {trace.trigger?.type || 'unknown'}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {trace.totalDuration ? `${trace.totalDuration}ms` : 'running'}
                          </span>
                        </div>
                        <div className="flex gap-1 mt-1">
                          {trace.spans
                            ?.slice(0, 5)
                            .map((span: { name: string; status: string }, i: number) => (
                              <span
                                key={i}
                                className={cn(
                                  'text-[10px] px-1 rounded',
                                  span.status === 'ok'
                                    ? 'bg-green-500/10 text-green-400'
                                    : 'bg-red-500/10 text-red-400'
                                )}
                              >
                                {span.name}
                              </span>
                            ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Integrity tab */}
              {activeTab === 'integrity' && integrityData && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-3 text-xs">
                      <span className="text-red-400">
                        Critical: {integrityData.bySeverity?.critical || 0}
                      </span>
                      <span className="text-yellow-400">
                        Error: {integrityData.bySeverity?.error || 0}
                      </span>
                      <span className="text-gray-400">
                        Warning: {integrityData.bySeverity?.warning || 0}
                      </span>
                    </div>
                    {(integrityData.autofixable || 0) > 0 && (
                      <button
                        onClick={() => fixIntegrity.mutate()}
                        disabled={fixIntegrity.isPending}
                        className="text-xs text-neon-cyan hover:text-neon-cyan/80 flex items-center gap-1"
                      >
                        {fixIntegrity.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Wrench className="w-3 h-3" />
                        )}
                        Auto-fix ({integrityData.autofixable})
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {(integrityData.issues || [])
                      .slice(0, 20)
                      .map(
                        (
                          issue: { severity: string; message: string; autofix?: boolean },
                          i: number
                        ) => (
                          <div
                            key={i}
                            className="p-1.5 bg-lattice-deep rounded text-[10px] flex items-center gap-2"
                          >
                            <span
                              className={cn(
                                issue.severity === 'critical'
                                  ? 'text-red-400'
                                  : issue.severity === 'error'
                                    ? 'text-yellow-400'
                                    : 'text-gray-400'
                              )}
                            >
                              [{issue.severity}]
                            </span>
                            <span className="text-gray-300">{issue.message}</span>
                            {issue.autofix && (
                              <span className="text-green-400 ml-auto">fixable</span>
                            )}
                          </div>
                        )
                      )}
                  </div>
                </div>
              )}

              {/* Wisdom tab */}
              {activeTab === 'wisdom' && (
                <div>
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={wisdomQ}
                      onChange={(e) => setWisdomQ(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === 'Enter' && wisdomQ.trim() && wisdomMutation.mutate(wisdomQ.trim())
                      }
                      placeholder="Ask a cross-domain question..."
                      className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                      disabled={wisdomMutation.isPending}
                    />
                    <button
                      onClick={() => wisdomQ.trim() && wisdomMutation.mutate(wisdomQ.trim())}
                      disabled={!wisdomQ.trim() || wisdomMutation.isPending}
                      className="px-3 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg disabled:opacity-50"
                    >
                      {wisdomMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {wisdomResult && (
                    <div className="p-3 bg-lattice-deep rounded-lg">
                      <p className="text-sm text-gray-300">{wisdomResult.synthesis}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {Object.keys(wisdomResult.domains || {}).map((d) => (
                          <span
                            key={d}
                            className="text-[10px] px-1.5 py-0.5 bg-neon-cyan/10 text-neon-cyan rounded"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                      {wisdomResult.validation && (
                        <div className="mt-2 text-[10px] text-gray-500">
                          Red team: {wisdomResult.validation.severity} severity,{' '}
                          {wisdomResult.validation.vulnerabilities?.length || 0} issues found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedNervousSystem = withErrorBoundary(NervousSystem);
export { _WrappedNervousSystem as NervousSystem };
