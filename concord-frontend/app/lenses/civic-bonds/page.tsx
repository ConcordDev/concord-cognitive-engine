'use client';

import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensCommand } from '@/hooks/useLensCommand';

/**
 * Civic Bonds lens — the transparency surface for the micro-bond engine.
 *
 * Active bonds per world with a progress bar to target + the 110% funding-gate
 * line; pledge (denomination-stepped, sparks), vote, fund (ruler), and the
 * public ledger (every pledge). Calls the `civic_bonds` macro domain via
 * /api/lens/run. Behind CONCORD_CIVIC_BONDS server-side — when off the macros
 * return { ok:false, reason:'disabled' } and the lens shows the coming-soon note.
 *
 * Four explicit UX states (pinned by tests/civic-bonds-lens-states.test.tsx):
 *   LOADING — the bond list is in flight (role=status, aria-busy)
 *   ERROR   — a list call failed (role=alert) + Retry
 *   EMPTY   — no bonds yet (honest "nothing here") / disabled coming-soon note
 *   READY   — real active bonds with pledge/vote/fund controls
 * a11y: every input + button carries an accessible name; controls are native
 * <button> elements. Presentation is mobile-first Tailwind + reduced-motion-aware.
 *
 * Restricted spillover fund (checklist item 7, docs/lens-specs/civic-bonds-
 * capability-map.md): `spillover` takes an arbitrary `scope` string, so the
 * natural selector is the real GOVERNANCE_SCOPES tier hierarchy (town->city->
 * county->state->national->international — the same canonical list migration
 * 305's `civic_bonds.scope` column comment points at), fetched from the new
 * `civic_bonds.scopes` macro — never a free-text field or an invented list.
 * The panel only renders once real scopes have loaded; a disabled backend or
 * a failed fetch means zero scopes, which honestly hides the panel instead of
 * showing a broken empty picker.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { RefreshCw } from 'lucide-react';
import { useUIStore } from '@/store/ui';

interface Bond {
  id: string;
  world_id: string;
  realm_id: string | null;
  title: string;
  description: string | null;
  status: string;
  target_amount: number;
  current_pledged: number;
  denomination: number;
  funding_gate_pct: number;
  return_rate: number;
  votes_for: number;
  votes_against: number;
  labor_source: string;
}

interface Pledge { id: string; entity_kind: string; entity_id: string; amount: number; status: string; pledged_at?: number }
interface Milestone { idx: number; description?: string; release_pct: number; status: string; completed_at?: number | null }
interface Ledger { pledges: Pledge[]; milestones: Milestone[] }

function activeWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}

// Mirror the server-side fail-CLOSED numeric guard (server/lib/civic-bonds.js
// rejects bad amounts) so the client never POSTs a NaN/Infinity/negative pledge.
function badAmount(n: number, denomination: number): boolean {
  return !Number.isFinite(n) || n <= 0 || n > 1e9 || n % denomination !== 0;
}

export default function CivicBondsLens() {
  const [worldId] = useState(activeWorldId);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ledgers, setLedgers] = useState<Record<string, Ledger>>({});
  const [ledgerLoading, setLedgerLoading] = useState<Record<string, boolean>>({});
  const [scopes, setScopes] = useState<string[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>('');
  const [spilloverAmount, setSpilloverAmount] = useState<number | null>(null);
  const [spilloverLoading, setSpilloverLoading] = useState(false);
  // Create drive form — macros are auth-gated (not role-gated); blank title is
  // blocked client-side and again by createBond's missing_inputs.
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTarget, setDraftTarget] = useState(20);
  const [creating, setCreating] = useState(false);
  const addToast = useUIStore((s) => s.addToast);
  const titleReady = draftTitle.trim().length > 0;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = (await lensRun<{ ok: boolean; reason?: string; bonds?: Bond[] }>('civic_bonds', 'list', { worldId })).data.result;
      if (r?.reason === 'disabled') { setDisabled(true); setBonds([]); }
      else { setDisabled(false); setBonds(r?.bonds || []); }
    } catch { setError('Failed to load civic bonds. Check your connection and retry.'); }
    finally { setLoading(false); }
  }, [worldId]);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  // The real per-scope selector for the spillover balance: fetch the
  // canonical GOVERNANCE_SCOPES tiers (never invented, never free-text).
  const fetchScopes = useCallback(async () => {
    try {
      const r = (await lensRun<{ ok: boolean; scopes?: string[] }>('civic_bonds', 'scopes', {})).data.result;
      const list = r?.ok && Array.isArray(r.scopes) ? r.scopes : [];
      setScopes(list);
      setSelectedScope((prev) => (prev && list.includes(prev) ? prev : (list.includes('city') ? 'city' : (list[0] || ''))));
    } catch { setScopes([]); }
  }, []);

  useEffect(() => { void Promise.resolve().then(fetchScopes); }, [fetchScopes]);

  // Restricted spillover fund balance for the selected scope + this world.
  const fetchSpillover = useCallback(async () => {
    if (!selectedScope) { setSpilloverAmount(null); return; }
    setSpilloverLoading(true);
    try {
      const r = (await lensRun<{ ok: boolean; amount?: number }>('civic_bonds', 'spillover', { scope: selectedScope, worldId })).data.result;
      setSpilloverAmount(r?.ok ? (r.amount ?? 0) : null);
    } catch { setSpilloverAmount(null); }
    finally { setSpilloverLoading(false); }
  }, [selectedScope, worldId]);

  useEffect(() => { void Promise.resolve().then(fetchSpillover); }, [fetchSpillover]);

  const act = useCallback(async (action: string, input: Record<string, unknown>) => {
    setNote(null);
    try {
      // On 400s lensRun's catch returns { result: null, error: body.error } —
      // the server reason (insufficient_sparks, not_open_for_pledges, no_pledge)
      // lives on error, not result.reason. Prefer result.reason when present,
      // then the envelope error (announcements / services desk pattern).
      const envelope = (await lensRun<{ ok: boolean; reason?: string }>('civic_bonds', action, input)).data;
      const r = envelope.result;
      const reason =
        (r && typeof r === 'object' && typeof r.reason === 'string' && r.reason) ||
        (typeof envelope.error === 'string' && envelope.error) ||
        (typeof envelope.reason === 'string' && envelope.reason) ||
        null;
      if (!r?.ok) {
        setNote(`${action}: ${reason || 'failed'}`);
        addToast({ type: 'error', message: `${action} failed: ${reason || 'unknown error'}` });
      } else {
        setNote(`${action} ✓`);
        addToast({ type: 'success', message: `${action} succeeded`, duration: 2500 });
      }
      await refresh();
    } catch {
      setNote(`${action}: error`);
      addToast({ type: 'error', message: `${action} request failed` });
    }
  }, [refresh, addToast]);

  // The public ledger (every pledge + milestone) — lazy-loaded per bond so the
  // list view stays cheap; toggled open with the "Ledger" disclosure below.
  const toggleLedger = useCallback(async (bondId: string) => {
    const willOpen = !expanded[bondId];
    setExpanded((m) => ({ ...m, [bondId]: willOpen }));
    if (willOpen && !ledgers[bondId]) {
      setLedgerLoading((m) => ({ ...m, [bondId]: true }));
      try {
        const r = (await lensRun<{ ok: boolean; pledges?: Pledge[]; milestones?: Milestone[] }>('civic_bonds', 'ledger', { bondId })).data.result;
        if (r?.ok) setLedgers((m) => ({ ...m, [bondId]: { pledges: r.pledges || [], milestones: r.milestones || [] } }));
      } finally {
        setLedgerLoading((m) => ({ ...m, [bondId]: false }));
      }
    }
  }, [expanded, ledgers]);

  const unpledge = useCallback(async (bondId: string) => {
    await act('unpledge', { bondId });
    // an unpledge changes the pledge ledger too — drop the cached copy so
    // the next expand re-fetches instead of showing stale escrow rows.
    setLedgers((m) => { const n = { ...m }; delete n[bondId]; return n; });
  }, [act]);

  const createDrive = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title) {
      setNote('create: title required');
      addToast({ type: 'error', message: 'create failed: title required' });
      return;
    }
    setCreating(true);
    try {
      const envelope = (await lensRun<{ ok: boolean; reason?: string; bondId?: string }>('civic_bonds', 'create', {
        worldId,
        title,
        description: draftDescription.trim() || undefined,
        targetAmount: Math.max(1, Math.trunc(Number(draftTarget) || 0)),
        denomination: 1,
        quorum: 1,
        returnRate: 0,
      })).data;
      const r = envelope.result;
      const reason =
        (r && typeof r === 'object' && typeof r.reason === 'string' && r.reason) ||
        (typeof envelope.error === 'string' && envelope.error) ||
        null;
      if (!r?.ok) {
        setNote(`create: ${reason || 'failed'}`);
        addToast({ type: 'error', message: `create failed: ${reason || 'unknown error'}` });
      } else {
        setNote('create ✓');
        addToast({ type: 'success', message: 'create succeeded', duration: 2500 });
        setDraftTitle('');
        setDraftDescription('');
        setDraftTarget(20);
      }
      await refresh();
    } catch {
      setNote('create: error');
      addToast({ type: 'error', message: 'create request failed' });
    } finally {
      setCreating(false);
    }
  }, [draftTitle, draftDescription, draftTarget, worldId, refresh, addToast]);

  useLensCommand(
    [{ id: 'civic-refresh', keys: 'r', description: 'Refresh civic bonds', category: 'actions' as const, action: () => void refresh() }],
    { lensId: 'civic-bonds' },
  );

  return (
    <LensShell lensId="civic-bonds" asMain={false}>
      <NorthStarFrame
        lensId="civic-bonds"
        crumb={`Civic Bonds · ${worldId}`}
        subtitle="Pledge sparks to community projects, vote on drives, and audit every pledge on the public ledger."
        actions={
          <button onClick={() => void refresh()} className="rounded-full border border-white/10 p-2 text-zinc-400 hover:text-white" aria-label="Refresh civic bonds">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        }
        cta={{ label: 'Refresh bonds', icon: RefreshCw, onClick: () => void refresh(), title: 'Reload bonds, ledger and spillover fund (R)' }}
      >
    <div className="w-full">
      {note && <div role="status" aria-live="polite" className="mb-3 text-sm text-amber-300">{note}</div>}

      {/* Open a drive — create is auth-gated server-side (not admin/ruler-only);
          blank/whitespace titles stay client-gated and re-validated by createBond. */}
      {!error && !disabled && (
        <section
          aria-label="Open a civic bond drive"
          data-testid="civic-bonds-create"
          className="mb-4 rounded-2xl border border-white/10 bg-[#111] p-4"
        >
          <div className="text-sm font-medium text-gray-200 mb-2">Open a drive</div>
          <p className="text-xs text-gray-500 mb-3">
            Propose a sparks-backed project for this world. After create, use Open on the card to move it into voting.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor="civic-bond-title" className="block text-xs text-gray-400 mb-1">Title</label>
              <input
                id="civic-bond-title"
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Community project title"
                className="w-full px-2 py-1.5 rounded bg-black/30 border border-white/10 text-sm"
                aria-label="Bond title"
              />
            </div>
            <div className="w-full sm:w-28">
              <label htmlFor="civic-bond-target" className="block text-xs text-gray-400 mb-1">Target (sparks)</label>
              <input
                id="civic-bond-target"
                type="number"
                min={1}
                step={1}
                value={draftTarget}
                onChange={(e) => setDraftTarget(Number(e.target.value))}
                className="w-full px-2 py-1.5 rounded bg-black/30 border border-white/10 text-sm"
                aria-label="Target amount in sparks"
              />
            </div>
            <button
              type="button"
              data-testid="civic-bonds-create-submit"
              onClick={() => void createDrive()}
              disabled={!titleReady || creating}
              className="px-3 py-1.5 rounded bg-amber-500/20 text-amber-200 text-sm hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Create civic bond"
            >
              {creating ? 'Creating…' : 'Create bond'}
            </button>
          </div>
          <div className="mt-2">
            <label htmlFor="civic-bond-description" className="block text-xs text-gray-400 mb-1">Description (optional)</label>
            <textarea
              id="civic-bond-description"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 rounded bg-black/30 border border-white/10 text-sm"
              aria-label="Bond description"
            />
          </div>
        </section>
      )}

      {/* Restricted spillover fund — real GOVERNANCE_SCOPES picker, hidden
          honestly (not with a fake empty dropdown) when no scopes loaded. */}
      {scopes.length > 0 && (
        <section
          aria-label="Restricted spillover fund"
          data-testid="civic-bonds-spillover"
          className="mb-4 rounded-2xl border border-white/10 bg-[#111] p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="spillover-scope" className="text-sm text-gray-300">Restricted spillover fund</label>
              <select
                id="spillover-scope"
                aria-label="Spillover fund scope"
                value={selectedScope}
                onChange={(e) => setSelectedScope(e.target.value)}
                className="px-2 py-1 rounded bg-black/30 border border-white/10 text-sm"
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div data-testid="civic-bonds-spillover-balance" className="text-sm">
              {spilloverLoading ? (
                <span role="status" aria-live="polite" className="text-gray-400">Loading…</span>
              ) : spilloverAmount === null ? (
                <span className="text-gray-500">Unavailable</span>
              ) : (
                <span className="text-amber-200 font-medium">{spilloverAmount.toLocaleString()} sparks</span>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Restricted residue from completed bond closeouts at this scope, held for the next
            project in {worldId}.
          </p>
        </section>
      )}

      {/* STATE 1 — error */}
      {error && (
        <div data-testid="civic-bonds-error" role="alert" className="rounded border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
          {error}{' '}
          <button onClick={() => void refresh()} className="underline hover:text-white" aria-label="Retry loading civic bonds">Retry</button>
        </div>
      )}

      {/* by-design coming-soon (kill-switch off) */}
      {!error && disabled && (
        <div data-testid="civic-bonds-disabled" role="status" className="rounded border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
          Civic Bonds are coming soon — the engine is wired but the feature is currently disabled
          (<code>CONCORD_CIVIC_BONDS</code>).
        </div>
      )}

      {/* STATE 2 — loading */}
      {!error && loading && (
        <div data-testid="civic-bonds-loading" role="status" aria-busy="true" aria-live="polite" className="text-gray-400 text-sm">Loading…</div>
      )}

      {/* STATE 3 — empty */}
      {!error && !loading && !disabled && bonds.length === 0 && (
        <div data-testid="civic-bonds-empty" role="status" className="text-gray-400 text-sm">
          No civic bonds in this world yet. Use Open a drive above to propose one, then Open it for voting.
        </div>
      )}

      {/* STATE 4 — data */}
      {!error && !loading && !disabled && bonds.length > 0 && (
        <ul data-testid="civic-bonds-list" className="grid grid-cols-1 gap-4 xl:grid-cols-2 animate-in fade-in duration-200 motion-reduce:animate-none" aria-label="Active civic bonds">
          {bonds.map((b) => {
          const pct = Math.min(100, Math.round((b.current_pledged / b.target_amount) * 100));
          const gatePct = Math.round(b.funding_gate_pct * 100);
          const cleared = b.current_pledged >= b.target_amount * b.funding_gate_pct;
          const amount = amounts[b.id] ?? b.denomination;
          return (
            <li key={b.id} className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div className="font-medium">{b.title}</div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300 self-start sm:self-auto">{b.status}</span>
              </div>
              {b.description && <div className="text-sm text-gray-400 mt-0.5">{b.description}</div>}

              <div className="mt-3 h-2 bg-white/10 rounded relative">
                <div className="absolute inset-y-0 left-0 bg-amber-400 rounded" style={{ width: `${pct}%` }} />
                {/* the 110% gate line */}
                <div className="absolute inset-y-0 w-px bg-emerald-300" style={{ left: `${Math.min(100, gatePct)}%` }} title={`${gatePct}% funding gate`} />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>{b.current_pledged.toLocaleString()} / {b.target_amount.toLocaleString()} sparks</span>
                <span className={cleared ? 'text-emerald-300' : ''}>{cleared ? 'gate cleared' : `needs ${gatePct}%`}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 mt-3">
                <input
                  type="number" min={b.denomination} step={b.denomination} value={amount}
                  onChange={(e) => setAmounts((m) => ({ ...m, [b.id]: Number(e.target.value) }))}
                  className="w-full sm:w-24 px-2 py-1 rounded bg-black/30 border border-white/10 text-sm"
                  aria-label="Pledge amount (sparks)"
                />
                {b.status === 'proposed' && (
                  <button
                    onClick={() => void act('open', { bondId: b.id })}
                    className="px-3 py-1 rounded bg-sky-500/20 text-sky-200 text-sm hover:bg-sky-500/30"
                    aria-label={`Open ${b.title} for voting`}
                    data-testid={`civic-bonds-open-${b.id}`}
                  >Open</button>
                )}
                <button
                  onClick={() => {
                    if (badAmount(amount, b.denomination)) {
                      setNote(`pledge: amount must be a positive multiple of ${b.denomination}`);
                      addToast({ type: 'error', message: `Pledge must be a positive multiple of ${b.denomination}` });
                      return;
                    }
                    void act('pledge', { bondId: b.id, amount });
                  }}
                  disabled={badAmount(amount, b.denomination)}
                  className="px-3 py-1 rounded bg-amber-500/20 text-amber-200 text-sm hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`Pledge to ${b.title}`}
                >Pledge</button>
                {['voting', 'funding'].includes(b.status) && (
                  <button
                    onClick={() => void unpledge(b.id)}
                    className="px-3 py-1 rounded bg-white/5 text-gray-300 text-sm hover:bg-white/10"
                    aria-label={`Refund my pledge to ${b.title}`}
                    title="Refund your unfilled escrow while the bond is still open"
                  >Unpledge</button>
                )}
                {b.status === 'voting' && (
                  <>
                    <button onClick={() => void act('vote', { bondId: b.id, vote: 'for' })} className="px-3 py-1 rounded bg-emerald-500/20 text-emerald-200 text-sm" aria-label={`Vote for ${b.title}`}>Vote for</button>
                    <button onClick={() => void act('vote', { bondId: b.id, vote: 'against' })} className="px-3 py-1 rounded bg-rose-500/20 text-rose-200 text-sm" aria-label={`Vote against ${b.title}`}>Against</button>
                  </>
                )}
                {cleared && (b.status === 'voting' || b.status === 'funding') && (
                  <button onClick={() => void act('fund', { bondId: b.id })} className="px-3 py-1 rounded bg-emerald-500/30 text-emerald-100 text-sm font-medium" aria-label={`Fund ${b.title}`}>Fund (110% met)</button>
                )}
                <button
                  onClick={() => void toggleLedger(b.id)}
                  className="px-3 py-1 rounded bg-white/5 text-gray-300 text-sm hover:bg-white/10"
                  aria-expanded={!!expanded[b.id]}
                  aria-label={expanded[b.id] ? `Hide ledger for ${b.title}` : `Show public ledger for ${b.title}`}
                >{expanded[b.id] ? 'Hide ledger' : 'Ledger'}</button>
                <span className="text-xs text-gray-500 sm:ml-auto">▲{b.votes_for} ▼{b.votes_against} · {b.labor_source}</span>
              </div>

              {expanded[b.id] && (
                <div data-testid={`civic-bond-ledger-${b.id}`} className="mt-3 border-t border-white/10 pt-3 text-xs">
                  {ledgerLoading[b.id] ? (
                    <div role="status" aria-live="polite" className="text-gray-400">Loading ledger…</div>
                  ) : (
                    <>
                      <div className="text-gray-400 font-medium mb-1">Public pledge ledger</div>
                      {(ledgers[b.id]?.pledges?.length ?? 0) === 0 ? (
                        <div className="text-gray-500">No pledges recorded yet.</div>
                      ) : (
                        <ul className="space-y-0.5">
                          {ledgers[b.id]!.pledges.map((p) => (
                            <li key={p.id} className="flex justify-between text-gray-300">
                              <span>{p.entity_kind} · {p.entity_id}</span>
                              <span className="text-amber-200">{p.amount.toLocaleString()} sparks · {p.status}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {(ledgers[b.id]?.milestones?.length ?? 0) > 0 && (
                        <>
                          <div className="text-gray-400 font-medium mt-2 mb-1">Milestones</div>
                          <ul className="space-y-0.5">
                            {ledgers[b.id]!.milestones.map((m) => (
                              <li key={m.idx} className="flex justify-between text-gray-300">
                                <span>{m.idx + 1}. {m.description || 'milestone'}</span>
                                <span className={m.status === 'complete' ? 'text-emerald-300' : 'text-gray-500'}>
                                  {m.status} · {Math.round(m.release_pct * 100)}% release
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
        </ul>
      )}
    </div>
      </NorthStarFrame>
    </LensShell>
  );
}
