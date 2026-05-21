'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface Receipt {
  id: string;
  stakeId: string;
  symbol: string;
  faceValueCc: number;
  mintedAt: number;
  unlocksAt: number;
  status: string;
  transferable: boolean;
  unlocked: boolean;
}

interface ReceiptList {
  receipts: Receipt[];
  count: number;
  liveFaceValueCc: number;
}

/**
 * ReceiptTokens — liquid-staking receipt tokens usable elsewhere while a
 * stake is locked. Wires staking.list_receipts + staking.transfer_receipt.
 */
export function ReceiptTokens({
  refreshKey,
  onChange,
}: {
  refreshKey: number;
  onChange: () => void;
}) {
  const [data, setData] = useState<ReceiptList | null>(null);
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [toUserId, setToUserId] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    const r = await lensRun<ReceiptList>('staking', 'list_receipts', {});
    if (r.data?.ok && r.data.result) setData(r.data.result);
  };

  useEffect(() => {
    void load();
  }, [refreshKey]);

  const transfer = async (receiptId: string) => {
    if (!toUserId.trim()) {
      setStatus('Enter a recipient user ID.');
      return;
    }
    setStatus('Transferring…');
    const r = await lensRun('staking', 'transfer_receipt', {
      receiptId,
      toUserId: toUserId.trim(),
    });
    if (r.data?.ok) {
      setStatus('Receipt transferred.');
      setTransferTarget(null);
      setToUserId('');
      await load();
      onChange();
    } else {
      setStatus(`Transfer failed: ${r.data?.error || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  if (!data) {
    return <div className="text-xs text-zinc-500 py-3">Loading receipt tokens…</div>;
  }

  if (data.count === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 px-3 py-4 text-center text-xs italic text-zinc-500">
        No liquid-staking receipts. Tick &quot;mint liquid receipt&quot; when opening a stake.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded border border-cyan-800/50 bg-cyan-950/20 px-3 py-2 text-[11px] text-cyan-200">
        Live receipt face value:{' '}
        <strong className="font-mono">{data.liveFaceValueCc} CC</strong> — usable as collateral
        elsewhere while your principal stays locked.
      </div>
      {status && (
        <div className="rounded border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-200">
          {status}
        </div>
      )}
      <ul className="space-y-1.5">
        {data.receipts.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-cyan-700/40 bg-cyan-950/15 p-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="font-mono font-bold text-cyan-200">{r.symbol}</span>
                <span className="ml-2 font-mono text-zinc-300">{r.faceValueCc} CC</span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                    r.status === 'active'
                      ? 'bg-emerald-900/50 text-emerald-300'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {r.status}
                </span>
              </div>
              {r.status === 'active' && r.transferable && (
                <button
                  type="button"
                  onClick={() => setTransferTarget(transferTarget === r.id ? null : r.id)}
                  className="rounded bg-cyan-800 px-2 py-1 text-[11px] text-white hover:bg-cyan-700"
                >
                  {transferTarget === r.id ? 'Cancel' : 'Transfer'}
                </button>
              )}
            </div>
            <p className="mt-1 font-mono text-[10px] text-zinc-500">
              backs {r.stakeId} · unlocks{' '}
              {new Date(r.unlocksAt * 1000).toLocaleDateString()}
            </p>
            {transferTarget === r.id && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="recipient user ID"
                  value={toUserId}
                  onChange={(e) => setToUserId(e.target.value)}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => transfer(r.id)}
                  className="rounded bg-cyan-700 px-3 py-1 text-xs text-white hover:bg-cyan-600"
                >
                  Send
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
