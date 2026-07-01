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
//
// The propose/marry floors are NOT duplicated here — they come from the
// engine via courtship.constants so the lens can never drift from the
// server's canonical gate.

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Heart, Crown, Baby, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useUIStore } from '@/store/ui';

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
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not load your courtships.');
      setLoadState('error');
      addToast({ type: 'error', message: 'Could not load your courtships' });
    }
  }, [addToast]);

  useEffect(() => { refresh(); }, [refresh]);

  const act = useCallback(async (path: string, body: Record<string, unknown>) => {
    setPending(true);
    try {
      const r = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || j?.ok === false) {
        setErrorMsg(j?.reason ? `Action failed: ${j.reason}` : `Action failed (${r.status}).`);
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

  const interact = (c: Courtship, sentiment: number) =>
    act('/api/courtship/interact', { partnerKind: c.partner_kind, partnerId: c.partner_id, sentiment });
  const propose = (c: Courtship) =>
    act('/api/courtship/propose', { partnerKind: c.partner_kind, partnerId: c.partner_id });
  const wed = (c: Courtship) =>
    act('/api/courtship/wed', { partnerKind: c.partner_kind, partnerId: c.partner_id });

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
              <h2 id="courtships-heading" className="text-sm font-semibold text-pink-300">
                Active courtships ({courtships.length})
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
                <ul className="space-y-1">
                  {marriages.map((m) => (
                    <li key={m.id} className="flex flex-col gap-1 rounded border border-amber-500/30 bg-amber-950/30 p-2 text-xs sm:flex-row sm:justify-between">
                      <span className="font-mono text-amber-100">{m.partner_kind}:{m.partner_id.slice(0, 14)}</span>
                      <span className="text-amber-300/70">since {new Date(m.married_at * 1000).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

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
    </LensShell>
  );
}
