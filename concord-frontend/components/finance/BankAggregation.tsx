'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, RefreshCw, Loader2, Link2, FileUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SyncedAccount {
  id: string;
  institution: string;
  name: string;
  kind: string;
  mask: string;
  balance: number;
  synced?: boolean;
  provider?: string;
  lastSyncedAt?: string;
}

interface PullResult {
  added: number;
  deduped: number;
}

// Parses a pasted CSV (date,description,amount) into a transaction batch.
// Real user-supplied data only — nothing synthetic.
function parseCsv(text: string): Array<{ date: string; description: string; amount: number }> {
  const out: Array<{ date: string; description: string; amount: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(',').map((c) => c.trim());
    if (cols.length < 3) continue;
    const [date, description, amountRaw] = cols;
    const amount = Number(amountRaw.replace(/[$,]/g, ''));
    if (!description || !Number.isFinite(amount)) continue;
    if (/date/i.test(date) && /amount/i.test(amountRaw)) continue; // header row
    out.push({ date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10), description, amount });
  }
  return out;
}

export function BankAggregation() {
  const [accounts, setAccounts] = useState<SyncedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [form, setForm] = useState({ institution: '', name: '', kind: 'checking', provider: 'plaid', balance: '' });
  const [syncFor, setSyncFor] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastPull, setLastPull] = useState<PullResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('finance', 'accounts-list', {});
      if (r.data?.ok) {
        const all = (r.data.result as { accounts: SyncedAccount[] }).accounts || [];
        setAccounts(all.filter((a) => a.synced));
      }
    } catch (e) { console.error('[BankAgg] list failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function link() {
    if (!form.institution.trim() || !form.name.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'accounts-sync-link', {
        institution: form.institution.trim(),
        name: form.name.trim(),
        kind: form.kind,
        provider: form.provider,
        balance: Number(form.balance) || 0,
      });
      if (r.data?.ok) {
        setForm({ institution: '', name: '', kind: 'checking', provider: 'plaid', balance: '' });
        setLinking(false);
        await refresh();
      }
    } catch (e) { console.error('[BankAgg] link failed', e); }
    finally { setBusy(false); }
  }

  async function pull(accountId: string) {
    const batch = parseCsv(csv);
    if (batch.length === 0) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'accounts-sync-pull', { accountId, transactions: batch });
      if (r.data?.ok) {
        setLastPull(r.data.result as PullResult);
        setCsv('');
        setSyncFor(null);
        await refresh();
      }
    } catch (e) { console.error('[BankAgg] pull failed', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Landmark className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Bank aggregation
        </span>
        <span className="ml-auto text-[10px] text-gray-500">{accounts.length} synced</span>
        <button onClick={() => setLinking((v) => !v)} className="p-1 text-gray-400 hover:text-white" aria-label="Link bank">
          <Link2 className="w-4 h-4" />
        </button>
      </header>

      <p className="px-4 py-2 text-[10px] text-gray-500 border-b border-white/5">
        Connect an institution, then sync transactions by pasting an exported CSV
        (date,description,amount). Each row is auto-categorised at ingest and deduped
        on re-sync — the same pipeline a Plaid/MX feed would drive.
      </p>

      {linking && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
          <input
            value={form.institution}
            onChange={(e) => setForm({ ...form, institution: e.target.value })}
            placeholder="Institution"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Account name"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            {['checking', 'savings', 'credit', 'investment', 'loan', 'mortgage', 'crypto'].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="plaid">Plaid</option>
            <option value="mx">MX</option>
            <option value="manual">Manual import</option>
          </select>
          <input
            type="number"
            value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })}
            placeholder="Current balance"
            className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <button
            onClick={link}
            disabled={busy}
            className="col-span-3 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
          >
            {busy ? 'Linking…' : 'Connect institution'}
          </button>
        </div>
      )}

      {lastPull && (
        <div className="px-4 py-2 text-[10px] text-emerald-300 border-b border-white/5">
          Last sync: {lastPull.added} transaction(s) imported, {lastPull.deduped} duplicate(s) skipped.
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : accounts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">
            <Landmark className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No synced institutions. Click the link icon to connect one.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {accounts.map((a) => (
              <li key={a.id} className="px-3 py-2.5 hover:bg-white/[0.03]">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded font-mono bg-cyan-500/15 text-cyan-300">
                    {a.provider || 'sync'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{a.institution} · {a.name}</div>
                    <div className="text-[10px] text-gray-500">
                      {a.kind} ••{a.mask}
                      {a.lastSyncedAt && ` · last sync ${new Date(a.lastSyncedAt).toLocaleString()}`}
                    </div>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-white">
                    ${Math.abs(a.balance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <button
                    onClick={() => setSyncFor((cur) => (cur === a.id ? null : a.id))}
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-1 rounded text-[10px]',
                      syncFor === a.id ? 'bg-cyan-500 text-black' : 'bg-white/5 text-gray-300 hover:text-white',
                    )}
                  >
                    <RefreshCw className="w-3 h-3" /> Sync
                  </button>
                </div>
                {syncFor === a.id && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={csv}
                      onChange={(e) => setCsv(e.target.value)}
                      placeholder={'2026-05-01,Whole Foods Market,-82.10\n2026-05-01,Payroll Deposit,3000'}
                      rows={4}
                      className="w-full px-2 py-1.5 text-[11px] font-mono bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                    <button
                      onClick={() => pull(a.id)}
                      disabled={busy || parseCsv(csv).length === 0}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      {busy ? 'Syncing…' : `Sync ${parseCsv(csv).length} row(s)`}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default BankAggregation;
