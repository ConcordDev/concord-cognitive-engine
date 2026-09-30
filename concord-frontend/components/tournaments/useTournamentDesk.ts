import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { Tournament, TStatus } from '@/components/tournaments/types';

export type TourneyView = 'list' | 'detail' | 'create' | 'esports';
type CountMap = Partial<Record<TStatus, number>>;

export function useTournamentDesk() {
  const [active, setActive] = useState<TourneyView>('list');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [counts, setCounts] = useState<CountMap>({});
  const [statusFilter, setStatusFilter] = useState<TStatus | 'all'>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Tournament | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const input = statusFilter === 'all' ? {} : { status: statusFilter };
      const r = await lensRun<{ tournaments: Tournament[]; counts: CountMap }>('tournaments', 'list', input);
      if (r.data.ok && r.data.result) {
        setTournaments(r.data.result.tournaments || []);
        setCounts(r.data.result.counts || {});
      } else {
        setError(r.data.error || 'list_failed');
      }
    } catch {
      setError('list_failed');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<{ tournament: Tournament }>('tournaments', 'get', { id });
      if (r.data.ok && r.data.result?.tournament) setDetail(r.data.result.tournament);
      else setError(r.data.error || 'get_failed');
    } catch {
      setError('get_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(() => {
    if (active === 'detail' && activeId) fetchDetail(activeId);
    else fetchList();
  }, [active, activeId, fetchDetail, fetchList]);

  useEffect(() => {
    if (active === 'list') fetchList();
    else if (active === 'detail' && activeId) fetchDetail(activeId);
    else setLoading(false);
  }, [active, activeId, statusFilter, fetchList, fetchDetail]);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('spectate');
    if (!slug) return;
    (async () => {
      const r = await lensRun<{ tournament: Tournament }>('tournaments', 'get', { shareSlug: slug });
      if (r.data.ok && r.data.result?.tournament) {
        setDetail(r.data.result.tournament);
        setActiveId(r.data.result.tournament.id);
        setActive('detail');
      }
    })();
  }, []);

  const run = useCallback(
    async (action: string, input: Record<string, unknown>): Promise<Tournament | null> => {
      setBusy(true);
      setError(null);
      try {
        const r = await lensRun<{ tournament: Tournament }>('tournaments', action, input);
        if (!r.data.ok) {
          setError(r.data.error || `${action}_failed`);
          return null;
        }
        const t = r.data.result?.tournament || null;
        if (t) setDetail(t);
        return t;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const goList = () => { setActive('list'); setActiveId(null); };
  const pick = (id: string) => { setActiveId(id); setDetail(null); setActive('detail'); };
  const onCreated = (t: Tournament) => { setActiveId(t.id); setDetail(t); setActive('detail'); };

  return {
    active, setActive, goList,
    tournaments, counts, statusFilter, setStatusFilter,
    activeId, detail, busy, error, setError, loading, retry, run,
    pick, onCreated,
    onRefreshDetail: () => activeId && fetchDetail(activeId),
  };
}
