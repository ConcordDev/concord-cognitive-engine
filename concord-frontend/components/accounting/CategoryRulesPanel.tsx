'use client';

/**
 * CategoryRulesPanel — surfaces accounting's transaction auto-categorization rules
 * (the accounting.category-rules-* macros existed backend-side but had no UI). A
 * rule maps a description pattern → a chart-of-accounts account, so bank-feed
 * transactions get categorized automatically (a QuickBooks-core feature).
 */

import { useCallback, useEffect, useState } from 'react';
import { Wand2, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Account { id: string; code?: string; name: string; type?: string }
interface Rule { id: string; number?: string; pattern: string; accountId: string; createdAt?: string }

export function CategoryRulesPanel({ className }: { className?: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pattern, setPattern] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [acc, rls] = await Promise.all([
        lensRun({ domain: 'accounting', action: 'coa-list', input: {} }),
        lensRun({ domain: 'accounting', action: 'category-rules-list', input: {} }),
      ]);
      const accList = (acc?.data?.result?.accounts || []) as Account[];
      setAccounts(Array.isArray(accList) ? accList : []);
      if (!accountId && accList.length) setAccountId(accList[0].id);
      const ruleList = (rls?.data?.result?.rules || []) as Rule[];
      setRules(Array.isArray(ruleList) ? ruleList : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rules');
    } finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!pattern.trim() || !accountId) return;
    setSaving(true); setError(null);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'category-rules-create', input: { pattern: pattern.trim(), accountId } });
      if (r?.data?.error) setError(String(r.data.error));
      else {
        const rule = r?.data?.result?.rule as Rule | undefined;
        setPattern('');
        if (rule) setRules((prev) => [...prev, rule]); else await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create rule');
    } finally { setSaving(false); }
  }, [pattern, accountId, load]);

  const remove = useCallback(async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    try { await lensRun({ domain: 'accounting', action: 'category-rules-delete', input: { id } }); } catch { void load(); }
  }, [load]);

  const accName = useCallback((id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code ? a.code + ' · ' : ''}${a.name}` : id;
  }, [accounts]);

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-950/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Wand2 className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Auto-categorization rules</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="space-y-1.5 mb-3">
        {rules.length === 0 && !loading && (
          <p className="text-xs text-zinc-500">No rules yet — transactions matching a pattern will auto-post to the chosen account.</p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs group">
            <span className="text-zinc-400">If description contains</span>
            <span className="font-mono text-zinc-100 bg-zinc-900 px-1.5 py-0.5 rounded">{r.pattern}</span>
            <span className="text-zinc-400">→</span>
            <span className="text-emerald-300 font-medium flex-1 truncate">{accName(r.accountId)}</span>
            <button type="button" onClick={() => void remove(r.id)} aria-label="Delete rule"
              className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">If contains</span>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. AMAZON" maxLength={60}
          className="w-32 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none" />
        <span className="text-xs text-zinc-500">post to</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
          className="flex-1 min-w-[10rem] bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}
        </select>
        <button type="submit" disabled={saving || !pattern.trim() || !accountId}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add rule
        </button>
      </form>
    </div>
  );
}

export default CategoryRulesPanel;
