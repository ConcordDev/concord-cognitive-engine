'use client';

/**
 * Accounting north star — one statement for the period the engine returns.
 * Zeros render only after pl-compute answers. The books desk stays under More.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { BookRow, NorthError, northPage, usd } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Line = { id?: string; code?: string; name?: string; amount?: number };
type Statement = {
  period?: { start?: string; end?: string };
  revenue?: { total?: number; lines?: Line[] };
  operatingExpenses?: { total?: number; lines?: Line[] };
  netIncome?: number;
  simulated?: boolean;
};
type Account = { id: string; code?: string; name?: string; archived?: boolean };

export function AccountingStatement({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('accounting');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [debit, setDebit] = useState('');
  const [credit, setCredit] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [posting, setPosting] = useState(false);

  const statementQ = useQuery({
    queryKey: ['accounting-northstar', 'pl'],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await lensRun<Statement>('accounting', 'pl-compute', {});
      if (!res.data.ok || res.data.result == null || !Number.isFinite(Number(res.data.result.netIncome))) {
        throw new Error(res.data.error || 'The books did not answer.');
      }
      return res.data.result;
    },
  });
  const statement = statementQ.data ?? null;

  const openEntry = async () => {
    setComposing(true);
    setError('');
    try {
      const res = await lensRun<{ accounts?: Account[] }>('accounting', 'coa-list', {});
      const rows = (res.data.result?.accounts || []).filter((a) => a && !a.archived && a.id);
      setAccounts(rows);
      if (!res.data.ok) setError(res.data.error || 'The chart of accounts did not answer.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The chart of accounts did not answer.');
    }
  };

  const post = async () => {
    const n = Number(amount);
    if (!debit || !credit || debit === credit || !Number.isFinite(n) || n <= 0) {
      setError('An entry needs two accounts and a positive amount.');
      return;
    }
    setPosting(true);
    setError('');
    try {
      const res = await lensRun('accounting', 'je-post', {
        memo,
        lines: [
          { accountId: debit, debit: n, credit: 0 },
          { accountId: credit, debit: 0, credit: n },
        ],
      });
      if (!res.data.ok) {
        setError(res.data.error || 'The entry was not posted.');
        return;
      }
      setComposing(false);
      setAmount('');
      setMemo('');
      await client.invalidateQueries({ queryKey: ['accounting-northstar', 'pl'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The entry was not posted.');
    } finally {
      setPosting(false);
    }
  };

  const period = statement?.period?.start && statement.period.end
    ? `${statement.period.start} – ${statement.period.end}`
    : '';

  return (
    <LensShell lensId="accounting" asMain={false} disableAgentFab>
      <div data-lens-theme="accounting" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Accounting" title={who ? `The books, ${who}` : 'The books'} />
            <div className="mt-4 flex items-center gap-3 text-[13px] text-zinc-500">
              {period && <span>{period}</span>}
              {statement?.simulated === true && (
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-400">Simulated</span>
              )}
            </div>
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Books' }]} onPick={onOpenDesk} />
        </div>

        {(error || statementQ.error) && (
          <NorthError message={error || (statementQ.error instanceof Error ? statementQ.error.message : 'The books did not answer.')} />
        )}

        {statement && (
          <div className="mt-6 max-w-xl space-y-2">
            <BookRow label="Revenue" value={usd(Number(statement.revenue?.total) || 0)} />
            <BookRow label="Expenses" value={usd(Number(statement.operatingExpenses?.total) || 0)} />
            <BookRow label="Net" value={usd(Number(statement.netIncome))} />
          </div>
        )}

        {composing && (
          <form
            className="mt-6 max-w-xl space-y-3 rounded-xl border border-white/10 p-4"
            onSubmit={(e) => { e.preventDefault(); void post(); }}
          >
            <label className="block text-[13px] text-zinc-400">
              Memo
              <input value={memo} onChange={(e) => setMemo(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px] text-zinc-100" />
            </label>
            <label className="block text-[13px] text-zinc-400">
              Amount
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px] text-zinc-100" />
            </label>
            <label className="block text-[13px] text-zinc-400">
              Debit
              <select value={debit} onChange={(e) => setDebit(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px] text-zinc-100">
                <option value="">Account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </label>
            <label className="block text-[13px] text-zinc-400">
              Credit
              <select value={credit} onChange={(e) => setCredit(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px] text-zinc-100">
                <option value="">Account</option>
                {accounts.map((a) => <option key={`c-${a.id}`} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </label>
            <button type="submit" disabled={posting} className="rounded-full bg-white/10 px-4 py-2 text-[14px] text-zinc-100 disabled:opacity-50">Post entry</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => void openEntry()}>+ Entry</button>
      </div>
    </LensShell>
  );
}
