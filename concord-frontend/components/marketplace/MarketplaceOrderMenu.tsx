'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  dtuReadBackCall,
  dtuReadBackMatches,
  dtuRecordId,
  offlineSentence,
  orderDtuCall,
  paidSentence,
  payRefusal,
  sendOrderOutcome,
  sendOrderToFinanceCall,
  type SettledOrder,
} from '@/components/marketplace/marketplaceOrder';

export interface BuyerOrder {
  id: string;
  number: string;
  sellerId?: string;
  listingTitle?: string;
  status: string;
  paymentStatus?: string;
  totalUsd: number;
  paidCc?: number;
  batchId?: string;
  feeCc?: number;
  sellerNetCc?: number;
}

function settledFrom(order: BuyerOrder): SettledOrder | null {
  const sentence = paidSentence(order);
  if (!sentence || !order.batchId || !(Number(order.paidCc) > 0)) return null;
  return {
    id: order.id,
    number: order.number,
    sellerId: order.sellerId,
    listingTitle: order.listingTitle,
    totalUsd: order.totalUsd,
    paidCc: Number(order.paidCc),
    batchId: order.batchId,
    feeCc: order.feeCc,
    sellerNetCc: order.sellerNetCc,
  };
}

export function MarketplaceOrderMenu({ order }: { order: BuyerOrder }) {
  const settled = settledFrom(order);
  const sentence = settled ? paidSentence(settled) : null;
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [financeId, setFinanceId] = useState<string | null>(null);
  if (!sentence || !settled) return null;

  async function save() {
    if (busy) return;
    const call = orderDtuCall(settled!);
    if (!call) {
      setNote('Not saved. This order has no ledger batch.');
      return;
    }
    setBusy('save');
    setNote(null);
    try {
      const response = await lensRun({
        domain: call.domain,
        name: call.action,
        input: withContentLicense(call.input, 'knowledge', ['private']),
      });
      const id = dtuRecordId(response.data);
      if (!response.data?.ok || !id) {
        setSavedDtuId(null);
        setNote(`Not saved. ${response.data?.error || 'No DTU id returned.'}`);
        return;
      }
      const read = await lensRun(dtuReadBackCall(id));
      if (!dtuReadBackMatches(id, read.data)) {
        setSavedDtuId(null);
        setNote(`Not saved. DTU ${id} could not be read back.`);
        return;
      }
      setSavedDtuId(id);
      setNote(`Saved as private DTU ${id}. No card was charged.`);
    } catch (err) {
      setSavedDtuId(null);
      setNote(`Not saved. ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (busy || !savedDtuId || !settled) return;
    const call = sendOrderToFinanceCall(settled, savedDtuId);
    if (!call) {
      setNote('Not sent. This DTU is not a paid order.');
      return;
    }
    setBusy('send');
    setNote(null);
    try {
      const response = await lensRun({ domain: call.domain, name: call.action, input: call.input });
      const outcome = sendOrderOutcome(savedDtuId, response.data);
      if (outcome.claimed) setFinanceId(outcome.receiptId);
      setNote(outcome.text);
    } catch (err) {
      setNote(`Not sent. ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[11px] text-emerald-300">{sentence}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void save(); }}
          disabled={busy !== null}
          className="text-[11px] text-orange-300 hover:underline disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving receipt…' : 'Save receipt as DTU'}
        </button>
        {savedDtuId && (
          <button
            type="button"
            onClick={() => { void send(); }}
            disabled={busy !== null}
            className="text-[11px] text-orange-300 hover:underline disabled:opacity-40"
          >
            {busy === 'send' ? 'Sending…' : 'Send this DTU to Finance'}
          </button>
        )}
        {financeId && (
          <a href="/lenses/finance" className="text-[11px] text-gray-300 hover:underline">
            Open Finance receipt {financeId}
          </a>
        )}
      </div>
      {note && <p className="text-[11px] text-gray-300" role="status">{note}</p>}
    </div>
  );
}

export function PayOrderButton({
  order,
  onPaid,
}: {
  order: BuyerOrder;
  onPaid: (order: BuyerOrder, sentence: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(offlineSentence(order));
  if (paidSentence(order) || order.status !== 'pending') {
    return note ? <p className="text-[11px] text-gray-300" role="status">{note}</p> : null;
  }

  async function pay() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await lensRun<{ order?: BuyerOrder; paidSentence?: string }>('marketplace', 'orders-pay', { id: order.id });
      const next = response.data?.result?.order;
      const sentence = paidSentence(next || null);
      if (!response.data?.ok || !next || !sentence) {
        setNote(payRefusal(response.data?.error));
        return;
      }
      onPaid({ ...order, ...next }, sentence);
      setNote(sentence);
    } catch (err) {
      setNote(payRefusal(err instanceof Error ? err.message : 'Request failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 space-y-1">
      <button
        type="button"
        onClick={() => { void pay(); }}
        disabled={busy}
        className="px-2 py-1 text-[10px] rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40"
      >
        {busy ? 'Paying…' : 'Pay with Concord Coin'}
      </button>
      <p className="text-[10px] text-gray-400">Charges the shop sticker as Concord Coin. No card is charged.</p>
      {note && <p className="text-[11px] text-gray-300" role="status">{note}</p>}
    </div>
  );
}
