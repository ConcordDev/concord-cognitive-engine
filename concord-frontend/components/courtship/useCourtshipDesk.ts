'use client';

/**
 * useCourtshipDesk — all courtship REST + macro wiring extracted from page.tsx.
 * Preserves: courtship.constants, marriages, conceive, birth, dissolve,
 * /api/courtship/mine, marriages/mine, interact, propose, wed.
 * Full build adds: courtship.pregnancies (the server read that retires the
 * old per-browser pregnancy cache), courtship.notices + accept/decline (the
 * consent inbox), courtship.spouses (the named spouse read), and
 * courtshipErrorText over every refusal (S2/S3/S5).
 */

import { useCallback, useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui';
import { api } from '@/lib/api/client';
import type { HeartEventScene } from '@/components/courtship/HeartEventModal';
import {
  type Courtship,
  type Marriage,
  type Child,
  type Pregnancy,
  type CourtshipNotice,
  type Spouse,
  type LoadState,
  partnerLabel,
  DEFAULT_ENGAGE_THRESHOLD,
  DEFAULT_MARRY_THRESHOLD,
} from '@/components/courtship/courtship-types';
import { courtshipErrorText } from '@/components/courtship/courtship-errors';

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
  const [pregnancies, setPregnancies] = useState<Pregnancy[]>([]);
  const [notices, setNotices] = useState<CourtshipNotice[]>([]);
  const [spouses, setSpouses] = useState<Spouse[]>([]);
  const [pastMarriages, setPastMarriages] = useState<Marriage[]>([]);
  const [dissolveTarget, setDissolveTarget] = useState<Marriage | null>(null);
  const addToast = useUIStore((s) => s.addToast);

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

  // In-flight pregnancies come from the SERVER now (courtship.pregnancies,
  // S2) — the read whose absence the old localStorage cache existed to
  // paper over. Best-effort like the past-marriages read: a failure leaves
  // the section as it was and never blocks the core ready state.
  const loadPregnancies = useCallback(async () => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'courtship', name: 'pregnancies', input: {} }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok) setPregnancies(result.pregnancies || []);
    } catch {
      /* best-effort supplementary view */
    }
  }, []);

  // The consent inbox (courtship.notices, S5): proposals pending on the
  // caller. Registered and shipped-suite-pinned since the consent build,
  // but never wired to a surface until now — a pending proposal was
  // invisible in the lens. Best-effort, like the other supplementary reads.
  const loadNotices = useCallback(async () => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'courtship', name: 'notices', input: {} }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok) {
        setNotices((result.notices || []).filter((n: CourtshipNotice) => n.kind === 'proposal' && !!n.proposalId));
      }
    } catch {
      /* best-effort supplementary view */
    }
  }, []);

  // The NPC spouses wed to the caller (courtship.spouses, S5), named
  // server-side. Best-effort supplementary read.
  const loadSpouses = useCallback(async () => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: 'courtship', name: 'spouses', input: {} }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok) setSpouses(result.spouses || []);
    } catch {
      /* best-effort supplementary view */
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
      loadPregnancies();
      loadNotices();
      loadSpouses();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not load your courtships.');
      setLoadState('error');
      addToast({ type: 'error', message: 'Could not load your courtships' });
    }
  }, [addToast, loadPastMarriages, loadPregnancies, loadNotices, loadSpouses]);

  useEffect(() => { refresh(); }, [refresh]);

  const act = useCallback(async (path: string, body: Record<string, unknown>) => {
    setPending(true);
    try {
      const j = await api.post(path, body).then(r => r.data).catch((e) => {
        const data = e?.response?.data;
        // The REST routes answer refusals as { ok:false, error } where the
        // macros answer { ok:false, reason } — both feed the same map (S3).
        return data ?? { ok: false, reason: e instanceof Error ? e.message : 'request_failed' };
      });
      if (j?.ok === false) {
        setErrorMsg(courtshipErrorText({ reason: j?.reason ?? j?.error, required: j?.required, got: j?.got }));
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
        setErrorMsg(courtshipErrorText({ reason: j?.reason ?? j?.error, required: j?.required, got: j?.got }));
        addToast({ type: 'error', message: 'Action failed' });
      } else if (j?.heartEvent) {
        setHeartEvent({
          scene: j.heartEvent as HeartEventScene,
          partnerLabel: partnerLabel(c.partner_kind, c.partnerName),
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
        // The server's pregnancies read carries the new row now (S2) —
        // no client-side cache to keep in step.
        await loadPregnancies();
        addToast({ type: 'success', message: 'A pregnancy has begun.' });
      } else {
        setErrorMsg(courtshipErrorText(result));
        addToast({ type: 'error', message: 'Action failed' });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [loadPregnancies, addToast]);

  const birth = useCallback(async (p: Pregnancy) => {
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
        addToast({ type: 'success', message: `${result.name || 'A child'} was born.` });
        await refresh();
      } else {
        // A stale row (already birthed elsewhere) leaves the list on the
        // refresh inside refresh() — the server read is the source now.
        if (result?.reason === 'already_born') await loadPregnancies();
        setErrorMsg(courtshipErrorText(result));
        addToast({ type: 'error', message: 'Action failed' });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [addToast, refresh, loadPregnancies]);

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
        setErrorMsg(courtshipErrorText(result));
        addToast({ type: 'error', message: 'Action failed' });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [dissolveTarget, refresh, addToast]);

  // Accept / decline a pending proposal (S5) — the shipped consent verbs,
  // wired to the notices the inbox read surfaces.
  const answerProposal = useCallback(async (notice: CourtshipNotice, accept: boolean) => {
    if (!notice.proposalId) return;
    setPending(true);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'courtship',
          name: accept ? 'accept' : 'decline',
          input: { proposalId: notice.proposalId },
        }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      const result = j?.result ?? j;
      if (result?.ok) {
        addToast({
          type: 'success',
          message: accept ? 'You are engaged.' : 'Proposal declined.',
        });
        await refresh();
      } else {
        setErrorMsg(courtshipErrorText(result));
        addToast({ type: 'error', message: 'Action failed' });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed.');
      addToast({ type: 'error', message: 'Action failed' });
    } finally {
      setPending(false);
    }
  }, [addToast, refresh]);

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
    notices,
    answerProposal,
    spouses,
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
