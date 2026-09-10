'use client';

import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { useAffectSession } from '@/components/affect/AffectSessionContext';
import { clamp, DIMS } from '@/components/affect/affect-model';

export function useAffectAts() {
  const { sessionId, setSessionId } = useAffectSession();
  const queryClient = useQueryClient();
  const bridge = useLensBridge('affect', 'snapshot');

  const stateQ = useQuery({
    queryKey: ['affect-state', sessionId],
    queryFn: () => apiHelpers.affect.state(sessionId).then((r) => r.data),
    refetchInterval: 3000,
  });

  const policyQ = useQuery({
    queryKey: ['affect-policy', sessionId],
    queryFn: () => apiHelpers.affect.policy(sessionId).then((r) => r.data),
    refetchInterval: 5000,
  });

  const healthQ = useQuery({
    queryKey: ['affect-health'],
    queryFn: () => apiHelpers.affect.health().then((r) => r.data),
    refetchInterval: 10000,
  });

  const eventsQ = useQuery({
    queryKey: ['affect-events', sessionId],
    queryFn: () => apiHelpers.affect.events(sessionId).then((r) => r.data),
    refetchInterval: 5000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['affect-state', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['affect-policy', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['affect-events', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['affect-health'] });
  };

  const resetAffect = useMutation({
    mutationFn: (mode?: string) => apiHelpers.affect.reset(sessionId, mode),
    onSuccess: invalidate,
    onError: (err) => {
      console.error('Failed to reset affect:', err instanceof Error ? err.message : err);
    },
  });

  const affectState = useMemo(() => {
    const raw = stateQ.data?.state || stateQ.data?.E || stateQ.data;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [stateQ.data]);

  const policyData = useMemo(() => {
    const raw = policyQ.data?.policy || policyQ.data;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [policyQ.data]);

  const healthData = useMemo(() => {
    const health = healthQ.data;
    return health && typeof health === 'object' ? (health as Record<string, unknown>) : {};
  }, [healthQ.data]);

  useEffect(() => {
    if (Object.keys(affectState).length > 0) {
      bridge.sync(affectState as Record<string, unknown>, 'Affect State Snapshot');
    }
  }, [affectState, bridge]);

  const eventList = useMemo(() => {
    const raw = eventsQ.data?.events || eventsQ.data;
    return Array.isArray(raw) ? raw : [];
  }, [eventsQ.data]);

  const dimValues = useMemo(() => {
    return DIMS.map((dim) => {
      const val = typeof affectState[dim.key] === 'number' ? (affectState[dim.key] as number) : 0.5;
      return { ...dim, value: clamp(val, 0, 1) };
    });
  }, [affectState]);

  const overallScore = useMemo(() => {
    const healthScore =
      typeof healthData.score === 'number'
        ? healthData.score
        : typeof healthData.overall_score === 'number'
          ? healthData.overall_score
          : null;
    if (healthScore != null) return healthScore;
    const vals = dimValues.map((d) => (d.key === 'f' ? 1 - d.value : d.value));
    if (vals.length === 0) return null;
    return vals.reduce((sum, v) => sum + v, 0) / vals.length;
  }, [healthData, dimValues]);

  const warnings = useMemo(() => {
    const w: { dimension: string; message: string; severity: string }[] = [];
    for (const d of dimValues) {
      if (d.key === 'f' && d.value > 0.8) {
        w.push({ dimension: d.label, message: `Fatigue critically high at ${(d.value * 100).toFixed(0)}%`, severity: 'critical' });
      } else if (d.key === 'f' && d.value > 0.6) {
        w.push({ dimension: d.label, message: `Fatigue elevated at ${(d.value * 100).toFixed(0)}%`, severity: 'warning' });
      } else if (d.key !== 'f' && d.value < 0.2) {
        w.push({ dimension: d.label, message: `${d.label} critically low at ${(d.value * 100).toFixed(0)}%`, severity: 'critical' });
      } else if (d.key !== 'f' && d.value < 0.35) {
        w.push({ dimension: d.label, message: `${d.label} below threshold at ${(d.value * 100).toFixed(0)}%`, severity: 'warning' });
      }
    }
    const apiWarnings = healthData.warnings || healthData.alerts;
    if (Array.isArray(apiWarnings)) {
      for (const aw of apiWarnings) {
        if (typeof aw === 'string') {
          w.push({ dimension: 'System', message: aw, severity: 'warning' });
        } else if (aw && typeof aw === 'object') {
          w.push({
            dimension: String((aw as Record<string, unknown>).dimension || 'System'),
            message: String((aw as Record<string, unknown>).message || JSON.stringify(aw)),
            severity: String((aw as Record<string, unknown>).severity || 'warning'),
          });
        }
      }
    }
    return w;
  }, [dimValues, healthData]);

  const recoveryRecommendations = useMemo(() => {
    const recs: string[] = [];
    const apiRecs = healthData.recommendations || healthData.recovery;
    if (Array.isArray(apiRecs)) {
      for (const r of apiRecs) recs.push(typeof r === 'string' ? r : JSON.stringify(r));
    }
    if (recs.length === 0) {
      for (const d of dimValues) {
        if (d.key === 'f' && d.value > 0.7) recs.push('Consider a cooldown period to reduce fatigue levels.');
        if (d.key === 'v' && d.value < 0.3) recs.push('Valence is low. Positive feedback or success events may help restore balance.');
        if (d.key === 's' && d.value < 0.3) recs.push('Stability is low. Reducing event frequency may help stabilize emotional state.');
        if (d.key === 'c' && d.value < 0.3) recs.push('Coherence is degraded. Consistent interaction patterns may improve internal alignment.');
        if (d.key === 'g' && d.value < 0.3) recs.push('Agency is low. Successful task completions can restore sense of control.');
        if (d.key === 't' && d.value < 0.3) recs.push('Trust is diminished. Reliable, transparent interactions can help rebuild trust.');
      }
    }
    return recs;
  }, [healthData, dimValues]);

  const isLoading = stateQ.isLoading;
  const isError = stateQ.isError || policyQ.isError || healthQ.isError || eventsQ.isError;
  const errorMessage =
    stateQ.error?.message || policyQ.error?.message || healthQ.error?.message || eventsQ.error?.message;
  const refetchAll = () => {
    stateQ.refetch();
    policyQ.refetch();
    healthQ.refetch();
    eventsQ.refetch();
  };

  return {
    sessionId,
    setSessionId,
    affectState,
    policyData,
    healthData,
    eventList,
    dimValues,
    overallScore,
    warnings,
    recoveryRecommendations,
    resetAffect,
    isLoading,
    isError,
    errorMessage,
    refetchAll,
  };
}
