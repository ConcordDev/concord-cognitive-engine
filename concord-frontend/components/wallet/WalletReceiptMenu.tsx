'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  dtuReadBackCall,
  dtuReadBackMatches,
  dtuRecordId,
  ledgerSentence,
  receiptDtuCall,
  sendReceiptOutcome,
  sendReceiptToFinanceCall,
  type LedgerReceipt,
} from '@/components/wallet/walletReceipt';

export function WalletReceiptMenu({ receipt }: { receipt: LedgerReceipt }) {
  const sentence = ledgerSentence(receipt);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [financeId, setFinanceId] = useState<string | null>(null);
  if (!sentence) return null;

  async function save() {
    if (busy) return;
    const call = receiptDtuCall(receipt);
    if (!call) {
      setNote('Not saved. This transfer has no ledger batch.');
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
      setNote(`Saved as private DTU ${id}.`);
    } catch (err) {
      setSavedDtuId(null);
      setNote(`Not saved. ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (busy || !savedDtuId) return;
    const call = sendReceiptToFinanceCall(receipt, savedDtuId);
    if (!call) {
      setNote('Not sent. This DTU is not a ledger receipt.');
      return;
    }
    setBusy('send');
    setNote(null);
    try {
      const response = await lensRun({ domain: call.domain, name: call.action, input: call.input });
      const outcome = sendReceiptOutcome(savedDtuId, response.data);
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
      <p className="text-[11px] text-green-400" role="status">{sentence}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { void save(); }}
          disabled={busy !== null}
          className="text-[11px] text-neon-cyan hover:underline disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving receipt…' : 'Save receipt as DTU'}
        </button>
        {savedDtuId && (
          <button
            type="button"
            onClick={() => { void send(); }}
            disabled={busy !== null}
            className="text-[11px] text-neon-cyan hover:underline disabled:opacity-40"
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
