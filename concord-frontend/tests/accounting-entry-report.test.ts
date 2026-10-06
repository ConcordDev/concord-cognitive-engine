import { describe, it, expect } from 'vitest';
import {
  entrySentence,
  entryBody,
  entryDtuCall,
  entryThreadDraftCall,
  entryThreadDraftOutcome,
  indexEntryDrafts,
  type AccountingEntryFacts,
} from '@/components/accounting/accountingEntryReport';

const accounts = {
  'acc_cash': { code: '1010', name: 'Cash' },
  'acc_rev': { code: '4000', name: 'Revenue' },
};

const facts: AccountingEntryFacts = {
  entry: {
    id: 'je_1',
    number: 'JE-00001',
    date: '2026-10-05',
    memo: 'October revenue',
    lines: [
      { accountId: 'acc_cash', debit: 1000, credit: 0, memo: 'Cash sale' },
      { accountId: 'acc_rev', debit: 0, credit: 1000, memo: 'Recognized revenue' },
    ],
    totalDebit: 1000,
    totalCredit: 1000,
    source: 'accounting-workbench',
  },
  accounts,
};

describe('accounting journal entry report', () => {
  it('states only the figures the backend reported', () => {
    const s = entrySentence(facts)!;
    expect(s).toContain('JE-00001');
    expect(s).toContain('2026-10-05');
    expect(s).toContain('2 lines');
    expect(s).toContain('1,000.00 balanced');
  });

  it('refuses to summarise an entry with no id, number, or unbalanced totals', () => {
    expect(entrySentence({ entry: null })).toBeNull();
    expect(entrySentence({ entry: { id: '', number: 'JE-1' } })).toBeNull();
    expect(entrySentence({ entry: { id: 'je_1', number: '', totalDebit: 100, totalCredit: 100 } })).toBeNull();
    expect(entrySentence({ entry: { id: 'je_1', number: 'JE-1', totalDebit: 100, totalCredit: 90 } })).toBeNull();
    expect(entrySentence({ entry: { id: 'je_1', number: 'JE-1', totalDebit: 0, totalCredit: 0 } })).toBeNull();
    expect(entryBody({ entry: null })).toBe('');
    expect(entryDtuCall({ entry: null })).toBeNull();
  });

  it('builds a private DTU call with accounting/journal-entry/books tags and accounting-lens source', () => {
    const call = entryDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    const input = call.input as Record<string, unknown>;
    expect(input.source).toBe('accounting-lens:journal-entry-report');
    const meta = input.meta as Record<string, unknown>;
    expect(meta.visibility).toBe('private');
    const tags = input.tags as string[];
    expect(tags).toContain('accounting');
    expect(tags).toContain('journal-entry');
    expect(tags).toContain('books');
    const machine = input.machine as Record<string, unknown>;
    expect(machine.kind).toBe('accounting_journal_entry_report');
    expect(machine.number).toBe('JE-00001');
    expect(machine.totalDebit).toBe(1000);
    expect(machine.totalCredit).toBe(1000);
    expect(machine.lineCount).toBe(2);
  });

  it('includes account labels in the body when accounts are provided', () => {
    const body = entryBody(facts);
    expect(body).toContain('Dr 1010 Cash: 1,000.00 — Cash sale');
    expect(body).toContain('Cr 4000 Revenue: 1,000.00 — Recognized revenue');
  });

  it('builds a Thread draft call that cites a real DTU id', () => {
    const call = entryThreadDraftCall(facts, 'dtu_a1', 'x')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    const input = call.input as Record<string, unknown>;
    expect(input.citedDtuId).toBe('dtu_a1');
    expect(String(input.title)).toContain('JE-00001');
    expect(String(input.content)).toContain('JE-00001');
  });

  it('refuses to draft without a real DTU id', () => {
    expect(entryThreadDraftCall(facts, '', 'x')).toBeNull();
    expect(entryThreadDraftCall(facts, 'has space', 'x')).toBeNull();
    expect(entryThreadDraftCall({ entry: null }, 'dtu_a1', 'x')).toBeNull();
  });

  it('accepts a Thread draft that is draft status citing the exact DTU', () => {
    const outcome = entryThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_a1' } } },
      'dtu_a1',
    );
    expect(outcome).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_a1' });
  });

  it('rejects a Thread draft that does not cite the exact DTU', () => {
    expect(entryThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } },
      'dtu_a1',
    )).toBeNull();
  });

  it('rejects a Thread draft that is not draft status', () => {
    expect(entryThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'posted', citedDtuId: 'dtu_a1' } } },
      'dtu_a1',
    )).toBeNull();
  });

  it('indexes drafts by cited DTU id', () => {
    const idx = indexEntryDrafts([
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_a1' } } },
      { ok: true, result: { draft: { id: 'th_2', status: 'draft', citedDtuId: 'dtu_a2' } } },
      { ok: false },
      null,
    ]);
    expect(idx).toEqual({ dtu_a1: 'th_1', dtu_a2: 'th_2' });
  });
});