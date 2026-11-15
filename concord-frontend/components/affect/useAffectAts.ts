'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useAffectSession } from '@/components/affect/AffectSessionContext';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';
import { clamp, DIMS } from '@/components/affect/affect-model';

export function useAffectAts() {
  const { sessionId, setSessionId } = useAffectSession();
  const { user } = useAuth();
  // FIX-affect-002: Reset / Cooldown / Emit act on whichever session is
  // in view, and the lens opens on the shared 'default' session — so a
  // member was offered controls over shared state. The server derives
  // each caller's own session (user_<id>) and refuses writes to any
  // other session except from an operator; mirror that here so the
  // controls only render when a write would actually be honoured.
  const isOperator = user?.role === 'admin' || user?.role === 'sovereign';
  const canControlSession = isOperator || (user != null && sessionId === `user_${user.id}`);
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

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
    // F11: Reset was a silent no-op to the user — no toast, and its
    // failure path was console-only. It now confirms visibly (toast +
    // the strip's status line) and reports an ok:false payload as the
    // failure it is.
    onSuccess: (res) => {
      invalidate();
      const data = (res as { data?: { ok?: boolean; error?: string } } | undefined)?.data;
      if (data?.ok === false) {
        addToast({ type: 'error', message: `Reset failed — ${data.error || 'the ATS refused the reset.'}` });
      } else {
        addToast({ type: 'success', message: 'Affect session reset to baseline.' });
      }
    },
    onError: (err) => {
      addToast({
        type: 'error',
        message: `Reset failed — ${err instanceof Error ? err.message : 'unknown error'}`,
      });
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

  // S-AFF-4: the derivation receipt for each policy signal, served as a
  // sibling of the policy object by GET /api/affect/policy.
  const policyDerivations = useMemo(() => {
    const raw = policyQ.data?.derivations;
    return raw && typeof raw === 'object'
      ? (raw as Record<string, Record<string, string>>)
      : {};
  }, [policyQ.data]);

  const healthData = useMemo(() => {
    const health = healthQ.data;
    return health && typeof health === 'object' ? (health as Record<string, unknown>) : {};
  }, [healthQ.data]);

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
    // Local rules always run (API recommendations no longer suppress
    // them) and now cover Arousal, which had no rule at all — the
    // pass's critical (F6/F18) was an arousal warning.
    for (const d of dimValues) {
      if (d.key === 'f' && d.value > 0.7) recs.push('Consider a cooldown period to reduce fatigue levels.');
      if (d.key === 'a' && d.value < 0.3) recs.push('Arousal is low. Engaging, novel stimulation may help restore activation.');
      if (d.key === 'a' && d.value > 0.85) recs.push('Arousal is very high. A cooldown period may help settle activation before further input.');
      if (d.key === 'v' && d.value < 0.3) recs.push('Valence is low. Positive feedback or success events may help restore balance.');
      if (d.key === 's' && d.value < 0.3) recs.push('Stability is low. Reducing event frequency may help stabilize emotional state.');
      if (d.key === 'c' && d.value < 0.3) recs.push('Coherence is degraded. Consistent interaction patterns may improve internal alignment.');
      if (d.key === 'g' && d.value < 0.3) recs.push('Agency is low. Successful task completions can restore sense of control.');
      if (d.key === 't' && d.value < 0.3) recs.push('Trust is diminished. Reliable, transparent interactions can help rebuild trust.');
    }
    // Verdict integrity: a critical warning must never sit beside
    // "no recovery actions needed". If nothing above fired, name the
    // critical dimension explicitly.
    if (recs.length === 0) {
      for (const w of warnings) {
        if (w.severity === 'critical') {
          recs.push(`${w.dimension} needs attention: ${w.message} Review the event stream and reduce load on this dimension.`);
        }
      }
    }
    return [...new Set(recs)];
  }, [healthData, dimValues, warnings]);

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
    canControlSession,
    isOperator,
    affectState,
    policyData,
    policyDerivations,
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
