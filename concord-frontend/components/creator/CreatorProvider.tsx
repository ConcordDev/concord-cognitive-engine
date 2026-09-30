'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, lensRun } from '@/lib/api/client';
import type {
  CreatorView,
  DashboardResponse,
  DriftHit,
  MyListing,
  SocialProfile,
  StudioDash,
  StudioGoal,
  WithdrawalStatus,
} from './types';

export const CREATOR_KEYS = {
  dashboard: ['creator', 'dashboard'] as const,
  drift: ['creator', 'influence-drift'] as const,
  profile: ['creator', 'social-profile'] as const,
  listings: ['creator', 'listings'] as const,
  withdrawal: ['creator', 'withdrawal'] as const,
  studioDash: ['creator', 'studio-dash'] as const,
  studioGoal: ['creator', 'studio-goal'] as const,
};

interface CreatorStore {
  view: CreatorView;
  setView: (v: CreatorView) => void;
  me: DashboardResponse | null;
  drift: DriftHit[];
  profile: SocialProfile | null;
  listings: MyListing[];
  withdrawal: WithdrawalStatus | null;
  studioDash: StudioDash | null;
  studioGoal: StudioGoal | null;
  dashboardLoading: boolean;
  dashboardError: string | null;
  refreshAll: () => void;
  refreshDashboard: () => void;
  refreshListings: () => void;
  refreshWithdrawal: () => void;
  refreshStudio: () => void;
}

const Ctx = createContext<CreatorStore | null>(null);

async function jsonGet<T>(path: string): Promise<T | null> {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) return null;
  return r.json() as Promise<T>;
}

export function CreatorProvider({
  view,
  setView,
  children,
}: {
  view: CreatorView;
  setView: (v: CreatorView) => void;
  children: ReactNode;
}) {
  const qc = useQueryClient();

  const dashboardQ = useQuery({
    queryKey: CREATOR_KEYS.dashboard,
    queryFn: () => jsonGet<DashboardResponse>('/api/creator/dashboard'),
    staleTime: 15_000,
  });
  const driftQ = useQuery({
    queryKey: CREATOR_KEYS.drift,
    queryFn: async () => {
      const d = await jsonGet<{ drift?: DriftHit[] }>('/api/creator/influence-drift');
      return d?.drift ?? [];
    },
    staleTime: 30_000,
  });
  const profileQ = useQuery({
    queryKey: CREATOR_KEYS.profile,
    queryFn: async () => {
      const p = await jsonGet<{ ok?: boolean; profile?: SocialProfile }>('/api/social/profile');
      return p?.ok && p.profile ? p.profile : null;
    },
    staleTime: 15_000,
  });
  const listingsQ = useQuery({
    queryKey: CREATOR_KEYS.listings,
    queryFn: async () => {
      const r = await lensRun<{ listings?: MyListing[] }>('marketplace', 'myListings', {});
      return r.data?.result?.listings ?? [];
    },
    staleTime: 10_000,
  });
  const withdrawalQ = useQuery({
    queryKey: CREATOR_KEYS.withdrawal,
    queryFn: async () => {
      const r = await api.get('/api/creator/withdrawal-status');
      return r.data as WithdrawalStatus;
    },
    staleTime: 10_000,
  });
  const studioDashQ = useQuery({
    queryKey: CREATOR_KEYS.studioDash,
    queryFn: async () => {
      const d = await lensRun<StudioDash>('creator', 'creator-dashboard', {});
      return d.data?.result ?? null;
    },
    staleTime: 20_000,
  });
  const studioGoalQ = useQuery({
    queryKey: CREATOR_KEYS.studioGoal,
    queryFn: async () => {
      const g = await lensRun<StudioGoal>('creator', 'creator-goal-status', {});
      return g.data?.result ?? null;
    },
    staleTime: 20_000,
  });

  const refreshDashboard = useCallback(() => {
    void qc.invalidateQueries({ queryKey: CREATOR_KEYS.dashboard });
    void qc.invalidateQueries({ queryKey: CREATOR_KEYS.drift });
    void qc.invalidateQueries({ queryKey: CREATOR_KEYS.profile });
  }, [qc]);
  const refreshListings = useCallback(() => {
    void qc.invalidateQueries({ queryKey: CREATOR_KEYS.listings });
  }, [qc]);
  const refreshWithdrawal = useCallback(() => {
    void qc.invalidateQueries({ queryKey: CREATOR_KEYS.withdrawal });
  }, [qc]);
  const refreshStudio = useCallback(() => {
    void qc.invalidateQueries({ queryKey: CREATOR_KEYS.studioDash });
    void qc.invalidateQueries({ queryKey: CREATOR_KEYS.studioGoal });
  }, [qc]);
  const refreshAll = useCallback(() => {
    refreshDashboard();
    refreshListings();
    refreshWithdrawal();
    refreshStudio();
  }, [refreshDashboard, refreshListings, refreshWithdrawal, refreshStudio]);

  const value = useMemo<CreatorStore>(
    () => ({
      view,
      setView,
      me: dashboardQ.data ?? null,
      drift: driftQ.data ?? [],
      profile: profileQ.data ?? null,
      listings: listingsQ.data ?? [],
      withdrawal: withdrawalQ.data ?? null,
      studioDash: studioDashQ.data ?? null,
      studioGoal: studioGoalQ.data ?? null,
      dashboardLoading: dashboardQ.isLoading,
      dashboardError: dashboardQ.error ? (dashboardQ.error as Error).message : dashboardQ.data?.error ?? null,
      refreshAll,
      refreshDashboard,
      refreshListings,
      refreshWithdrawal,
      refreshStudio,
    }),
    [
      view, setView,
      dashboardQ.data, dashboardQ.isLoading, dashboardQ.error,
      driftQ.data, profileQ.data, listingsQ.data, withdrawalQ.data,
      studioDashQ.data, studioGoalQ.data,
      refreshAll, refreshDashboard, refreshListings, refreshWithdrawal, refreshStudio,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCreator(): CreatorStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCreator must be inside CreatorProvider');
  return ctx;
}
