'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Civic Bonds lens — the transparency surface for the micro-bond engine.
 *
 * Active bonds per world with a progress bar to target + the 110% funding-gate
 * line; pledge (denomination-stepped, sparks), vote, fund (ruler), and the
 * public ledger (every pledge). Calls the `civic_bonds` macro domain via
 * /api/lens/run. Behind CONCORD_CIVIC_BONDS server-side — when off the macros
 * return { ok:false, reason:'disabled' } and the lens shows the coming-soon note.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Landmark, RefreshCw } from 'lucide-react';

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

function activeWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}

export default function CivicBondsLens() {
  const [worldId] = useState(activeWorldId);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = (await lensRun<{ ok: boolean; reason?: string; bonds?: Bond[] }>('civic_bonds', 'list', { worldId })).data.result;
      if (r?.reason === 'disabled') { setDisabled(true); setBonds([]); }
      else { setDisabled(false); setBonds(r?.bonds || []); }
    } catch { setNote('Failed to load bonds.'); }
    finally { setLoading(false); }
  }, [worldId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = useCallback(async (action: string, input: Record<string, unknown>) => {
    setNote(null);
    try {
      const r = (await lensRun<{ ok: boolean; reason?: string }>('civic_bonds', action, input)).data.result;
      if (!r?.ok) setNote(`${action}: ${r?.reason || 'failed'}`);
      else setNote(`${action} ✓`);
      await refresh();
    } catch { setNote(`${action}: error`); }
  }, [refresh]);

  return (
    <LensShell lensId="civic-bonds">
    <div className="max-w-3xl mx-auto p-6 text-gray-100">
      <header className="flex items-center justify-between mb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-amber-200">
          <Landmark className="w-5 h-5" /> Civic Bonds
          <span className="text-xs text-gray-400 font-normal">· {worldId}</span>
        </h1>
        <button onClick={() => void refresh()} className="text-gray-400 hover:text-white" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {note && <div className="mb-3 text-sm text-amber-300">{note}</div>}
      {disabled && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
          Civic Bonds are coming soon — the engine is wired but the feature is currently disabled
          (<code>CONCORD_CIVIC_BONDS</code>).
        </div>
      )}
      {loading && <div className="text-gray-400 text-sm">Loading…</div>}
      {!loading && !disabled && bonds.length === 0 && (
        <div className="text-gray-400 text-sm">No civic bonds in this world yet. A realm ruler can open a drive to fund a project.</div>
      )}

      <ul className="space-y-4">
        {bonds.map((b) => {
          const pct = Math.min(100, Math.round((b.current_pledged / b.target_amount) * 100));
          const gatePct = Math.round(b.funding_gate_pct * 100);
          const cleared = b.current_pledged >= b.target_amount * b.funding_gate_pct;
          const amount = amounts[b.id] ?? b.denomination;
          return (
            <li key={b.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{b.title}</div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300">{b.status}</span>
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

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <input
                  type="number" min={b.denomination} step={b.denomination} value={amount}
                  onChange={(e) => setAmounts((m) => ({ ...m, [b.id]: Number(e.target.value) }))}
                  className="w-24 px-2 py-1 rounded bg-black/30 border border-white/10 text-sm"
                  aria-label="Pledge amount (sparks)"
                />
                <button onClick={() => void act('pledge', { bondId: b.id, amount })} className="px-3 py-1 rounded bg-amber-500/20 text-amber-200 text-sm hover:bg-amber-500/30">Pledge</button>
                {b.status === 'voting' && (
                  <>
                    <button onClick={() => void act('vote', { bondId: b.id, vote: 'for' })} className="px-3 py-1 rounded bg-emerald-500/20 text-emerald-200 text-sm">Vote for</button>
                    <button onClick={() => void act('vote', { bondId: b.id, vote: 'against' })} className="px-3 py-1 rounded bg-rose-500/20 text-rose-200 text-sm">Against</button>
                  </>
                )}
                {cleared && (b.status === 'voting' || b.status === 'funding') && (
                  <button onClick={() => void act('fund', { bondId: b.id })} className="px-3 py-1 rounded bg-emerald-500/30 text-emerald-100 text-sm font-medium">Fund (110% met)</button>
                )}
                <span className="text-xs text-gray-500 ml-auto">▲{b.votes_for} ▼{b.votes_against} · {b.labor_source}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
    </LensShell>
  );
}
