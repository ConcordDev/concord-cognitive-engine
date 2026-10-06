/**
 * A wallet receipt exists only after the ledger accepted a transfer.
 * Saving it as a DTU and sending that DTU to Finance does not move Concord Coin again.
 */

export interface LedgerReceipt {
  kind: 'request' | 'schedule' | 'split';
  sourceId: string;
  amount: number;
  batchId: string;
  counterparty: string;
  note?: string;
}

export interface ReceiptCall {
  domain: string;
  action: string;
  input: Record<string, unknown>;
}

const DTU_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export function money(amount: number): string {
  return (Math.round((Number(amount) || 0) * 100) / 100).toFixed(2);
}

/** What the screen may say. Null when the ledger did not hand back a batch. */
export function ledgerSentence(receipt: LedgerReceipt | null | undefined): string | null {
  const batchId = String(receipt?.batchId || '').trim();
  const amount = Number(receipt?.amount);
  const sourceId = String(receipt?.sourceId || '').trim();
  if (!receipt || !batchId || !sourceId || !(amount > 0)) return null;
  const verb = receipt.kind === 'schedule' ? 'Sent' : 'Paid';
  return `${verb} ${money(amount)} CC. Ledger ${batchId}.`;
}

export function receiptBody(receipt: LedgerReceipt): string {
  const sentence = ledgerSentence(receipt);
  if (!sentence) return '';
  const lines = [
    sentence,
    `Source: wallet ${receipt.kind} ${receipt.sourceId}.`,
    `Counterparty: ${receipt.counterparty || 'unknown'}.`,
  ];
  const note = (receipt.note || '').trim();
  if (note) lines.push(`Note: ${note}`);
  lines.push('Concord Coin moved only because the ledger accepted this transfer.');
  return lines.join('\n');
}

export function receiptDtuCall(receipt: LedgerReceipt): ReceiptCall | null {
  const body = receiptBody(receipt);
  const sentence = ledgerSentence(receipt);
  if (!body || !sentence) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['wallet', 'receipt', receipt.kind],
      source: 'wallet-lens:receipt',
      human: { summary: body },
      core: {
        definitions: [sentence],
        claims: [body.slice(0, 240)],
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'wallet',
        wallet: {
          kind: receipt.kind,
          sourceId: receipt.sourceId,
          amount: Math.round(receipt.amount * 100) / 100,
          batchId: receipt.batchId,
          counterparty: receipt.counterparty,
        },
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function payloadOf(data: { result?: unknown }): Record<string, unknown> | null {
  let node = asRecord(data.result);
  if (!node) return null;
  const inner = asRecord(node.result);
  if (inner && ('dtu' in inner || 'receipt' in inner || 'id' in inner)) node = inner;
  return node;
}

export function dtuRecordId(data: { ok?: boolean; result?: unknown }): string {
  if (data.ok === false) return '';
  const payload = payloadOf(data);
  if (!payload) return '';
  const dtu = asRecord(payload.dtu);
  return String(dtu?.id || payload.id || '');
}

export function dtuReadBackMatches(id: string, data: { ok?: boolean; result?: unknown }): boolean {
  return Boolean(id) && dtuRecordId(data) === id;
}

export function dtuReadBackCall(id: string): ReceiptCall {
  return { domain: 'dtu', action: 'get', input: { id } };
}

export function sendReceiptToFinanceCall(receipt: LedgerReceipt, dtuId: string): ReceiptCall | null {
  const id = dtuId.trim();
  if (!DTU_ID.test(id) || !ledgerSentence(receipt)) return null;
  return {
    domain: 'finance',
    action: 'receipt-record',
    input: {
      citedDtuId: id,
      amount: Math.round(receipt.amount * 100) / 100,
      batchId: receipt.batchId,
      source: `wallet-${receipt.kind}`,
      sourceId: receipt.sourceId,
      counterparty: receipt.counterparty,
      note: receipt.note || '',
    },
  };
}

export function sendReceiptOutcome(
  dtuId: string,
  data: { ok?: boolean; result?: unknown; error?: string | null },
): { claimed: boolean; text: string; receiptId: string } {
  if (data.ok === false) {
    return { claimed: false, receiptId: '', text: `Not sent. ${data.error || 'The server refused this.'}` };
  }
  const payload = payloadOf(data);
  const receipt = asRecord(payload?.receipt);
  const receiptId = String(receipt?.id || '');
  const cited = String(receipt?.citedDtuId || '');
  if (!receiptId) {
    return { claimed: false, receiptId: '', text: 'Not sent. Finance returned no receipt id.' };
  }
  if (cited !== dtuId) {
    return {
      claimed: false,
      receiptId,
      text: `Finance stored receipt ${receiptId} without DTU ${dtuId}. Concord Coin was not moved again.`,
    };
  }
  return {
    claimed: true,
    receiptId,
    text: `Sent DTU ${dtuId} to Finance as receipt ${receiptId}. Concord Coin was not moved again.`,
  };
}
