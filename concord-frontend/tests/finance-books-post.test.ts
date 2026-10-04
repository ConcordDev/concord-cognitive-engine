import { describe, it, expect } from 'vitest';
import {
  cashAccount,
  counterAccount,
  entryBody,
  entrySentence,
  indexPostedEntries,
  journalLegs,
  ledgerEntryDtuCall,
  postEntryToBooksCall,
  postEntryOutcome,
  usd,
  type CoaAccount,
  type LedgerRow,
} from '@/components/finance/financeLedgerEntry';

const COA: CoaAccount[] = [
  { id: 'acct_1000', code: '1000', name: 'Cash', category: 'asset' },
  { id: 'acct_4000', code: '4000', name: 'Sales Revenue', category: 'revenue' },
  { id: 'acct_6000', code: '6000', name: 'Office Expense', category: 'expense' },
  { id: 'acct_6100', code: '6100', name: 'Rent Expense', category: 'expense' },
];

const spend: LedgerRow = {
  id: 'tx_abc',
  date: '2026-10-04',
  description: 'Blue Bottle Coffee',
  amount: -4.2,
  category: 'Dining',
  categorySource: 'user_rule',
  accountId: null,
};

const income: LedgerRow = {
  id: 'tx_pay',
  date: '2026-10-01',
  description: 'Payroll',
  amount: 3200,
  category: 'Income',
  categorySource: 'manual',
};

describe('finance ledger entry honesty', () => {
  it('names the ledger row and refuses a row with no usable amount', () => {
    expect(entrySentence(spend)).toBe('Ledger tx_abc. Blue Bottle Coffee 4.20 out, Dining.');
    expect(entrySentence(income)).toBe('Ledger tx_pay. Payroll 3200.00 in, Income.');
    expect(entrySentence({ ...spend, amount: 0 })).toBeNull();
    expect(entrySentence({ ...spend, description: '   ' })).toBeNull();
    expect(entrySentence(null)).toBeNull();
  });

  it('says plainly that no bank and no Concord Coin moved', () => {
    const body = entryBody(spend);
    expect(body).toContain('No bank and no Concord Coin moved.');
    expect(body).toContain('Amount: -$4.20.');
    expect(body).toContain('(user_rule)');
  });

  it('builds a private ledger_entry DTU that carries the transaction id', () => {
    const call = ledgerEntryDtuCall(spend);
    expect(call?.domain).toBe('dtu');
    expect(call?.action).toBe('create');
    const input = call!.input as Record<string, never>;
    expect(input.source).toBe('finance-lens:ledger-entry');
    expect(input.meta).toMatchObject({
      visibility: 'private',
      createdFrom: 'finance',
      finance: { transactionId: 'tx_abc', amount: -4.2, direction: 'out' },
    });
    const machine = input.machine as unknown as { kind: string; ledgerEntry: { transactionId: string; amount: number } };
    expect(machine.kind).toBe('ledger_entry');
    expect(machine.ledgerEntry.transactionId).toBe('tx_abc');
    expect(machine.ledgerEntry.amount).toBe(-4.2);
    expect((input.tags as unknown as string[])[0]).toBe('finance');
  });

  it('refuses to mint a DTU for a row that is not in the ledger', () => {
    expect(ledgerEntryDtuCall({ ...spend, amount: 0 })).toBeNull();
    expect(ledgerEntryDtuCall({ ...spend, id: '' })).toBeNull();
  });
});

describe('double-entry legs from a finance row', () => {
  it('debits the expense and credits cash for a spend', () => {
    const legs = journalLegs(spend, cashAccount(COA), counterAccount(COA, spend));
    expect(legs).toEqual([
      { accountId: 'acct_6000', debit: 4.2, credit: 0, memo: 'Blue Bottle Coffee' },
      { accountId: 'acct_1000', debit: 0, credit: 4.2, memo: 'Blue Bottle Coffee' },
    ]);
  });

  it('debits cash and credits revenue for income', () => {
    const legs = journalLegs(income, cashAccount(COA), counterAccount(COA, income));
    expect(legs).toEqual([
      { accountId: 'acct_1000', debit: 3200, credit: 0, memo: 'Payroll' },
      { accountId: 'acct_4000', debit: 0, credit: 3200, memo: 'Payroll' },
    ]);
  });

  it('balances to the cent on the row amount', () => {
    const legs = journalLegs({ ...spend, amount: -4.201 }, cashAccount(COA), counterAccount(COA, spend))!;
    const debit = legs.reduce((s, l) => s + l.debit, 0);
    const credit = legs.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBeCloseTo(credit, 10);
    expect(usd(debit)).toBe('4.20');
  });

  it('refuses to invent legs when one account is missing or duplicated', () => {
    const cash = cashAccount(COA)!;
    expect(journalLegs(spend, null, counterAccount(COA, spend))).toBeNull();
    expect(journalLegs(spend, cash, null)).toBeNull();
    expect(journalLegs(spend, cash, cash)).toBeNull();
    expect(cashAccount([])).toBeNull();
    expect(counterAccount([], spend)).toBeNull();
  });

  it('ignores archived accounts', () => {
    const archived = COA.map((a) => (a.code === '6000' ? { ...a, archived: true } : a));
    expect(counterAccount(archived, spend)?.code).toBe('6100');
  });
});

describe('posting a saved entry to the books', () => {
  it('sends balanced lines, the DTU id, and the finance row id', () => {
    const call = postEntryToBooksCall(spend, 'dtu_9', cashAccount(COA), counterAccount(COA, spend));
    expect(call?.domain).toBe('accounting');
    expect(call?.action).toBe('je-post');
    const input = call!.input as Record<string, never>;
    expect(input.citedDtuId).toBe('dtu_9');
    expect(input.source).toBe('finance-ledger-entry');
    expect(input.sourceId).toBe('tx_abc');
    expect(input.date).toBe('2026-10-04');
    expect(input.memo).toBe('Blue Bottle Coffee');
    const lines = input.lines as unknown as Array<{ debit: number; credit: number }>;
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBeCloseTo(lines.reduce((s, l) => s + l.credit, 0), 10);
  });

  it('refuses to post a DTU id that is not a DTU id', () => {
    const cash = cashAccount(COA);
    const other = counterAccount(COA, spend);
    expect(postEntryToBooksCall(spend, 'not an id', cash, other)).toBeNull();
    expect(postEntryToBooksCall(spend, '', cash, other)).toBeNull();
    expect(postEntryToBooksCall(spend, 'dtu_9', null, other)).toBeNull();
    expect(postEntryToBooksCall({ ...spend, amount: 0 }, 'dtu_9', cash, other)).toBeNull();
  });

  it('drops a malformed date instead of posting it', () => {
    const call = postEntryToBooksCall({ ...spend, date: 'last tuesday' }, 'dtu_9', cashAccount(COA), counterAccount(COA, spend));
    expect((call!.input as Record<string, unknown>).date).toBeUndefined();
  });
});

describe('post outcome honesty', () => {
  const posted = {
    ok: true,
    result: {
      entry: {
        id: 'je_1',
        number: 'JE-00001',
        citedDtuId: 'dtu_9',
        source: 'finance-ledger-entry',
        sourceId: 'tx_abc',
        lines: [{ debit: 4.2, credit: 0 }, { debit: 0, credit: 4.2 }],
        totalDebit: 4.2,
        totalCredit: 4.2,
      },
    },
  };

  it('claims posted only when the entry is numbered, balanced, and cites the DTU', () => {
    const outcome = postEntryOutcome('dtu_9', posted);
    expect(outcome.claimed).toBe(true);
    expect(outcome.entryNumber).toBe('JE-00001');
    expect(outcome.text).toBe(
      'Posted JE-00001 to your Books. 4.20 balanced across 2 lines. Ledger dtu_9. No bank and no Concord Coin moved.',
    );
  });

  it('does not claim posted when the books dropped the cite', () => {
    const outcome = postEntryOutcome('dtu_other', posted);
    expect(outcome.claimed).toBe(false);
    expect(outcome.text).toContain('Your books cannot name where it came from');
  });

  it('does not claim posted when the entry is unbalanced', () => {
    const outcome = postEntryOutcome('dtu_9', {
      ok: true,
      result: { entry: { id: 'je_2', number: 'JE-00002', citedDtuId: 'dtu_9', totalDebit: 4.2, totalCredit: 1 } },
    });
    expect(outcome.claimed).toBe(false);
    expect(outcome.text).toContain('Not posted as balanced.');
    expect(outcome.text).toContain('4.20');
  });

  it('repeats the refusal the books gave', () => {
    const outcome = postEntryOutcome('dtu_9', { ok: false, error: 'unbalanced: debits 4.20 != credits 0.00' });
    expect(outcome.claimed).toBe(false);
    expect(outcome.text).toBe('Not posted. unbalanced: debits 4.20 != credits 0.00');
    expect(outcome.text).not.toMatch(/^Posted/);
  });

  it('does not claim posted when the books return no entry', () => {
    expect(postEntryOutcome('dtu_9', { ok: true, result: null }).claimed).toBe(false);
    expect(postEntryOutcome('dtu_9', { ok: true, result: { entry: { citedDtuId: 'dtu_9', totalDebit: 1, totalCredit: 1 } } }).text)
      .toContain('no journal entry id');
  });
});

describe('reload index for entries already in the books', () => {
  it('maps finance rows to the journal entries that name them', () => {
    const index = indexPostedEntries([
      { entryId: 'je_1', number: 'JE-00001', source: 'finance-ledger-entry', sourceId: 'tx_abc', citedDtuId: 'dtu_9', debit: 4.2, credit: 0 },
      { entryId: 'je_1', number: 'JE-00001', source: 'finance-ledger-entry', sourceId: 'tx_abc', citedDtuId: 'dtu_9', debit: 0, credit: 4.2 },
    ]);
    expect(index.tx_abc).toEqual({ entryId: 'je_1', entryNumber: 'JE-00001', totalDebit: 4.2, citedDtuId: 'dtu_9' });
  });

  it('ignores journal entries another surface posted', () => {
    expect(indexPostedEntries([{ entryId: 'je_9', number: 'JE-00009', source: 'accounting-workbench', sourceId: 'tx_abc', debit: 5 }]))
      .toEqual({});
    expect(indexPostedEntries(null)).toEqual({});
    expect(indexPostedEntries([{ source: 'finance-ledger-entry' }])).toEqual({});
  });
});