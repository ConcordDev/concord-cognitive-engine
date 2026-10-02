'use client';

/**
 * Meta north star — three inventory facts.
 * Counts come from GET /api/inventory and the wiring map. Missing scans stay blank.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { GraphFamilyPill, META_LINKS } from '@/components/graph/GraphFamilyChrome';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { api } from '@/lib/api/client';

type Summary = {
  ok?: boolean;
  totalLenses?: number;
  orphanedCount?: number;
  scanTimestamp?: string;
};

type Wiring = {
  lenses?: Record<string, { components?: string[]; serverRoutes?: string[] }>;
};

function passLabel(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

export function MetaNorthStar({ onOpenDesk }: { onOpenDesk: () => void }) {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const summary = useQuery({
    queryKey: ['meta-north', 'summary'],
    queryFn: async () => {
      const r = await api.get<Summary>('/api/inventory');
      return r.data;
    },
  });

  const wiring = useQuery({
    queryKey: ['meta-north', 'wiring'],
    queryFn: async () => {
      const r = await api.get<Wiring>('/api/inventory/wiring');
      return r.data;
    },
  });

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      await api.post('/api/inventory/refresh');
      await qc.invalidateQueries({ queryKey: ['meta-north'] });
    } catch {
      setError('Inventory refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  const total = summary.data?.totalLenses;
  const orphans = summary.data?.orphanedCount;
  const lenses = wiring.data?.lenses;
  const wired = lenses
    ? Object.values(lenses).filter((info) => (info.components?.length || 0) + (info.serverRoutes?.length || 0) > 0).length
    : null;

  return (
    <LensShell lensId="meta" asMain={false} disableAgentFab>
      <div data-lens-theme="meta" className="relative min-h-[calc(100vh-3rem)] px-8 pb-28 pt-8">
        <div className="absolute right-8 top-8">
          <QuietMore items={[{ id: 'desk', label: 'Inventory desks' }]} onPick={() => onOpenDesk()} />
        </div>
        <NorthGreeting kicker="Meta" title={`What the system is${who ? `, ${who}` : ''}`} />
        <GraphFamilyPill active="meta" links={META_LINKS} />

        {summary.isLoading && <p className="mt-10 text-[15px] text-zinc-500">Reading the inventory.</p>}
        {summary.isError && <p role="alert" className="mt-8 text-[14px] text-rose-300">Inventory didn’t load.</p>}

        {summary.isSuccess && (
          <ul className="mt-8 max-w-3xl space-y-2">
            <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="text-[15px] text-zinc-100">
                Lenses with a wire
                {wired != null && <span className="ml-2 text-[12px] text-teal-300">live</span>}
              </span>
              <span className="text-[14px] text-zinc-400">
                {wired == null || !Number.isFinite(total) ? '—' : `${wired} of ${total}`}
              </span>
            </li>
            <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="text-[15px] text-zinc-100">Orphan components</span>
              <span className="text-[14px] text-zinc-400">{orphans === 0 ? 'none' : (Number.isFinite(orphans) ? String(orphans) : '—')}</span>
            </li>
            <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="text-[15px] text-zinc-100">Last inventory pass</span>
              <span className="text-[14px] text-zinc-400">{passLabel(summary.data?.scanTimestamp)}</span>
            </li>
          </ul>
        )}
        {error && <p role="alert" className="mt-3 text-[14px] text-rose-300">{error}</p>}
        <button type="button" className={northCtaClass} disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh inventory'}
        </button>
      </div>
    </LensShell>
  );
}
