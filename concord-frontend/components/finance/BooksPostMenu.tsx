'use client';

/**
 * Books handoff for one Finance ledger row.
 *
 * Order is enforced: a row can only be saved as a DTU, only a DTU that reads
 * back can be posted, and only a balanced entry that still names the DTU is
 * reported as posted. Every refusal says what was refused.
 */

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import { cn } from '@/lib/utils';
import {
  cashAccount,
  counterAccount,
  dtuReadBackCall,
  dtuReadBackMatches,
  dtuRecordId,
  entrySentence,
  isSpend,
  ledgerEntryDtuCall,
  postEntryToBooksCall,
  postEntryOutcome,
  usd,
  type CoaAccount,
  type LedgerRow,
} from '@/components/finance/financeLedgerEntry';

export interface PostedEntry {
  entryId: string;
  entryNumber: string;
  totalDebit: number;
}

export function BooksPostMenu({
  row,
  accounts,
  posted,
  onPosted,
}: {
  row: LedgerRow;
  accounts: CoaAccount[];
  posted?: PostedEntry;
  onPosted?: () => void;
}) {
  const sentence = entrySentence(row);
  const cash = cashAccount(accounts);
  const options = accounts.filter((a) => !a.archived && a.id !== cash?.id);
  const [picked, setPicked] = useState<string | null>(null);
  const counterId = picked && options.some((a) => a.id === picked)
    ? picked
    : counterAccount(accounts, row)?.id || options[0]?.id || '';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'save' | 'post' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [justPosted, setJustPosted] = useState<PostedEntry | null>(null);

  if (!sentence) return null;

  // The reload index wins over nothing; a fresh post in this session wins over both.
  const entry = justPosted || posted || null;
  const counter = options.find((a) => a.id === counterId) || null;
  const amount = Math.abs(Number(row.amount));

  async function save() {
    if (busy) return;
    const call = ledgerEntryDtuCall(row);
    if (!call) {
      setNote('Not saved. This row has no description or no non-zero amount.');
      return;
    }
    setBusy('save');
    setNote(null);
    try {
      const response = await lensRun({
        domain: call.domain,
        action: call.action,
        input: withContentLicense(call.input, 'knowledge', ['private']),
      });
      const id = dtuRecordId(response.data as { ok?: boolean; result?: unknown });
      if (!response.data?.ok || !id) {
        setSavedDtuId(null);
        setNote(`Not saved. ${response.data?.error || 'No DTU id returned.'}`);
        return;
      }
      const read = await lensRun(dtuReadBackCall(id));
      if (!dtuReadBackMatches(id, read.data as { ok?: boolean; result?: unknown })) {
        setSavedDtuId(null);
        setNote(`Not saved. DTU ${id} could not be read back.`);
        return;
      }
      setSavedDtuId(id);
      setNote(`Saved as private DTU ${id}. No bank and no Concord Coin moved.`);
    } catch (err) {
      setSavedDtuId(null);
      setNote(`Not saved. ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  }

  async function post() {
    if (busy || !savedDtuId) return;
    const call = postEntryToBooksCall(row, savedDtuId, cash, counter);
    if (!call) {
      setNote(`Not posted. ${cash ? 'Pick a second account.' : 'Your Books have no cash account to post against.'}`);
      return;
    }
    setBusy('post');
    setNote(null);
    try {
      const response = await lensRun({ domain: call.domain, action: call.action, input: call.input });
      const outcome = postEntryOutcome(savedDtuId, response.data as { ok?: boolean; result?: unknown; error?: string | null });
      if (outcome.claimed) {
        setJustPosted({ entryId: outcome.entryId, entryNumber: outcome.entryNumber, totalDebit: amount });
        onPosted?.();
      }
      setNote(outcome.text);
    } catch (err) {
      setNote(`Not posted. ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-1 space-y-1">
      {entry && (
        <p className="text-[10px] text-emerald-300/90" role="status">
          In your Books as {entry.entryNumber} · ${usd(entry.totalDebit)} balanced.{' '}
          <Link href="/lenses/accounting" className="underline hover:text-emerald-200">Open Accounting</Link>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null}
          className="text-[10px] text-cyan-300 hover:text-cyan-200 disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving entry…' : 'Save entry as DTU'}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200"
        >
          <BookOpen className="h-3 w-3" /> Post to Books
        </button>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />}
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
          <span>{isSpend(row) ? 'Debit' : 'Credit'}</span>
          <select
            aria-label="Counter account"
            value={counterId}
            onChange={(e) => setPicked(e.target.value)}
            className="px-1.5 py-0.5 text-[10px] bg-lattice-deep border border-cyan-500/40 rounded text-white"
          >
            {options.length === 0 && <option value="">No account</option>}
            {options.map((a) => (
              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
            ))}
          </select>
          <span className="text-gray-500">
            {cash && counter ? `against ${cash.code} ${cash.name}` : 'your Books need two accounts'}
          </span>
          <button
            type="button"
            onClick={() => void post()}
            disabled={busy !== null || !savedDtuId || !cash || !counter}
            title={savedDtuId ? undefined : 'Save the entry as a DTU first'}
            className={cn(
              'rounded border border-cyan-500/30 px-2 py-0.5 text-cyan-300 transition-colors',
              'hover:bg-cyan-500/10 disabled:opacity-40',
            )}
          >
            {busy === 'post' ? 'Posting…' : 'Send this DTU to Books'}
          </button>
          {!savedDtuId && <span className="text-gray-500">Save the entry as a DTU first</span>}
        </div>
      )}

      {note && <p className="text-[10px] text-gray-300" role="status">{note}</p>}
    </div>
  );
}

export default BooksPostMenu;