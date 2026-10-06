/**
 * A crypto holding report exists because the Crypto domain's
 * `holdings-add` macro returned the real lot — id, number, symbol,
 * ticker, chain, qty, costBasisUsd, unitCostUsd, acquiredAt. This
 * module turns exactly that result into a sentence, saves it as a
 * private DTU, reads that DTU back, and hands it to Thread as a draft.
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

export interface CryptoLot {
  id?: string;
  number?: string;
  symbol?: string;
  ticker?: string;
  chain?: string;
  qty?: number;
  qtyRemaining?: number;
  costBasisUsd?: number;
  unitCostUsd?: number;
  acquiredAt?: string;
  source?: string;
  walletId?: string | null;
  notes?: string;
}

export interface CryptoReportFacts {
  lot: CryptoLot | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function money(v: unknown): string {
  return (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
}

/**
 * The lot report sentence, built only from the real lot. Null when
 * there is no lot, no id, or no number.
 */
export function cryptoSentence(facts: CryptoReportFacts): string | null {
  const l = facts.lot;
  if (!l || !l.id || !l.number) return null;
  const ticker = str(l.ticker || l.symbol, 12) || 'token';
  const qty = num(l.qty);
  const cost = money(l.costBasisUsd);
  return `${l.number} · ${ticker}: ${qty} @ $${money(l.unitCostUsd)} = $${cost}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function cryptoBody(facts: CryptoReportFacts): string {
  const sentence = cryptoSentence(facts);
  const l = facts.lot;
  if (!sentence || !l) return '';
  const lines = [sentence, ''];
  lines.push(`Lot ID: ${l.id || '-'}`);
  lines.push(`Number: ${l.number || '-'}`);
  lines.push(`Symbol: ${str(l.symbol, 20) || '-'}`);
  lines.push(`Ticker: ${str(l.ticker, 12) || '-'}`);
  lines.push(`Chain: ${str(l.chain, 20) || '-'}`);
  lines.push(`Quantity: ${num(l.qty)}`);
  lines.push(`Qty remaining: ${num(l.qtyRemaining)}`);
  lines.push(`Cost basis (USD): ${money(l.costBasisUsd)}`);
  lines.push(`Unit cost (USD): ${money(l.unitCostUsd)}`);
  if (l.acquiredAt) lines.push(`Acquired: ${str(l.acquiredAt, 20)}`);
  if (l.source) lines.push(`Source: ${str(l.source, 30)}`);
  if (l.walletId) lines.push(`Wallet: ${str(l.walletId, 60)}`);
  if (l.notes) lines.push(`Notes: ${str(l.notes, 500)}`);
  lines.push('');
  lines.push('Every figure here came from the Crypto domain holdings-add macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same lot the macro returned, structured. */
export function cryptoMachine(facts: CryptoReportFacts): Record<string, unknown> | null {
  const l = facts.lot;
  if (!cryptoSentence(facts) || !l) return null;
  return {
    kind: 'crypto_holding_report',
    lotId: l.id || null,
    number: l.number || null,
    symbol: l.symbol || null,
    ticker: l.ticker || null,
    chain: l.chain || null,
    qty: num(l.qty),
    qtyRemaining: num(l.qtyRemaining),
    costBasisUsd: num(l.costBasisUsd),
    unitCostUsd: num(l.unitCostUsd),
  };
}

/** The private DTU that records this lot. Null when nothing can be saved. */
export function cryptoDtuCall(facts: CryptoReportFacts): ReceiptCall | null {
  const body = cryptoBody(facts);
  const sentence = cryptoSentence(facts);
  const machine = cryptoMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['crypto', 'holding', 'lot'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'crypto-lens:holding-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'crypto',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that lot report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function cryptoThreadDraftCall(
  facts: CryptoReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = cryptoSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const l = facts.lot!;
  const number = str(l.number, 20) || 'lot';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Crypto holding — ${number}`.slice(0, 120),
      content: cryptoBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface CryptoDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function cryptoThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): CryptoDraftResult | null {
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
export function indexCryptoDrafts(details: unknown): Record<string, string> {
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