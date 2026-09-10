'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';

export function useMetacognitionDesk() {
  const queryClient = useQueryClient();
  const bridge = useLensBridge('metacognition', 'snapshot');
  const [latestIntrospection, setLatestIntrospection] = useState<Record<string, unknown> | null>(null);

  const statusQ = useQuery({
    queryKey: ['metacognition-status'],
    queryFn: () => apiHelpers.metacognition.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  const spotsQ = useQuery({
    queryKey: ['metacognition-blindspots'],
    queryFn: () => apiHelpers.metacognition.blindspots().then((r) => r.data),
  });

  const calQ = useQuery({
    queryKey: ['metacognition-calibration'],
    queryFn: () => apiHelpers.metacognition.calibration().then((r) => r.data),
    refetchInterval: 30000,
  });

  const introQ = useQuery({
    queryKey: ['metacognition-introspection'],
    queryFn: () => apiHelpers.metacognition.introspection().then((r) => r.data),
    refetchInterval: 10000,
  });

  const predQ = useQuery({
    queryKey: ['metacognition-predictions'],
    queryFn: () => apiHelpers.metacognition.predictions().then((r) => r.data),
    refetchInterval: 15000,
  });

  const assessQ = useQuery({
    queryKey: ['metacognition-assessments'],
    queryFn: () => apiHelpers.metacognition.assessments().then((r) => r.data),
    refetchInterval: 30000,
  });

  const makePrediction = useMutation({
    mutationFn: (input: { claim: string; confidence: number; domain?: string }) =>
      apiHelpers.metacognition.predict({
        claim: input.claim,
        confidence: input.confidence,
        domain: input.domain || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-calibration'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-predictions'] });
    },
    onError: (err) =>
      console.error('makePrediction failed:', err instanceof Error ? err.message : err),
  });

  const resolvePrediction = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: boolean }) =>
      apiHelpers.metacognition.resolve(id, outcome),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-calibration'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-predictions'] });
    },
    onError: (err) =>
      console.error('resolvePrediction failed:', err instanceof Error ? err.message : err),
  });

  const runIntrospection = useMutation({
    mutationFn: (focus?: string) =>
      apiHelpers.metacognition.introspect({ focus: focus || undefined }),
    onSuccess: (res) => {
      const data = (res as { data?: Record<string, unknown> })?.data;
      const inner = data && typeof data.introspection === 'object' ? (data.introspection as Record<string, unknown>) : data;
      if (inner && typeof inner === 'object') setLatestIntrospection(inner);
      queryClient.invalidateQueries({ queryKey: ['metacognition-introspection'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-blindspots'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
    },
    onError: (err) =>
      console.error('runIntrospection failed:', err instanceof Error ? err.message : err),
  });

  const runAssessment = useMutation({
    mutationFn: (domain: string) => apiHelpers.metacognition.assess({ domain }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-calibration'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-assessments'] });
    },
    onError: (err) =>
      console.error('runAssessment failed:', err instanceof Error ? err.message : err),
  });

  const spots = useMemo(() => {
    const raw = (spotsQ.data as Record<string, unknown> | undefined)?.blindSpots;
    return Array.isArray(raw) ? raw : [];
  }, [spotsQ.data]);

  const cal = useMemo(() => {
    const raw = (calQ.data as Record<string, unknown> | undefined)?.report;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [calQ.data]);

  const statusInfo = useMemo(() => {
    const status = statusQ.data;
    const raw = status?.status || status;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [statusQ.data]);

  const introData = useMemo(() => {
    const introspectionStatus = introQ.data;
    const raw = introspectionStatus?.introspection || introspectionStatus;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [introQ.data]);

  const predictions = useMemo(() => {
    const raw = (predQ.data as Record<string, unknown> | undefined)?.predictions;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }, [predQ.data]);

  const assessmentsList = useMemo(() => {
    const raw = (assessQ.data as Record<string, unknown> | undefined)?.assessments;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }, [assessQ.data]);

  const recentPatterns = useMemo(() => {
    const raw = introData.recentPatterns;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }, [introData]);

  useEffect(() => {
    if (Object.keys(statusInfo).length > 0) {
      bridge.sync(statusInfo as Record<string, unknown>, 'Metacognition Status');
    } else if (Object.keys(cal).length > 0) {
      bridge.sync(cal as Record<string, unknown>, 'Metacognition Calibration');
    } else if (Object.keys(introData).length > 0) {
      bridge.sync(introData as Record<string, unknown>, 'Metacognition Introspection');
    }
  }, [statusInfo, cal, introData, bridge]);

  const knowledgeDomains = useMemo(() => {
    return assessmentsList.map((a) => ({
      domain: a.topic,
      confidence: a.knowledgeScore,
      gaps: a.gaps,
      recommendation: a.recommendation,
      assessedAt: a.assessedAt,
    }));
  }, [assessmentsList]);

  const introspectionHistory = recentPatterns;

  const learningInsights = useMemo(() => {
    return assessmentsList.map((a) => ({
      description: a.recommendation,
      domain: a.topic,
      timestamp: a.assessedAt,
    }));
  }, [assessmentsList]);

  const patterns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of recentPatterns) {
      const types = Array.isArray(run.patterns) ? (run.patterns as unknown[]) : [];
      for (const t of types) {
        const key = String(t);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, occurrences]) => ({
        pattern: pattern.replace(/_/g, ' '),
        occurrences,
        category: 'introspection',
      }));
  }, [recentPatterns]);

  const predictionStats = useMemo(() => {
    let hits = 0;
    let misses = 0;
    let pending = 0;
    for (const p of predictions) {
      const outcome = p.outcome;
      if (outcome === 'correct') hits++;
      else if (outcome === 'incorrect') misses++;
      else pending++;
    }
    const total = hits + misses;
    const ratio = total > 0 ? hits / total : null;
    return { hits, misses, pending, total, ratio };
  }, [predictions]);

  const isLoading = statusQ.isLoading;
  const isError = statusQ.isError || spotsQ.isError || calQ.isError || introQ.isError || predQ.isError || assessQ.isError;
  const errorMessage =
    statusQ.error?.message || spotsQ.error?.message || calQ.error?.message || introQ.error?.message || predQ.error?.message || assessQ.error?.message;
  const refetchAll = () => {
    statusQ.refetch();
    spotsQ.refetch();
    calQ.refetch();
    introQ.refetch();
    predQ.refetch();
    assessQ.refetch();
  };

  return {
    spots,
    cal,
    statusInfo,
    introData,
    predictions,
    knowledgeDomains,
    introspectionHistory,
    learningInsights,
    patterns,
    predictionStats,
    latestIntrospection,
    makePrediction,
    resolvePrediction,
    runIntrospection,
    runAssessment,
    isLoading,
    isError,
    errorMessage,
    refetchAll,
  };
}
