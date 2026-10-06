/**
 * An accounting journal entry report exists because the Accounting domain's
 * `je-post` macro returned the real posted entry — number, date, memo,
 * lines (account, debit, credit), and totals. This module turns exactly
 * that result into a sentence, saves it as a private DTU, reads that DTU
 * back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend
 * did not return is reported as missing, never invented. Nothing here
 * publishes anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface AccountingJournalLine {
  accountId?: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface AccountingJournalEntry {
  id?: string;
  number?: string;
  date?: string;
  memo?: string;
  lines?: AccountingJournalLine[];
  totalDebit?: number;
  totalCredit?: number;
  citedDtuId?: string | null;
  source?: string;
}

export interface AccountingEntryFacts {
  entry: AccountingJournalEntry | null;
  accounts?: Record<string, { code: string; name: string }>;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function accountLabel(accountId: string, accounts?: Record<string, { code: string; name: string }>): string {
  if (!accounts || !accounts[accountId]) return accountId;
  const a = accounts[accountId];
  return `${a.code} ${a.name}`;
}

/**
 * The entry report sentence, built only from the real detail. Null when
 * there is no entry, no id/number, or no balanced totals.
 */
export function entrySentence(facts: AccountingEntryFacts): string | null {
  const e = facts.entry;
  if (!e || !e.id || !e.number) return null;
  const debit = num(e.totalDebit);
  const credit = num(e.totalCredit);
  if (debit <= 0 || Math.abs(debit - credit) > 0.01) return null;
  const parts: string[] = [];
  parts.push(str(e.number, 20));
  if (e.date) parts.push(str(e.date, 10));
  const lineCount = Array.isArray(e.lines) ? e.lines.length : 0;
  return `${parts.join(' · ')}: ${lineCount} line${lineCount === 1 ? '' : 's'}, ${money(debit)} balanced.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function entryBody(facts: AccountingEntryFacts): string {
  const sentence = entrySentence(facts);
  const e = facts.entry;
  if (!sentence || !e) return '';
  const lines = [sentence, ''];
  lines.push(`Entry ID: ${e.id || '-'}`);
  lines.push(`Number: ${e.number || '-'}`);
  if (e.date) lines.push(`Date: ${e.date}`);
  if (e.memo) lines.push(`Memo: ${str(e.memo, 200)}`);
  if (e.source) lines.push(`Source: ${e.source}`);
  if (e.citedDtuId) lines.push(`Cited DTU: ${e.citedDtuId}`);
  lines.push(`Total debit: ${money(num(e.totalDebit))}`);
  lines.push(`Total credit: ${money(num(e.totalCredit))}`);
  if (Array.isArray(e.lines) && e.lines.length > 0) {
    lines.push('');
    lines.push(`Lines (${e.lines.length}):`);
    for (const l of e.lines.slice(0, 50)) {
      const acct = accountLabel(String(l.accountId || ''), facts.accounts);
      const debit = num(l.debit);
      const credit = num(l.credit);
      const memoPart = l.memo ? ` — ${str(l.memo, 80)}` : '';
      if (debit > 0) {
        lines.push(`  Dr ${acct}: ${money(debit)}${memoPart}`);
      } else {
        lines.push(`  Cr ${acct}: ${money(credit)}${memoPart}`);
      }
    }
  }
  lines.push('');
  lines.push('Every figure here came from the Accounting domain je-post macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same entry the macro returned, structured. */
export function entryMachine(facts: AccountingEntryFacts): Record<string, unknown> | null {
  const e = facts.entry;
  if (!entrySentence(facts) || !e) return null;
  return {
    kind: 'accounting_journal_entry_report',
    entryId: e.id || null,
    number: e.number || null,
    date: e.date || null,
    memo: e.memo || null,
    totalDebit: num(e.totalDebit),
    totalCredit: num(e.totalCredit),
    lineCount: Array.isArray(e.lines) ? e.lines.length : 0,
    source: e.source || null,
    citedDtuId: e.citedDtuId || null,
  };
}

/** The private DTU that records this entry. Null when nothing can be saved. */
export function entryDtuCall(facts: AccountingEntryFacts): ReceiptCall | null {
  const body = entryBody(facts);
  const sentence = entrySentence(facts);
  const machine = entryMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['accounting', 'journal-entry', 'books'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'accounting-lens:journal-entry-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'accounting',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that entry report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function entryThreadDraftCall(
  facts: AccountingEntryFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = entrySentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const e = facts.entry!;
  const number = str(e.number, 20) || 'entry';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Accounting entry — ${number}`.slice(0, 120),
      content: entryBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface EntryDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function entryThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): EntryDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexEntryDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}