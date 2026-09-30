'use client';

/**
 * useCourtshipDesk — all courtship REST + macro wiring extracted from page.tsx.
 * Preserves: courtship.constants, marriages, conceive, birth, dissolve,
 * /api/courtship/mine, marriages/mine, interact, propose, wed, pregnancy-cache.
 */

import { useCallback, useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { HeartEventScene } from '@/components/courtship/HeartEventModal';
import {
  loadCachedPregnancies,
  addCachedPregnancy,
  removeCachedPregnancy,
  type CachedPregnancy,
} from '@/components/courtship/pregnancy-cache';
import {
  type Courtship,
  type Marriage,
  type Child,
  type LoadState,
  DEFAULT_ENGAGE_THRESHOLD,
  DEFAULT_MARRY_THRESHOLD,
} from '@/components/courtship/courtship-types';

export function useCourtshipDesk() {
  const [courtships, setCourtships] = useState<Courtship[]>([]);
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [pending, setPending] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [engageThreshold, setEngageThreshold] = useState(DEFAULT_ENGAGE_THRESHOLD);
  const [marryThreshold, setMarryThreshold] = useState(DEFAULT_MARRY_THRESHOLD);
  const [heartEvent, setHeartEvent] = useState<{ scene: HeartEventScene; partnerLabel: string } | null>(null);
  const [pregnancies, setPregnancies] = useState<CachedPregnancy[]>([]);
  const [pastMarriages, setPastMarriages] = useState<Marriage[]>([]);
  const [dissolveTarget, setDissolveTarget] = useState<Marriage | null>(null);
  const addToast = useUIStore((s) => s.addToast);
  const { user } = useAuth();

  // Locally-cached pregnancies are per-user (see pregnancy-cache.ts honesty
  // note) — load once we know who's signed in, and whenever that changes.
  useEffect(() => {
    setPregnancies(loadCachedPregnancies(user?.id));
  }, [user?.id]);

  // Pull the canonical propose/marry floors from the engine once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ domain: 'courtship', name: 'constants', input: {} }),
        });
        const j = await r.json();
        const c = j?.constants || j?.result?.constants || j?.data?.constants;
        if (!cancelled && c) {
          if (typeof c.ENGAGE_THRESHOLD === 'number') setEngageThreshold(c.ENGAGE_THRESHOLD);
          if (typeof c.MARRY_THRESHOLD === 'number') setMarryThreshold(c.MARRY_THRESHOLD);
        }
      } catch {
        /* keep engine defaults */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Past (dissolved) marriages come from the macro dispatcher — the REST
  // route only ever returns active marriages — via courtship.marriages with
  // activeOnly:false, then filtered to rows that actually carry a
  // dissolved_at. Best-effort: a failure here never blocks the core ready
  // state, it just leaves the "Past marriages" section showing what it had.
  const loadPastMarriages = useCallback(async () => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'courtship',
          name: 'marriages',
          input: { activeOnly: false },
        }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok) {
        setPastMarriages((result.marriages || []).filter((m: Marriage) => !!m.dissolved_at));
      }
    } catch {
      /* best-effort supplementary view — see comment above */
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoadState((s) => (s === 'ready' ? 'ready' : 'loading'));
    setErrorMsg(null);
    try {
      const [cRes, mRes] = await Promise.all([
        fetch('/api/courtship/mine', { credentials: 'include' }),
        fetch('/api/courtship/marriages/mine', { credentials: 'include' }),
      ]);
      if (!cRes.ok || !mRes.ok) {
        throw new Error(`Server returned ${cRes.status}/${mRes.status}`);
      }
      const [cJ, mJ] = await Promise.all([cRes.json(), mRes.json()]);
      if (cJ?.ok) setCourtships(cJ.courtships || []);
      if (mJ?.ok) {
        setMarriages(mJ.marriages || []);
        setChildren(mJ.children || []);
      }
      setLoadState('ready');
      loadPastMarriages();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not load your courtships.');
      setLoadState('error');
      addToast({ type: 'error', message: 'Could not load your courtships' });
    }
  }, [addToast, loadPastMarriages]);

  useEffect(() => { refresh(); }, [refresh]);

  const act = useCallback(async (path: string, body: Record<string, unknown>) => {
    setPending(true);
    try {
      const j = await api.post(path, body).then(r => r.data).catch((e) => {
        const data = e?.response?.data;
        return data ?? { ok: false, reason: e instanceof Error ? e.message : 'request_failed' };
      });
      if (j?.ok === false) {
        setErrorMsg(j?.reason ? `Action failed: ${j.reason}` : 'Action failed.');
        addToast({ type: 'error', message: 'Action failed' });
      }
      await refresh();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [refresh, addToast]);

  // Dedicated (not the generic `act`) because we need to read the response
  // body for a `heartEvent` payload — `act` discards the body on success.
  const interact = useCallback(async (c: Courtship, sentiment: number) => {
    setPending(true);
    try {
      const r = await api.post('/api/courtship/interact', { partnerKind: c.partner_kind, partnerId: c.partner_id, sentiment });
      const j = r.data;
      if (j?.ok === false) {
        setErrorMsg(j?.reason ? `Action failed: ${j.reason}` : 'Action failed.');
        addToast({ type: 'error', message: 'Action failed' });
      } else if (j?.heartEvent) {
        setHeartEvent({
          scene: j.heartEvent as HeartEventScene,
          partnerLabel: `${c.partner_kind}:${String(c.partner_id ?? "").slice(0, 14)}`,
        });
      }
      await refresh();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [refresh, addToast]);
  const propose = (c: Courtship) =>
    act('/api/courtship/propose', { partnerKind: c.partner_kind, partnerId: c.partner_id });
  const wed = (c: Courtship) =>
    act('/api/courtship/wed', { partnerKind: c.partner_kind, partnerId: c.partner_id });

  // conceive / birth go through the macro dispatcher (courtship.conceive /
  // courtship.birth) — there's no dedicated REST route for either, only the
  // registered macros (server/domains/courtship.js), so we call
  // POST /api/lens/run directly, same as the constants fetch above.
  const conceive = useCallback(async (m: Marriage) => {
    setPending(true);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'courtship',
          name: 'conceive',
          input: { partnerKind: m.partner_kind, partnerId: m.partner_id },
        }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok && result?.pregnancyId) {
        const cached: CachedPregnancy = {
          pregnancyId: result.pregnancyId,
          partnerKind: m.partner_kind,
          partnerId: m.partner_id,
          dueAt: result.dueAt,
          conceivedAt: Math.floor(Date.now() / 1000),
        };
        addCachedPregnancy(user?.id, cached);
        setPregnancies(loadCachedPregnancies(user?.id));
        addToast({ type: 'success', message: 'A pregnancy has begun.' });
      } else {
        setErrorMsg(result?.reason ? `Could not conceive: ${result.reason}` : 'Could not conceive.');
        addToast({ type: 'error', message: 'Action failed' });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [user?.id, addToast]);

  const birth = useCallback(async (p: CachedPregnancy) => {
    setPending(true);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'courtship',
          name: 'birth',
          input: { pregnancyId: p.pregnancyId },
        }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok) {
        removeCachedPregnancy(user?.id, p.pregnancyId);
        setPregnancies(loadCachedPregnancies(user?.id));
        addToast({ type: 'success', message: `${result.name || 'A child'} was born.` });
        await refresh();
      } else {
        // Honest self-repair: if the server says the cached id is stale
        // (already birthed, or the row is gone), drop it from the local
        // cache rather than keep offering a dead action forever.
        if (result?.reason === 'already_born' || result?.reason === 'pregnancy_not_found') {
          removeCachedPregnancy(user?.id, p.pregnancyId);
          setPregnancies(loadCachedPregnancies(user?.id));
        }
        setErrorMsg(result?.reason ? `Could not complete birth: ${result.reason}` : 'Could not complete birth.');
        addToast({ type: 'error', message: 'Action failed' });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [user?.id, addToast, refresh]);

  // dissolve goes through the macro dispatcher (courtship.dissolve) — same
  // reasoning as conceive/birth above. Confirmed via ConfirmDissolveModal
  // before this ever fires; the server independently re-checks that the
  // caller is a party to the marriage (courtship.js `dissolve`).
  const confirmDissolve = useCallback(async () => {
    if (!dissolveTarget) return;
    setPending(true);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'courtship',
          name: 'dissolve',
          input: { marriageId: dissolveTarget.id, reason: 'estranged' },
        }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok) {
        addToast({ type: 'success', message: 'The marriage has ended.' });
        setDissolveTarget(null);
        await refresh();
      } else {
        setErrorMsg(result?.reason ? `Could not end marriage: ${result.reason}` : 'Could not end marriage.');
        addToast({ type: 'error', message: 'Action failed' });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [dissolveTarget, refresh, addToast]);

  const engagePct = Math.round(engageThreshold * 100);

  return {
    courtships,
    marriages,
    children,
    pending,
    loadState,
    errorMsg,
    engageThreshold,
    marryThreshold,
    engagePct,
    heartEvent,
    setHeartEvent,
    pregnancies,
    pastMarriages,
    dissolveTarget,
    setDissolveTarget,
    refresh,
    interact,
    propose,
    wed,
    conceive,
    birth,
    confirmDissolve,
  };
}
