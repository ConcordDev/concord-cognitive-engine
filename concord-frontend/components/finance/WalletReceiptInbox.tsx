'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface WalletReceiptRow {
  id: string;
  citedDtuId: string;
  amount: number;
  batchId: string;
  source: string;
  sourceId: string;
  counterparty: string;
  note: string;
  recordedAt: string;
}

/**
 * Finance consumes a wallet receipt DTU by storing the cite.
 * Opening this list does not pay anyone.
 */
export function WalletReceiptInbox() {
  const [rows, setRows] = useState<WalletReceiptRow[]>([]);
  const [note, setNote] = useState('Loading wallet receipts…');

  const refresh = useCallback(async () => {
    const r = await lensRun<{ receipts: WalletReceiptRow[] }>('finance', 'receipt-list', {});
    if (!r.data?.ok || !r.data.result) {
      setRows([]);
      setNote(r.data?.error || 'Wallet receipts could not be loaded.');
      return;
    }
    const receipts = r.data.result.receipts || [];
    setRows(receipts);
    setNote(receipts.length === 0 ? 'No wallet receipts yet. A paid transfer can be saved as a DTU and sent here.' : '');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Wallet receipts</h3>
        <button type="button" onClick={() => { void refresh(); }} className="text-xs text-zinc-400 hover:text-white">
          Refresh
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-400">
        Records of Concord Coin the wallet ledger already accepted. Recording one here does not move Coin again.
      </p>
      {note && <p className="mt-3 text-xs text-zinc-400" role="status">{note}</p>}
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-zinc-800 px-3 py-2">
              <p className="text-sm text-white">
                {row.amount.toFixed(2)} CC · ledger {row.batchId}
              </p>
              <p className="text-[11px] text-zinc-400" role="status">
                Recorded receipt {row.id} from {row.source} DTU {row.citedDtuId}. Concord Coin was not moved again.
              </p>
              <p className="text-[10px] font-mono text-zinc-500">
                {row.source} {row.sourceId}{row.counterparty ? ` · ${row.counterparty}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
