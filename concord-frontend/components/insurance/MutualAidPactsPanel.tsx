'use client';

/**
 * MutualAidPactsPanel — surfaces the insurance lens's peer-to-peer mutual-aid pact
 * substrate (the insurance.pact-* macros were registered backend-side but had ZERO UI —
 * a whole feature dead client-side). A pact: the insured pays a premium; named
 * beneficiaries receive a sparks payout if the insured "falls in Concordia". Covers
 * write, list (written + beneficiary-of), respond (handshake), pay-premium, schedule,
 * renew / auto-renew, revoke, record-payout, and payout history.
 */

import { useCallback, useEffect, useState } from 'react';
import { Shield, Plus, Loader2, AlertTriangle, RefreshCw, Ban, Check, X, Coins, History } from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface Beneficiary { userId: string; sharePct: number; accepted?: boolean }
interface Pact {
  id: string; insuredUserId: string; beneficiaries: Beneficiary[];
  payoutSparks: number; premiumSparks: number; premiumFrequency: 'upfront' | 'weekly' | 'monthly';
  autoRenew?: boolean; status: string; armed?: boolean; expiresAt?: number; durationDays?: number;
  renewCount?: number; nextPremiumDueAt?: number | null; premiumPaidSparks?: number;
  myShare?: { sharePct: number; accepted?: boolean };
}
interface Payout { id: string; pactId: string; cause: string; firedAt: number; totalSparks?: number; mySparks?: number; insuredUserId?: string }

// The shared pact store keeps timestamps in SECONDS (pactNow in
// server/domains/insurance.js is Date.now()/1000) — Death Insurance's
// PactCard converts with ×1000; this panel fed the raw seconds to
// new Date() as milliseconds and printed January 1970 (F5).
const fmtDate = (unixSec: number): string => new Date(unixSec * 1000).toLocaleDateString();

const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  expired: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  revoked: 'text-zinc-400 border-zinc-600/40 bg-zinc-600/10',
  fired: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
};

export function MutualAidPactsPanel({ className }: { className?: string }) {
  const { user } = useAuth();
  // Beneficiary picker (FIX-insurance-014): search the user directory
  // instead of demanding a raw user id the writer has no way to know.
  const [benQuery, setBenQuery] = useState('');
  const [benResults, setBenResults] = useState<Array<{ id: string; username: string; displayName: string }>>([]);
  const [benNote, setBenNote] = useState('');
  const [benBusy, setBenBusy] = useState(false);
  const searchBeneficiary = async () => {
    const q = benQuery.trim().replace(/^@/, '');
    if (!q) { setBenNote('Type a username to search the directory.'); return; }
    setBenBusy(true); setBenNote('');
    try {
      const r = await api.get('/api/social/users/search', { params: { q } });
      const users = (r.data?.users ?? []) as Array<{ id: string; username: string; displayName: string }>;
      setBenResults(users.slice(0, 6));
      if (users.length === 0) setBenNote(`No Concord user matches '${q}'.`);
    } catch { setBenNote('Could not search the directory just now — try again, or paste a user id below.'); }
    finally { setBenBusy(false); }
  };
  const [written, setWritten] = useState<Pact[]>([]);
  const [beneficiaryOf, setBeneficiaryOf] = useState<Pact[]>([]);
  const [payouts, setPayouts] = useState<{ paidOut: Payout[]; received: Payout[] }>({ paidOut: [], received: [] });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ beneficiaryUserId: '', payoutSparks: '100', premiumSparks: '10', durationDays: '30', premiumFrequency: 'upfront' as const });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [l, h] = await Promise.all([
        lensRun('insurance', 'pact-list', {}),
        lensRun('insurance', 'pact-payout-history', {}),
      ]);
      setWritten((l?.data?.result?.written || []) as Pact[]);
      setBeneficiaryOf((l?.data?.result?.beneficiaryOf || []) as Pact[]);
      setPayouts({ paidOut: (h?.data?.result?.paidOut || []) as Payout[], received: (h?.data?.result?.received || []) as Payout[] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pacts');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (action: string, params: Record<string, unknown>, id: string) => {
    setBusyId(id); setError(null);
    try {
      const r = await lensRun('insurance', action, params);
      // lensRun returns { ok:false, result:null, error } on the failure path,
      // so `r.data.result.error` could never fire — `r.data.error` is the
      // only live read here.
      if (r?.data?.error) setError(String(r.data.error));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally { setBusyId(null); }
  }, [load]);

  const write = useCallback(async () => {
    if (!form.beneficiaryUserId.trim()) { setError('A beneficiary user id is required.'); return; }
    const payoutSparks = Number(form.payoutSparks) || 0;
    const premiumSparks = Number(form.premiumSparks) || 0;
    if (payoutSparks <= 0 || premiumSparks <= 0) { setError('Payout and premium must be > 0.'); return; }
    setBusyId('new'); setError(null);
    try {
      const r = await lensRun('insurance', 'pact-write', {
        beneficiaryUserId: form.beneficiaryUserId.trim(),
        payoutSparks, premiumSparks,
        durationDays: Number(form.durationDays) || 30,
        premiumFrequency: form.premiumFrequency,
      });
      if (r?.data?.error) { setError(String(r.data.error)); return; }
      setShowForm(false);
      setForm({ beneficiaryUserId: '', payoutSparks: '100', premiumSparks: '10', durationDays: '30', premiumFrequency: 'upfront' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to write pact');
    } finally { setBusyId(null); }
  }, [form, load]);

  const renderPact = (p: Pact, asBeneficiary: boolean) => {
    const busy = busyId === p.id;
    const sc = STATUS_COLOR[p.status] || STATUS_COLOR.revoked;
    return (
      <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border capitalize', sc)}>{p.status}</span>
          <span className="text-xs text-zinc-200 font-semibold inline-flex items-center gap-1"><Coins className="w-3 h-3 text-amber-300" />{p.payoutSparks} payout</span>
          <span className="text-[11px] text-zinc-400">premium {p.premiumSparks} / {p.premiumFrequency}</span>
          {busy && <Loader2 className="w-3 h-3 animate-spin text-zinc-500 ml-auto" />}
        </div>
        {asBeneficiary ? (
          <div className="text-[11px] text-zinc-400">
            Insured <span className="font-mono text-zinc-300">{p.insuredUserId.slice(0, 10)}</span>
            {p.myShare && <> · your share {p.myShare.sharePct}% · {p.myShare.accepted ? <span className="text-emerald-300">accepted</span> : <span className="text-amber-300">pending</span>}</>}
          </div>
        ) : (
          <div className="text-[11px] text-zinc-400">
            {p.beneficiaries.length} beneficiar{p.beneficiaries.length === 1 ? 'y' : 'ies'}
            {p.expiresAt && <> · expires {fmtDate(p.expiresAt)}</>}
            {p.renewCount ? <> · renewed ×{p.renewCount}</> : null}
            {p.autoRenew && <span className="text-cyan-300"> · auto-renew</span>}
          </div>
        )}
        {/* Actions */}
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {asBeneficiary ? (
            <>
              <button type="button" disabled={busy} onClick={() => void act('pact-respond', { pactId: p.id, accept: true }, p.id)}
                className="text-[11px] px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 inline-flex items-center gap-1"><Check className="w-3 h-3" />Accept</button>
              <button type="button" disabled={busy} onClick={() => void act('pact-respond', { pactId: p.id, accept: false }, p.id)}
                className="text-[11px] px-2 py-0.5 rounded border border-zinc-600/40 text-zinc-300 hover:bg-zinc-700/30 inline-flex items-center gap-1"><X className="w-3 h-3" />Decline</button>
            </>
          ) : (
            <>
              {p.status === 'active' && p.premiumFrequency !== 'upfront' && (
                <button type="button" disabled={busy} onClick={() => void act('pact-pay-premium', { pactId: p.id }, p.id)}
                  className="text-[11px] px-2 py-0.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10">Pay premium</button>
              )}
              {(p.status === 'active' || p.status === 'expired') && (
                <button type="button" disabled={busy} onClick={() => void act('pact-renew', { pactId: p.id }, p.id)}
                  className="text-[11px] px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" />Renew</button>
              )}
              {p.status === 'active' && (
                <button type="button" disabled={busy} onClick={() => void act('pact-set-auto-renew', { pactId: p.id, autoRenew: !p.autoRenew }, p.id)}
                  className="text-[11px] px-2 py-0.5 rounded border border-zinc-600/40 text-zinc-300 hover:bg-zinc-700/30">{p.autoRenew ? 'Auto-renew off' : 'Auto-renew on'}</button>
              )}
              {p.status === 'active' && (
                <button type="button" disabled={busy} onClick={() => void act('pact-revoke', { pactId: p.id }, p.id)}
                  className="text-[11px] px-2 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-1"><Ban className="w-3 h-3" />Revoke</button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-900/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Mutual-aid pacts</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
        <button type="button" onClick={() => setShowForm((s) => !s)}
          className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 hover:bg-blue-500/30">
          <Plus className="w-3.5 h-3.5" /> Write pact
        </button>
      </div>

      {error && <div className="mb-3 flex items-center gap-2 text-xs text-rose-300"><AlertTriangle className="w-3.5 h-3.5" /> {error}</div>}

      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); void write(); }} className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <div className="col-span-2">
            <label className="text-[11px] text-zinc-400">Beneficiary — search by username
              <span className="mt-0.5 flex gap-1.5">
                <input aria-label="Beneficiary username search" value={benQuery} onChange={(e) => setBenQuery(e.target.value)} placeholder="@username"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none" />
                <button type="button" onClick={() => void searchBeneficiary()} disabled={benBusy}
                  className="shrink-0 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">{benBusy ? 'Searching…' : 'Look up'}</button>
              </span></label>
            {benNote && <p className="mt-1 text-[11px] text-zinc-400">{benNote}</p>}
            {benResults.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {benResults.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => { setForm((f) => ({ ...f, beneficiaryUserId: u.id })); setBenNote(`Beneficiary set to ${u.displayName || u.username} (@${u.username}).`); setBenResults([]); }}
                      className="w-full rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-left text-xs text-zinc-200 hover:border-blue-500/50">
                      {u.displayName || u.username} <span className="text-zinc-400">@{u.username}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-2 block text-[11px] text-zinc-400">Beneficiary user id
              <input value={form.beneficiaryUserId} onChange={(e) => setForm((f) => ({ ...f, beneficiaryUserId: e.target.value }))} placeholder="user id"
                className="mt-0.5 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none" /></label>
            {user && <p className="mt-1 text-[11px] text-zinc-400">Your own user id: <span className="font-mono text-zinc-300">{user.id}</span> (@{user.username}) — a beneficiary must be someone else.</p>}
          </div>
          <label className="text-[11px] text-zinc-400">Payout sparks
            <input type="number" min={1} value={form.payoutSparks} onChange={(e) => setForm((f) => ({ ...f, payoutSparks: e.target.value }))}
              className="mt-0.5 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none" /></label>
          <label className="text-[11px] text-zinc-400">Premium sparks
            <input type="number" min={1} value={form.premiumSparks} onChange={(e) => setForm((f) => ({ ...f, premiumSparks: e.target.value }))}
              className="mt-0.5 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none" /></label>
          <label className="text-[11px] text-zinc-400">Duration (days)
            <input type="number" min={1} value={form.durationDays} onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))}
              className="mt-0.5 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none" /></label>
          <label className="text-[11px] text-zinc-400">Premium frequency
            <select value={form.premiumFrequency} onChange={(e) => setForm((f) => ({ ...f, premiumFrequency: e.target.value as typeof f.premiumFrequency }))}
              className="mt-0.5 w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none">
              <option value="upfront">upfront</option><option value="weekly">weekly</option><option value="monthly">monthly</option>
            </select></label>
          <button type="submit" disabled={busyId === 'new'} className="col-span-2 mt-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 text-xs font-medium hover:bg-blue-500/30 disabled:opacity-50">
            {busyId === 'new' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Write pact
          </button>
        </form>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Pacts you wrote</h4>
          <div className="space-y-2">
            {written.length === 0 && !loading && <p className="text-xs text-zinc-500">None yet.</p>}
            {written.map((p) => renderPact(p, false))}
          </div>
        </div>
        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">You're a beneficiary</h4>
          <div className="space-y-2">
            {beneficiaryOf.length === 0 && !loading && <p className="text-xs text-zinc-500">None yet.</p>}
            {beneficiaryOf.map((p) => renderPact(p, true))}
          </div>
        </div>
      </div>

      {(payouts.paidOut.length > 0 || payouts.received.length > 0) && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5 inline-flex items-center gap-1"><History className="w-3 h-3" /> Payout history</h4>
          <div className="space-y-1">
            {payouts.received.map((po) => (
              <div key={po.id} className="text-[11px] text-emerald-300">Received {po.mySparks} sparks — {po.cause} ({fmtDate(po.firedAt)})</div>
            ))}
            {payouts.paidOut.map((po) => (
              <div key={po.id} className="text-[11px] text-zinc-400">Paid out {po.totalSparks} sparks — {po.cause} ({fmtDate(po.firedAt)})</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MutualAidPactsPanel;
