'use client';

// Phase DC2 — Courtship lens.
// Lists active courtships + marriages + children. Lets the player
// propose / wed if the affinity threshold (sourced from the backend
// engine, not hardcoded) is met.
//
// Backend wiring (all real, all registered):
//   GET  /api/courtship/mine            → romance-engine#listMyCourtships
//   GET  /api/courtship/marriages/mine  → listMyMarriages + listChildren
//   POST /api/courtship/interact        → courtInteraction (shifts affinity)
//   POST /api/courtship/propose         → propose   (gated at ENGAGE_THRESHOLD)
//   POST /api/courtship/wed             → wed        (gated at MARRY_THRESHOLD)
//   POST /api/lens/run courtship.constants → ROMANCE_CONSTANTS (threshold source)
//   POST /api/lens/run courtship.conceive  → conceive (start a pregnancy; married only)
//   POST /api/lens/run courtship.birth     → birthChild (from a due pregnancy)
//   POST /api/lens/run courtship.dissolve  → dissolveMarriage (end a marriage;
//                                             server-enforced: caller must be
//                                             a party to the marriage)
//   POST /api/lens/run courtship.marriages {activeOnly:false} → past
//                                             (dissolved) marriages, for the
//                                             "Past marriages" section below
//
// The propose/marry floors are NOT duplicated here — they come from the
// engine via courtship.constants so the lens can never drift from the
// server's canonical gate.
//
// HeartEventModal (components/courtship/HeartEventModal.tsx) fires from the
// real `heartEvent` field `/api/courtship/interact` returns when an affinity
// crossing unlocks an authored scene (courtInteraction → heart-events.js) —
// display only, never invented client-side.
//
// pregnancy-cache (components/courtship/pregnancy-cache.ts) is the only way
// this lens can show "pregnancy pending" across a reload: there is no
// courtship.listPregnancies / romance.pregnancies read macro in the backend
// (confirmed by grep), so we remember the real pregnancyId/dueAt this browser
// was handed at the moment `courtship.conceive` succeeded, and clear it once
// `courtship.birth` succeeds (or the server tells us the cached id is stale).

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Heart, Crown, Baby, Loader2, AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { useUIStore } from '@/store/ui';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { HeartEventModal, type HeartEventScene } from '@/components/courtship/HeartEventModal';
import { ConfirmDissolveModal } from '@/components/courtship/ConfirmDissolveModal';
import {
  loadCachedPregnancies,
  addCachedPregnancy,
  removeCachedPregnancy,
  type CachedPregnancy,
} from '@/components/courtship/pregnancy-cache';

interface Courtship {
  partner_kind: string;
  partner_id: string;
  affinity: number;
  status: string;
  started_at?: number;
  last_interaction?: number;
}
interface Marriage {
  id: string;
  partner_kind: string;
  partner_id: string;
  married_at: number;
  status?: string;
  dissolved_at?: number | null;
  dissolved_reason?: string | null;
}
// Matches the real player_children columns (migration 206).
interface Child {
  id: string;
  parent_user_id: string;
  other_parent_id?: string;
  name: string;
  maturity: string;
  born_at: number;
}

// Engine defaults (migration 206 / romance-engine.js). Used only until the
// live constants resolve; the backend value always wins once fetched.
const DEFAULT_ENGAGE_THRESHOLD = 0.7;
const DEFAULT_MARRY_THRESHOLD = 0.85;

type LoadState = 'loading' | 'error' | 'ready';

export default function CourtshipLensPage() {
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
          partnerLabel: `${c.partner_kind}:${c.partner_id.slice(0, 14)}`,
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

  return (
    <LensShell lensId="courtship">
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-pink-200">
            <Heart size={22} aria-hidden="true" /> Courtships
          </h1>
          <p className="text-sm text-zinc-400">Track affinity, propose, wed, raise children.</p>
        </header>

        {/* LOADING state */}
        {loadState === 'loading' && (
          <div
            data-testid="courtship-loading"
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-pink-500/20 bg-zinc-900/40 p-6 text-sm text-pink-200/80"
          >
            <Loader2 className="animate-spin" size={16} aria-hidden="true" />
            Loading your courtships…
          </div>
        )}

        {/* ERROR state — honest + retry */}
        {loadState === 'error' && (
          <div
            data-testid="courtship-error"
            role="alert"
            className="space-y-3 rounded-lg border border-red-500/40 bg-red-950/30 p-6"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
              <AlertTriangle size={16} aria-hidden="true" /> Couldn&apos;t load courtships
            </div>
            <p className="text-xs text-red-300/80">{errorMsg || 'Something went wrong.'}</p>
            <button
              type="button"
              aria-label="Retry loading courtships"
              onClick={refresh}
              className="inline-flex items-center gap-1 rounded bg-red-500/30 px-3 py-1.5 text-xs text-red-100 hover:bg-red-500/50"
            >
              <RefreshCw size={12} aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {/* READY state — genuine empty + populated */}
        {loadState === 'ready' && (
          <>
            {errorMsg && (
              <div role="alert" className="rounded border border-amber-500/40 bg-amber-950/30 p-2 text-xs text-amber-200">
                {errorMsg}
              </div>
            )}

            <section className="space-y-2" aria-labelledby="courtships-heading">
              <h2 id="courtships-heading" className="flex items-center gap-1 text-sm font-semibold text-pink-300">
                <SvgIcon name="heart" size={14} className="text-pink-300" /> Active courtships ({courtships.length})
              </h2>
              {courtships.length === 0 ? (
                <p data-testid="courtship-empty" className="text-xs text-zinc-500">
                  No active courtships yet. Initiate one from an NPC&apos;s context menu in the world,
                  then return here to track affinity, propose, and wed.
                </p>
              ) : (
                <ul data-testid="courtship-list" className="space-y-2">
                  {courtships.map((c) => {
                    const pct = Math.round((c.affinity || 0) * 100);
                    const canPropose =
                      c.affinity >= engageThreshold && c.status !== 'engaged' &&
                      c.status !== 'married' && c.status !== 'estranged' && c.status !== 'widowed';
                    const canWed = c.status === 'engaged' && c.affinity >= marryThreshold;
                    return (
                      <li key={`${c.partner_kind}:${c.partner_id}`} className="rounded-lg border border-pink-500/30 bg-zinc-900/50 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <div>
                            <div className="font-mono text-sm text-pink-100">{c.partner_kind}:{c.partner_id.slice(0, 14)}</div>
                            <div className="text-[10px] text-pink-300/60">status: {c.status}</div>
                          </div>
                          <div className="font-mono text-base text-pink-200" aria-label={`affinity ${pct} percent`}>{pct}%</div>
                        </div>
                        <div
                          className="mt-2 h-1 overflow-hidden rounded bg-zinc-800"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={-100}
                          aria-valuemax={100}
                        >
                          <div className="h-full bg-pink-500 transition-all" style={{ width: `${Math.max(0, pct)}%` }} />
                        </div>
                        <div className="mt-2 flex flex-col gap-1 sm:flex-row">
                          <button type="button" aria-label={`Interact positively with ${c.partner_id}`} onClick={() => interact(c, 1)} disabled={pending} className="flex-1 rounded bg-pink-500/30 px-2 py-1 text-[10px] text-pink-100 hover:bg-pink-500/50 disabled:opacity-50">
                            Interact (+)
                          </button>
                          {canPropose && (
                            <button type="button" aria-label={`Propose to ${c.partner_id}`} onClick={() => propose(c)} disabled={pending} className="rounded bg-amber-500/40 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/60 disabled:opacity-50">
                              Propose
                            </button>
                          )}
                          {canWed && (
                            <button type="button" aria-label={`Wed ${c.partner_id}`} onClick={() => wed(c)} disabled={pending} className="rounded bg-amber-500/50 px-2 py-1 text-[10px] font-bold text-amber-50 hover:bg-amber-500/70 disabled:opacity-50">
                              ⚭ Wed
                            </button>
                          )}
                        </div>
                        {!canPropose && c.status !== 'engaged' && c.status !== 'married' && (
                          <p className="mt-1 text-[10px] text-zinc-500">Reach {engagePct}% affinity to propose.</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="space-y-2" aria-labelledby="marriages-heading">
              <h2 id="marriages-heading" className="flex items-center gap-1 text-sm font-semibold text-amber-300">
                <Crown size={14} aria-hidden="true" /> Marriages ({marriages.length})
              </h2>
              {marriages.length === 0 ? (
                <p className="text-xs text-zinc-500">No active marriages.</p>
              ) : (
                <ul data-testid="marriage-list" className="space-y-1">
                  {marriages.map((m) => (
                    <li key={m.id} className="flex flex-col gap-1 rounded border border-amber-500/30 bg-amber-950/30 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-col">
                        <span className="font-mono text-amber-100">{m.partner_kind}:{m.partner_id.slice(0, 14)}</span>
                        <span className="text-amber-300/70">since {new Date(m.married_at * 1000).toLocaleDateString()}</span>
                      </div>
                      <div className="flex gap-1 self-start sm:self-auto">
                        {pregnancies.length === 0 && (
                          <button
                            type="button"
                            aria-label={`Try for a child with ${m.partner_id}`}
                            onClick={() => conceive(m)}
                            disabled={pending}
                            className="rounded bg-emerald-500/30 px-2 py-1 text-[10px] text-emerald-100 hover:bg-emerald-500/50 disabled:opacity-50"
                          >
                            Try for a child
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`End marriage to ${m.partner_id}`}
                          onClick={() => setDissolveTarget(m)}
                          disabled={pending}
                          className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/40 hover:text-red-100 disabled:opacity-50"
                        >
                          End Marriage
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {pastMarriages.length > 0 && (
              <section className="space-y-2" aria-labelledby="past-marriages-heading">
                <h2 id="past-marriages-heading" className="text-sm font-semibold text-zinc-400">
                  Past marriages ({pastMarriages.length})
                </h2>
                <ul data-testid="past-marriage-list" className="space-y-1">
                  {pastMarriages.map((m) => (
                    <li key={m.id} className="flex flex-col gap-0.5 rounded border border-zinc-700/50 bg-zinc-900/40 p-2 text-xs">
                      <span className="font-mono text-zinc-300">{m.partner_kind}:{m.partner_id.slice(0, 14)}</span>
                      <span className="text-zinc-500">
                        {new Date(m.married_at * 1000).toLocaleDateString()}
                        {m.dissolved_at ? ` – ${new Date(m.dissolved_at * 1000).toLocaleDateString()}` : ''}
                        {m.dissolved_reason ? ` (${m.dissolved_reason})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {pregnancies.length > 0 && (
              <section className="space-y-2" aria-labelledby="pregnancies-heading">
                <h2 id="pregnancies-heading" className="flex items-center gap-1 text-sm font-semibold text-fuchsia-300">
                  <Sparkles size={14} aria-hidden="true" /> Pending pregnancies ({pregnancies.length})
                </h2>
                <ul data-testid="pregnancy-list" className="space-y-1">
                  {pregnancies.map((p) => {
                    const due = p.dueAt <= Math.floor(Date.now() / 1000);
                    return (
                      <li key={p.pregnancyId} className="flex flex-col gap-1 rounded border border-fuchsia-500/30 bg-fuchsia-950/20 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-col">
                          <span className="font-mono text-fuchsia-100">{p.partnerKind}:{p.partnerId.slice(0, 14)}</span>
                          <span className="text-fuchsia-300/70">
                            {due ? 'ready to birth' : `due ${new Date(p.dueAt * 1000).toLocaleDateString()}`}
                          </span>
                        </div>
                        {due && (
                          <button
                            type="button"
                            aria-label="Birth this child"
                            onClick={() => birth(p)}
                            disabled={pending}
                            className="self-start rounded bg-fuchsia-500/40 px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-500/60 disabled:opacity-50 sm:self-auto"
                          >
                            <Baby size={11} className="mr-1 inline" aria-hidden="true" /> Birth
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section className="space-y-2" aria-labelledby="children-heading">
              <h2 id="children-heading" className="flex items-center gap-1 text-sm font-semibold text-emerald-300">
                <Baby size={14} aria-hidden="true" /> Children ({children.length})
              </h2>
              {children.length === 0 ? (
                <p className="text-xs text-zinc-500">No children.</p>
              ) : (
                <ul className="space-y-1">
                  {children.map((c) => (
                    <li key={c.id} className="flex flex-col gap-1 rounded border border-emerald-500/30 bg-emerald-950/30 p-2 text-xs sm:flex-row sm:justify-between">
                      <span className="font-mono text-emerald-100">{c.name || c.id.slice(0, 16)}</span>
                      <span className="text-emerald-300/70">{c.maturity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {pending && (
          <div role="status" aria-live="polite" className="text-center text-xs text-pink-300/70">
            <Loader2 className="inline animate-spin" size={11} aria-hidden="true" /> updating…
          </div>
        )}
      </div>

      {heartEvent && (
        <HeartEventModal
          scene={heartEvent.scene}
          partnerLabel={heartEvent.partnerLabel}
          onClose={() => setHeartEvent(null)}
        />
      )}

      {dissolveTarget && (
        <ConfirmDissolveModal
          partnerLabel={`${dissolveTarget.partner_kind}:${dissolveTarget.partner_id.slice(0, 14)}`}
          pending={pending}
          onConfirm={confirmDissolve}
          onCancel={() => setDissolveTarget(null)}
        />
      )}
    </LensShell>
  );
}
