'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';

export type LogLevel = 'all' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

export function useDebugDesk() {
  const { items: debugItems } = useLensData('debug', 'debug', { seed: [] });
  const runAction = useRunArtifact('debug');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleDebugAction = useCallback(
    async (action: string) => {
      const targetId = debugItems[0]?.id;
      if (!targetId) return;
      setActiveAction(action);
      setActionResult(null);
      try {
        const res = await runAction.mutateAsync({ id: targetId, action });
        if (res.ok === false) {
          setActionResult({
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setActionResult(res.result as Record<string, unknown>);
        }
      } catch (e) {
        console.error(`Action ${action} failed:`, e);
        setActionResult({
          message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      }
      setActiveAction(null);
    },
    [debugItems, runAction],
  );

  const [debugOutput, setDebugOutput] = useState<string[]>([
    '$ concord debug',
    'Ready. Type command or click button above.',
  ]);
  const [customCmd, setCustomCmd] = useState('');
  const [logFilter, setLogFilter] = useState<LogLevel>('all');
  const [logSearch, setLogSearch] = useState('');
  const [inspectEntity, setInspectEntity] = useState('');
  const [inspectType, setInspectType] = useState('dtu');
  const [inspectResult, setInspectResult] = useState<unknown>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugOutput]);

  const debugCmd = useMutation({
    mutationFn: async (cmd: string) => {
      setDebugOutput((prev) => [...prev, `$ ${cmd}...`]);
      if (cmd === 'tick') return apiHelpers.bridge.heartbeatTick();
      if (cmd === 'organs') return apiHelpers.guidance.health();
      if (cmd === 'invariants') return apiHelpers.emergent.status();
      if (cmd === 'growth') return apiHelpers.pipeline.metrics();
      if (cmd === 'db-status') return apiHelpers.db.status();
      if (cmd === 'redis-stats') return apiHelpers.redis.stats();
      if (cmd === 'perf') return apiHelpers.perf.metrics();
      if (cmd === 'backpressure') return apiHelpers.backpressure.status();
      if (cmd === 'gc') return apiHelpers.perf.gc();
      return api.get('/api/status');
    },
    onSuccess: (res) =>
      setDebugOutput((prev) => [...prev, JSON.stringify(res.data, null, 2).slice(0, 800)]),
    onError: (err) =>
      setDebugOutput((prev) => [
        ...prev,
        `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
      ]),
  });

  const inspectMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      return apiHelpers.guidance.inspect(type, id);
    },
    onSuccess: (res) => setInspectResult(res.data),
    onError: (err) =>
      setInspectResult({ error: err instanceof Error ? err.message : 'Inspect failed' }),
  });

  const {
    data: status,
    isLoading,
    refetch: refetchStatus,
    isError,
    error,
  } = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get('/api/status').then((r) => r.data),
  });

  const {
    data: events,
    refetch: refetchEvents,
    isError: isError2,
    error: error2,
  } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/api/events').then((r) => r.data),
  });

  const {
    data: jobs,
    isError: isError3,
    error: error3,
    refetch: refetch3,
  } = useQuery({
    queryKey: ['jobs-status'],
    queryFn: () => api.get('/api/jobs/status').then((r) => r.data),
  });

  const { data: dbStatus } = useQuery({
    queryKey: ['db-status'],
    queryFn: () => apiHelpers.db.status().then((r) => r.data),
  });

  const { data: perfMetrics } = useQuery({
    queryKey: ['perf-metrics'],
    queryFn: () => apiHelpers.perf.metrics().then((r) => r.data),
    refetchInterval: 15000,
  });

  const handleCustomCmd = useCallback(() => {
    if (!customCmd.trim()) return;
    debugCmd.mutate(customCmd.trim());
    setCustomCmd('');
  }, [customCmd, debugCmd]);

  const clearConsole = () => {
    setDebugOutput(['$ concord debug', 'Console cleared.']);
  };

  const copyConsole = () => {
    navigator.clipboard?.writeText(debugOutput.join('\n'));
  };

  const toggleEventExpand = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const logEntries: LogEntry[] = useMemo(
    () =>
      (events?.events || []).map((e: Record<string, unknown>) => ({
        timestamp: String(e.at || e.timestamp || ''),
        level: String(e.type || '').includes('error')
          ? 'error'
          : String(e.type || '').includes('warn')
            ? 'warn'
            : 'info',
        message: `[${String(e.type)}] ${JSON.stringify(e.payload || {}).slice(0, 200)}`,
        source: String(e.source || e.type || 'system'),
      })),
    [events],
  );

  const filteredLogs = useMemo(
    () =>
      logEntries.filter((log) => {
        if (logFilter !== 'all' && log.level !== logFilter) return false;
        if (logSearch && !log.message.toLowerCase().includes(logSearch.toLowerCase())) return false;
        return true;
      }),
    [logEntries, logFilter, logSearch],
  );

  const refetchAll = () => {
    refetchStatus();
    refetchEvents();
    refetch3();
  };

  return {
    debugItems,
    actionResult,
    activeAction,
    handleDebugAction,
    debugOutput,
    customCmd,
    setCustomCmd,
    logFilter,
    setLogFilter,
    logSearch,
    setLogSearch,
    inspectEntity,
    setInspectEntity,
    inspectType,
    setInspectType,
    inspectResult,
    expandedEvents,
    toggleEventExpand,
    consoleEndRef,
    debugCmd,
    inspectMutation,
    status,
    events,
    jobs,
    dbStatus,
    perfMetrics,
    isLoading,
    isError: isError || isError2 || isError3,
    errorMessage: error?.message || error2?.message || error3?.message,
    refetchAll,
    handleCustomCmd,
    clearConsole,
    copyConsole,
    logEntries,
    filteredLogs,
  };
}
