'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  X, Loader2, BookOpen, TrendingUp, Landmark, Calculator, Receipt, Plus, Save, Trash2, Check, AlertTriangle, FileText, Link as LinkIcon, Sparkles,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AdvancedAccountingPanel } from './AdvancedAccountingPanel';

export interface Account {
  id: string;
  code: string;
  name: string;
  category: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cogs';
  parent: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLine {
  accountId: string;
  debit: number;
  credit: number;
  memo: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type WorkbenchTab = 'coa' | 'journal' | 'ledger' | 'balance' | 'aging' | 'advanced';

const TAB_LIST: { id: WorkbenchTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'coa',      label: 'Chart of Accounts',  icon: BookOpen },
  { id: 'journal',  label: 'Post entry',         icon: Calculator },
  { id: 'ledger',   label: 'Ledger',             icon: FileText },
  { id: 'balance',  label: 'Balance sheet',      icon: Landmark },
  { id: 'aging',    label: 'AR aging',           icon: Receipt },
  { id: 'advanced', label: 'Advanced',           icon: Sparkles },
];

const CATEGORY_LABEL: Record<Account['category'], string> = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expenses', cogs: 'COGS',
};

export function AccountingWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<WorkbenchTab>('coa');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[640px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-emerald-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-emerald-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-gray-200">Accounting Workbench</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close workbench"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
        {TAB_LIST.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition flex-shrink-0',
                active
                  ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'coa' && <ChartOfAccountsTab />}
        {tab === 'journal' && <JournalEntryTab />}
        {tab === 'ledger' && <LedgerTab />}
        {tab === 'balance' && <BalanceSheetTab />}
        {tab === 'aging' && <AgingTab />}
        {tab === 'advanced' && <AdvancedAccountingPanel />}
      </div>
    </div>
  );
}

// ── Chart of Accounts tab ───────────────────────────────────────────────

function ChartOfAccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ code: '', name: '', category: 'expense' as Account['category'] });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'accounting',
        action: 'coa-list',
        input: {},
      });
      const result = (res.data as { result?: { accounts?: Account[] } })?.result;
      setAccounts(result?.accounts || []);
    } catch (e) {
      console.error('[CoaTab] list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({
        domain: 'accounting',
        action: 'coa-create',
        input: draft,
      });
      setCreating(false);
      setDraft({ code: '', name: '', category: 'expense' });
      await refresh();
    } catch (e) {
      console.error('[CoaTab] create failed', e);
    }
  };

  const archive = async (id: string) => {
    try {
      await lensRun({
        domain: 'accounting',
        action: 'coa-archive',
        input: { id },
      });
      await refresh();
    } catch (e) {
      console.error('[CoaTab] archive failed', e);
    }
  };

  const grouped: Record<Account['category'], Account[]> = {
    asset: [], liability: [], equity: [], revenue: [], expense: [], cogs: [],
  };
  for (const a of accounts) {
    if (!a.archived) grouped[a.category].push(a);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <button
        type="button"
        onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200 hover:brightness-110"
      >
        <Plus className="w-3 h-3" /> New account
      </button>

      {creating && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder="Code (e.g. 6400)"
              maxLength={12}
              className="px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
            />
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Name"
              maxLength={80}
              className="col-span-2 px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100"
            />
          </div>
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as Account['category'] })}
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
          >
            {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!draft.code.trim() || !draft.name.trim()}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 hover:brightness-110 disabled:opacity-40"
            >
              <Save className="w-3 h-3" /> Save
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {(Object.keys(grouped) as Account['category'][]).map((cat) => {
        if (grouped[cat].length === 0) return null;
        return (
          <div key={cat} className="space-y-1">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mt-3">
              {CATEGORY_LABEL[cat]}
            </h3>
            {grouped[cat].map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between px-3 py-1.5 rounded border border-white/5 bg-black/20 hover:bg-white/5 group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-[11px] text-gray-400 font-mono">{a.code}</code>
                  <span className="text-sm text-gray-200 truncate">{a.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => archive(a.id)}
                  className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"
                  aria-label="Archive account"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Journal Entry tab ────────────────────────────────────────────────────

function JournalEntryTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([
    { accountId: '', debit: 0, credit: 0, memo: '' },
    { accountId: '', debit: 0, credit: 0, memo: '' },
  ]);
  const [status, setStatus] = useState<{ kind: 'idle' | 'success' | 'error'; msg?: string }>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await lensRun({
          domain: 'accounting', action: 'coa-list', input: {},
        });
        const result = (res.data as { result?: { accounts?: Account[] } })?.result;
        setAccounts((result?.accounts || []).filter((a) => !a.archived));
      } catch (e) { console.error(e); }
    })();
  }, []);

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const updateLine = (idx: number, patch: Partial<JournalLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, { accountId: '', debit: 0, credit: 0, memo: '' }]);
  const removeLine = (idx: number) =>
    setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const post = async () => {
    if (!balanced) return;
    setSaving(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await lensRun({
        domain: 'accounting', action: 'je-post',
        input: {
          date, memo,
          lines: lines.filter((l) => l.accountId).map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            memo: l.memo,
          })),
        },
      });
      const data = res.data as { ok?: boolean; error?: string; result?: { entry?: { number: string } } };
      if (data.ok) {
        setStatus({ kind: 'success', msg: `Posted ${data.result?.entry?.number}` });
        setLines([
          { accountId: '', debit: 0, credit: 0, memo: '' },
          { accountId: '', debit: 0, credit: 0, memo: '' },
        ]);
        setMemo('');
      } else {
        setStatus({ kind: 'error', msg: data.error || 'Post failed' });
      }
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message || 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Memo (optional)"
          maxLength={200}
          className="col-span-2 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
      </div>

      <div className="border border-white/10 rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-black/40 text-gray-400 uppercase text-[10px] tracking-wider">
            <tr>
              <th scope="col" className="text-left px-2 py-1.5">Account</th>
              <th scope="col" className="text-right px-2 py-1.5 w-24">Debit</th>
              <th scope="col" className="text-right px-2 py-1.5 w-24">Credit</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="px-2 py-1">
                  <select
                    value={l.accountId}
                    onChange={(e) => updateLine(i, { accountId: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded px-1 py-1 text-xs text-gray-100"
                  >
                    <option value="">— pick account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.debit || ''}
                    onChange={(e) => updateLine(i, { debit: Number(e.target.value), credit: 0 })}
                    className="w-full bg-black/40 border border-white/10 rounded px-1 py-1 text-xs text-right font-mono text-gray-100"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.credit || ''}
                    onChange={(e) => updateLine(i, { credit: Number(e.target.value), debit: 0 })}
                    className="w-full bg-black/40 border border-white/10 rounded px-1 py-1 text-xs text-right font-mono text-gray-100"
                  />
                </td>
                <td className="px-1">
                  {lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="p-1 text-gray-600 hover:text-rose-300"
                      aria-label="Remove line"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-black/40 border-t border-white/10">
            <tr className="text-xs">
              <td className="px-2 py-1.5 text-gray-400">Totals</td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-200">{totalDebit.toFixed(2)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-200">{totalCredit.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addLine}
          className="text-xs text-gray-400 hover:text-emerald-300 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add line
        </button>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px]',
              balanced
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-amber-500/15 text-amber-300',
            )}
          >
            {balanced ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {balanced ? 'Balanced' : `Off by ${Math.abs(totalDebit - totalCredit).toFixed(2)}`}
          </span>
          <button
            type="button"
            onClick={post}
            disabled={!balanced || saving}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 hover:brightness-110 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Post entry
          </button>
        </div>
      </div>

      {status.kind !== 'idle' && (
        <div
          className={cn(
            'text-xs px-3 py-2 rounded',
            status.kind === 'success'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
              : 'bg-rose-500/10 text-rose-300 border border-rose-500/30',
          )}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}

// ── Ledger tab ────────────────────────────────────────────────────────────

interface LedgerRow {
  entryId: string;
  number: string;
  date: string;
  memo: string;
  accountId: string;
  debit: number;
  credit: number;
  lineMemo: string;
}

function LedgerTab() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [coa, ledger] = await Promise.all([
        lensRun({ domain: 'accounting', action: 'coa-list', input: {} }),
        lensRun({
          domain: 'accounting', action: 'ledger-list',
          input: { accountId: accountFilter || undefined, limit: 100 },
        }),
      ]);
      setAccounts(((coa.data as { result?: { accounts?: Account[] } })?.result?.accounts || []));
      setRows(((ledger.data as { result?: { rows?: LedgerRow[] } })?.result?.rows || []));
    } catch (e) {
      console.error('[LedgerTab] fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [accountFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name || id;

  return (
    <div className="p-3 space-y-2">
      <select
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
        className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 w-full max-w-xs"
      >
        <option value="">All accounts</option>
        {accounts.filter((a) => !a.archived).map((a) => (
          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
        ))}
      </select>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-8">No entries posted yet.</p>
      ) : (
        <div className="border border-white/10 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-black/40 text-gray-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th scope="col" className="text-left px-2 py-1.5">Date</th>
                <th scope="col" className="text-left px-2 py-1.5">Entry</th>
                <th scope="col" className="text-left px-2 py-1.5">Account</th>
                <th scope="col" className="text-right px-2 py-1.5">Debit</th>
                <th scope="col" className="text-right px-2 py-1.5">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.entryId}_${i}`} className="border-t border-white/5">
                  <td className="px-2 py-1 text-gray-400 font-mono">{r.date}</td>
                  <td className="px-2 py-1 text-gray-400 font-mono">{r.number}</td>
                  <td className="px-2 py-1 text-gray-200">{accountName(r.accountId)}</td>
                  <td className="px-2 py-1 text-right font-mono text-emerald-300">
                    {r.debit > 0 ? r.debit.toFixed(2) : ''}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-cyan-300">
                    {r.credit > 0 ? r.credit.toFixed(2) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Balance Sheet tab ─────────────────────────────────────────────────────

interface BalanceSheet {
  asOf: string;
  assets: { id: string; code: string; name: string; balance: number }[];
  liabilities: { id: string; code: string; name: string; balance: number }[];
  equity: { id: string; code: string; name: string; balance: number }[];
  totals: { assets: number; liabilities: number; equity: number };
  balanced: boolean;
  imbalance: number;
}

function BalanceSheetTab() {
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'accounting',
        action: 'balance-sheet-compute',
        input: { asOf },
      });
      setBs((res.data as { result?: BalanceSheet })?.result || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [asOf]);

  useEffect(() => { refresh(); }, [refresh]);

  const fmt = (n: number) => n.toFixed(2);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400">As of</label>
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Computing…
        </div>
      ) : !bs ? (
        <p className="text-xs text-gray-400">No data</p>
      ) : (
        <div className="space-y-3">
          {bs.balanced ? (
            <div className="text-[11px] text-emerald-300 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Balanced
            </div>
          ) : (
            <div className="text-[11px] text-rose-300 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Out of balance by {fmt(bs.imbalance)}
            </div>
          )}

          {[
            { title: 'Assets', items: bs.assets, total: bs.totals.assets, color: 'emerald' },
            { title: 'Liabilities', items: bs.liabilities, total: bs.totals.liabilities, color: 'rose' },
            { title: 'Equity', items: bs.equity, total: bs.totals.equity, color: 'cyan' },
          ].map((section) => (
            <div key={section.title} className="border border-white/10 rounded overflow-hidden">
              <div className="px-3 py-1.5 bg-black/40 text-[10px] uppercase tracking-wider text-gray-400">
                {section.title}
              </div>
              {section.items.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">(none)</p>
              ) : (
                section.items.map((a) => (
                  <div key={a.id} className="flex justify-between px-3 py-1 text-xs border-t border-white/5">
                    <span className="text-gray-300"><code className="text-gray-400 mr-2">{a.code}</code>{a.name}</span>
                    <span className="font-mono text-gray-200">{fmt(a.balance)}</span>
                  </div>
                ))
              )}
              <div className="flex justify-between px-3 py-1.5 text-xs border-t border-white/10 bg-black/30">
                <span className="text-gray-400 uppercase tracking-wider text-[10px]">Total {section.title}</span>
                <span className="font-mono font-semibold text-gray-100">{fmt(section.total)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AR Aging tab ──────────────────────────────────────────────────────────

interface AgingBucket {
  key: string;
  label: string;
  total: number;
  invoices: {
    id: string; number: string; customerName: string; total: number;
    dueAt: string; daysPastDue: number;
  }[];
}

function AgingTab() {
  const [buckets, setBuckets] = useState<AgingBucket[]>([]);
  const [totalOpen, setTotalOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    customerName: '',
    total: 0,
    issuedAt: new Date().toISOString().slice(0, 10),
    dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'accounting', action: 'aging-ar', input: {},
      });
      const result = (res.data as { result?: { buckets?: AgingBucket[]; totalOpen?: number } })?.result;
      setBuckets(result?.buckets || []);
      setTotalOpen(result?.totalOpen || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const createInvoice = async () => {
    try {
      await lensRun({
        domain: 'accounting', action: 'invoice-create',
        input: draft,
      });
      setCreating(false);
      setDraft({
        customerName: '',
        total: 0,
        issuedAt: new Date().toISOString().slice(0, 10),
        dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const markPaid = async (id: string) => {
    try {
      await lensRun({
        domain: 'accounting', action: 'invoice-mark-paid',
        input: { id },
      });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const [linkPrompt, setLinkPrompt] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkResult, setLinkResult] = useState<{ url: string; pdf: string } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const sendPaymentLink = async () => {
    if (!linkPrompt) return;
    setLinkError(null); setLinkResult(null);
    try {
      const res = await lensRun({
        domain: 'accounting', action: 'invoice-create-payment-link',
        input: { id: linkPrompt, customerEmail: linkEmail.trim() },
      });
      const data = res.data as { ok?: boolean; error?: string; result?: { hostedUrl?: string; pdfUrl?: string } };
      if (data.ok && data.result?.hostedUrl) {
        setLinkResult({ url: data.result.hostedUrl, pdf: data.result.pdfUrl || '' });
      } else {
        setLinkError(data.error || 'Failed to create payment link');
      }
    } catch (e) { setLinkError((e as Error).message); }
  };

  const fmt = (n: number) => n.toFixed(2);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          Total open: <span className="font-mono text-gray-200">${fmt(totalOpen)}</span>
        </span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200"
        >
          <Plus className="w-3 h-3" /> New invoice
        </button>
      </div>

      {creating && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <input
            type="text"
            value={draft.customerName}
            onChange={(e) => setDraft({ ...draft, customerName: e.target.value })}
            placeholder="Customer name"
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.total || ''}
              onChange={(e) => setDraft({ ...draft, total: Number(e.target.value) })}
              placeholder="Total"
              className="px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
            />
            <input
              type="date"
              value={draft.issuedAt}
              onChange={(e) => setDraft({ ...draft, issuedAt: e.target.value })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
            />
            <input
              type="date"
              value={draft.dueAt}
              onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
            />
          </div>
          <button
            type="button"
            onClick={createInvoice}
            disabled={!draft.customerName.trim() || draft.total <= 0}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 hover:brightness-110 disabled:opacity-40"
          >
            <Save className="w-3 h-3" /> Create
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        buckets.map((b) => (
          <div key={b.key} className="border border-white/10 rounded overflow-hidden">
            <div className="px-3 py-1.5 bg-black/40 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-gray-400">{b.label}</span>
              <span className="font-mono text-xs text-gray-200">${fmt(b.total)}</span>
            </div>
            {b.invoices.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-gray-400">(no open invoices in this bucket)</p>
            ) : (
              b.invoices.map((inv) => (
                <div key={inv.id} className="px-3 py-1.5 text-xs border-t border-white/5 flex items-center justify-between group">
                  <div className="min-w-0">
                    <p className="text-gray-200 truncate">{inv.customerName}</p>
                    <p className="text-[10px] text-gray-400">{inv.number} · due {inv.dueAt} · {inv.daysPastDue > 0 ? `${inv.daysPastDue}d past due` : 'not yet due'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-gray-200">${fmt(inv.total)}</span>
                    <button
                      type="button"
                      onClick={() => { setLinkPrompt(inv.id); setLinkEmail(''); setLinkResult(null); setLinkError(null); }}
                      className="px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-200 opacity-0 group-hover:opacity-100 inline-flex items-center gap-1"
                      title="Send Stripe payment link"
                    >
                      <LinkIcon className="w-3 h-3" /> Pay link
                    </button>
                    <button
                      type="button"
                      onClick={() => markPaid(inv.id)}
                      className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-200 opacity-0 group-hover:opacity-100"
                    >
                      Mark paid
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ))
      )}

      {linkPrompt && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-cyan-200">Send Stripe payment link</span>
            <button type="button" aria-label="Close" onClick={() => setLinkPrompt(null)} className="text-zinc-400 hover:text-zinc-300">
              <X className="w-3 h-3" />
            </button>
          </div>
          {!linkResult ? (
            <>
              <input
                type="email" autoFocus placeholder="Customer email"
                value={linkEmail}
                onChange={(e) => setLinkEmail(e.target.value)}
                className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100"
              />
              <button
                type="button" onClick={sendPaymentLink}
                disabled={!linkEmail.includes('@')}
                className="w-full px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/15 text-xs text-cyan-100 disabled:opacity-40"
              >Create hosted invoice link</button>
              {linkError && <p className="text-xs text-rose-300">{linkError}</p>}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-emerald-300">✓ Hosted invoice created</p>
              <a href={linkResult.url} target="_blank" rel="noopener noreferrer"
                className="block text-xs text-cyan-200 underline break-all">{linkResult.url}</a>
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => { void navigator.clipboard?.writeText(linkResult.url); }}
                  className="flex-1 px-2 py-1 rounded border border-cyan-500/30 bg-cyan-500/5 text-xs text-cyan-200">
                  Copy link
                </button>
                {linkResult.pdf && (
                  <a href={linkResult.pdf} target="_blank" rel="noopener noreferrer"
                    className="flex-1 px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 text-center">
                    Open PDF
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AccountingWorkbench;
