/**
 * A marketplace order is paid only after the ledger accepts the purchase.
 * Saving that receipt as a DTU and sending it to Finance does not move Concord Coin again.
 * The shop sticker is charged as Concord Coin. No card is charged.
 */

export interface SettledOrder {
  id: string;
  number?: string;
  sellerId?: string;
  listingTitle?: string;
  totalUsd: number;
  paidCc: number;
  batchId: string;
  feeCc?: number;
  sellerNetCc?: number;
}

export interface OrderPayCall {
  domain: string;
  action: string;
  input: Record<string, unknown>;
}

export interface PlacedCheckoutOrder {
  orderId: string;
  number: string;
  sellerId: string;
  totalUsd: number;
}

export interface PlacedCheckout {
  number: string;
  grandTotalUsd: number;
  orders: PlacedCheckoutOrder[];
}

/** checkout-create's payload is `{ checkout }`. A flat order list is accepted too. */
export function checkoutFromLensResult(result: unknown): PlacedCheckout | null {
  if (!result || typeof result !== 'object') return null;
  const node = result as { checkout?: unknown };
  const raw = (node.checkout && typeof node.checkout === 'object' ? node.checkout : result) as {
    number?: unknown;
    grandTotalUsd?: unknown;
    orders?: unknown;
  };
  if (!Array.isArray(raw.orders)) return null;
  const orders: PlacedCheckoutOrder[] = [];
  for (const row of raw.orders) {
    if (!row || typeof row !== 'object') continue;
    const order = row as { orderId?: unknown; number?: unknown; sellerId?: unknown; totalUsd?: unknown };
    const orderId = String(order.orderId || '').trim();
    if (!orderId) continue;
    orders.push({
      orderId,
      number: String(order.number || ''),
      sellerId: String(order.sellerId || ''),
      totalUsd: Number(order.totalUsd) || 0,
    });
  }
  if (orders.length === 0) return null;
  return {
    number: String(raw.number || ''),
    grandTotalUsd: Number(raw.grandTotalUsd) || 0,
    orders,
  };
}

const DTU_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

export function money(amount: number): string {
  return (Math.round((Number(amount) || 0) * 100) / 100).toFixed(2);
}

/** What the screen may say. Null when the ledger did not hand back a batch. */
export function paidSentence(order: Partial<SettledOrder> | null | undefined): string | null {
  const batchId = String(order?.batchId || '').trim();
  const amount = Number(order?.paidCc);
  const id = String(order?.id || '').trim();
  if (!order || !id || !batchId || !(amount > 0)) return null;
  return `Paid ${money(amount)} CC. Ledger ${batchId}. Shop sticker $${money(Number(order.totalUsd) || 0)}. No card was charged.`;
}

export function payRefusal(error?: string | null): string {
  if (error === 'insufficient_balance') return 'Not paid. The balance is short. Concord Coin was not moved.';
  if (error === 'ledger_unavailable') return 'Not paid. The ledger is unavailable. Concord Coin was not moved.';
  if (error === 'you cannot pay your own shop') return 'Not paid. You cannot pay your own shop. Concord Coin was not moved.';
  return `Not paid. ${error || 'The server refused this.'} Concord Coin was not moved.`;
}

export function offlineSentence(order: { status?: string; paymentStatus?: string; batchId?: string } | null | undefined): string | null {
  if (!order || paidSentence(order as SettledOrder)) return null;
  if (
    order.paymentStatus === 'confirmed_by_seller'
    || order.paymentStatus === 'recorded_offline'
    || (order.status === 'paid' && !String(order.batchId || '').trim())
  ) {
    return 'Recorded offline. Concord Coin was not moved.';
  }
  return null;
}

export function receiptBody(order: SettledOrder): string {
  const sentence = paidSentence(order);
  if (!sentence) return '';
  const lines = [
    sentence,
    `Order: ${order.number || order.id}.`,
    `Seller: ${order.sellerId || 'unknown'}.`,
  ];
  if (order.listingTitle) lines.push(`Listing: ${order.listingTitle}.`);
  if (Number.isFinite(Number(order.feeCc))) lines.push(`Platform fee: ${money(Number(order.feeCc))} CC.`);
  if (Number.isFinite(Number(order.sellerNetCc))) lines.push(`Seller net: ${money(Number(order.sellerNetCc))} CC.`);
  lines.push('Concord Coin moved only because the ledger accepted this marketplace purchase.');
  return lines.join('\n');
}

export function orderDtuCall(order: SettledOrder): OrderPayCall | null {
  const body = receiptBody(order);
  const sentence = paidSentence(order);
  if (!body || !sentence) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['marketplace', 'receipt', 'order'],
      source: 'marketplace-lens:order',
      human: { summary: body },
      core: {
        definitions: [sentence],
        claims: [body.slice(0, 240)],
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'marketplace',
        marketplace: {
          orderId: order.id,
          orderNumber: order.number || '',
          sellerId: order.sellerId || '',
          paidCc: Math.round(order.paidCc * 100) / 100,
          totalUsd: Math.round((Number(order.totalUsd) || 0) * 100) / 100,
          batchId: order.batchId,
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
  if (inner && ('dtu' in inner || 'receipt' in inner || 'id' in inner || 'order' in inner)) node = inner;
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

export function dtuReadBackCall(id: string): OrderPayCall {
  return { domain: 'dtu', action: 'get', input: { id } };
}

export function sendOrderToFinanceCall(order: SettledOrder, dtuId: string): OrderPayCall | null {
  const id = dtuId.trim();
  if (!DTU_ID.test(id) || !paidSentence(order)) return null;
  return {
    domain: 'finance',
    action: 'receipt-record',
    input: {
      citedDtuId: id,
      amount: Math.round(order.paidCc * 100) / 100,
      batchId: order.batchId,
      source: 'marketplace-order',
      sourceId: order.id,
      counterparty: order.sellerId || '',
      note: order.number || '',
    },
  };
}

export function sendOrderOutcome(
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
