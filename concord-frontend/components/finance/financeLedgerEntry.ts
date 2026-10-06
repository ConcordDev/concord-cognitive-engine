/**
 * A Finance ledger row exists because `finance.transactions-ingest` persisted
 * it. Saving it as a DTU records that row. Sending that DTU to Books posts a
 * balanced double-entry journal entry in Accounting that names the DTU.
 *
 * Nothing here moves money. A Finance row is a record the user typed or a bank
 * feed produced; a journal entry is a record in the user's own books. No bank
 * and no Concord Coin is touched by either step.
 */

import { dtuRecordId, dtuReadBackCall, dtuReadBackMatches, type ReceiptCall } from '@/components/wallet/walletReceipt';

export interface LedgerRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  categorySource?: string;
  accountId?: string | null;
}

export interface CoaAccount {
  id: string;
  code: string;
  name: string;
  category: string;
  archived?: boolean;
}

export interface JournalLeg {
  accountId: string;
  debit: number;
  credit: number;
  memo: string;
}

export type FinanceCall = ReceiptCall;

const DTU_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export function usd(amount: number): string {
  return (Math.round((Number(amount) || 0) * 100) / 100).toFixed(2);
}

export function isSpend(row: LedgerRow | null | undefined): boolean {
  return Number(row?.amount) < 0;
}

/** What the screen may say about a ledger row. Null when the row is not usable. */
export function entrySentence(row: LedgerRow | null | undefined): string | null {
  const id = String(row?.id || '').trim();
  const description = String(row?.description || '').trim();
  const amount = Number(row?.amount);
  if (!id || !description || !Number.isFinite(amount) || amount === 0) return null;
  const side = amount < 0 ? 'out' : 'in';
  const category = String(row?.category || '').trim();
  return `Ledger ${id}. ${description} ${usd(Math.abs(amount))} ${side}${category ? `, ${category}` : ''}.`;
}

export function entryBody(row: LedgerRow): string {
  const sentence = entrySentence(row);
  if (!sentence) return '';
  const lines = [
    sentence,
    `Date: ${String(row.date || '').trim() || 'unknown'}.`,
    `Amount: ${Number(row.amount) < 0 ? '-' : '+'}$${usd(Math.abs(Number(row.amount)))}.`,
    `Category: ${String(row.category || '').trim() || 'uncategorised'}${row.categorySource ? ` (${row.categorySource})` : ''}.`,
  ];
  const accountId = String(row.accountId || '').trim();
  if (accountId) lines.push(`Finance account: ${accountId}.`);
  lines.push('This row is a record in your Finance ledger. No bank and no Concord Coin moved.');
  return lines.join('\n');
}

/** The private DTU that records this ledger row. Null when the row is unusable. */
export function ledgerEntryDtuCall(row: LedgerRow): FinanceCall | null {
  const body = entryBody(row);
  const sentence = entrySentence(row);
  if (!body || !sentence) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['finance', 'ledger-entry', String(row.category || 'uncategorised').toLowerCase()],
      source: 'finance-lens:ledger-entry',
      human: { summary: body },
      core: {
        definitions: [sentence],
        claims: [body.slice(0, 240)],
      },
      machine: {
        kind: 'ledger_entry',
        ledgerEntry: {
          transactionId: row.id,
          date: String(row.date || ''),
          description: String(row.description || ''),
          amount: Math.round(Number(row.amount) * 100) / 100,
          category: String(row.category || ''),
          accountId: row.accountId ? String(row.accountId) : null,
        },
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'finance',
        finance: {
          transactionId: row.id,
          amount: Math.round(Number(row.amount) * 100) / 100,
          direction: Number(row.amount) < 0 ? 'out' : 'in',
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/** Cash is the account every personal ledger row touches. */
export function cashAccount(accounts: CoaAccount[] | null | undefined): CoaAccount | null {
  const live = (accounts || []).filter((a) => !a.archived);
  return live.find((a) => a.code === '1000') || live.find((a) => a.category === 'asset') || null;
}

/**
 * The other leg. Spend debits an expense; income credits a revenue account.
 * Null when no live account of that kind exists — the screen then says so
 * rather than posting to an arbitrary account.
 */
export function counterAccount(
  accounts: CoaAccount[] | null | undefined,
  row: LedgerRow | null | undefined,
): CoaAccount | null {
  const live = (accounts || []).filter((a) => !a.archived);
  const kind = Number(row?.amount) < 0 ? 'expense' : 'revenue';
  const preferred = kind === 'expense' ? '6000' : '4000';
  return live.find((a) => a.code === preferred) || live.find((a) => a.category === kind) || null;
}

export interface LedgerRowPost {
  entryId: string;
  entryNumber: string;
  totalDebit: number;
  citedDtuId: string;
}

/**
 * Index the journal rows Accounting already holds by the Finance transaction
 * they came from, so a reload shows the same "In your Books as JE-…" the post
 * reported. Only entries this lens posted are indexed.
 */
export function indexPostedEntries(
  rows: unknown,
): Record<string, LedgerRowPost> {
  const list = Array.isArray(rows) ? rows : [];
  const out: Record<string, LedgerRowPost> = {};
  for (const row of list) {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
    if (!r) continue;
    if (String(r.source || '') !== 'finance-ledger-entry') continue;
    const sourceId = String(r.sourceId || '').trim();
    const entryId = String(r.entryId || '').trim();
    const entryNumber = String(r.number || '').trim();
    if (!sourceId || !entryId || !entryNumber || out[sourceId]) continue;
    out[sourceId] = {
      entryId,
      entryNumber,
      totalDebit: Number(r.debit) || 0,
      citedDtuId: String(r.citedDtuId || ''),
    };
  }
  return out;
}

export function journalLegs(
  row: LedgerRow | null | undefined,
  cash: CoaAccount | null | undefined,
  other: CoaAccount | null | undefined,
): JournalLeg[] | null {
  const amount = Math.abs(Number(row?.amount));
  if (!row || !cash || !other || cash.id === other.id || !(amount > 0)) return null;
  const memo = String(row.description || '').slice(0, 120);
  const rounded = Math.round(amount * 100) / 100;
  return Number(row.amount) < 0
    ? [
        { accountId: other.id, debit: rounded, credit: 0, memo },
        { accountId: cash.id, debit: 0, credit: rounded, memo },
      ]
    : [
        { accountId: cash.id, debit: rounded, credit: 0, memo },
        { accountId: other.id, debit: 0, credit: rounded, memo },
      ];
}

/**
 * Post the saved DTU into the user's books. Null when the row cannot be posted
 * — no usable row, no readable DTU id, no two distinct accounts.
 */
export function postEntryToBooksCall(
  row: LedgerRow,
  dtuId: string,
  cash: CoaAccount | null | undefined,
  other: CoaAccount | null | undefined,
): FinanceCall | null {
  const id = dtuId.trim();
  if (!DTU_ID.test(id) || !entrySentence(row)) return null;
  const legs = journalLegs(row, cash, other);
  if (!legs) return null;
  const total = Math.round(Math.abs(Number(row.amount)) * 100) / 100;
  return {
    domain: 'accounting',
    action: 'je-post',
    input: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')) ? String(row.date) : undefined,
      memo: String(row.description || '').slice(0, 200),
      citedDtuId: id,
      source: 'finance-ledger-entry',
      sourceId: String(row.id),
      lines: legs,
      total,
    },
  };
}

/**
 * What the screen may say after a post attempt. Claims nothing unless the books
 * returned a numbered, balanced entry that still names the DTU we sent.
 */
export function postEntryOutcome(
  dtuId: string,
  data: { ok?: boolean; result?: unknown; error?: string | null },
): { claimed: boolean; text: string; entryId: string; entryNumber: string } {
  if (data.ok === false) {
    return { claimed: false, entryId: '', entryNumber: '', text: `Not posted. ${data.error || 'The books refused this.'}` };
  }
  let node = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  if (!node) return { claimed: false, entryId: '', entryNumber: '', text: 'Not posted. The books returned no entry.' };
  const inner = node.entry && typeof node.entry === 'object' ? (node.entry as Record<string, unknown>) : null;
  if (inner) node = inner;
  const entryId = String(node.id || '');
  const entryNumber = String(node.number || '');
  const cited = String(node.citedDtuId || '');
  const debit = Number(node.totalDebit);
  const credit = Number(node.totalCredit);
  if (!entryId || !entryNumber) {
    return { claimed: false, entryId: '', entryNumber: '', text: 'Not posted. The books returned no journal entry id.' };
  }
  if (!Number.isFinite(debit) || !Number.isFinite(credit) || Math.abs(debit - credit) > 0.01) {
    return {
      claimed: false,
      entryId,
      entryNumber,
      text: `Not posted as balanced. ${entryNumber} shows debits ${usd(debit)} against credits ${usd(credit)}. No bank and no Concord Coin moved.`,
    };
  }
  if (cited !== dtuId) {
    return {
      claimed: false,
      entryId,
      entryNumber,
      text: `Posted ${entryNumber} without DTU ${dtuId}. Your books cannot name where it came from.`,
    };
  }
  return {
    claimed: true,
    entryId,
    entryNumber,
    text: `Posted ${entryNumber} to your Books. ${usd(debit)} balanced across ${node.lines && Array.isArray(node.lines) ? node.lines.length : 2} lines. Ledger ${dtuId}. No bank and no Concord Coin moved.`,
  };
}