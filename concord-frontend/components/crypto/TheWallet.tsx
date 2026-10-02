'use client';

/** Crypto north star — the balance the portfolio engine returns. Receive is the one action. */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, usd, useMacro } from '@/components/lens/NorthStarChrome';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Summary = { totalValueUsd?: number; lotCount?: number; unrealizedPnlPct?: number };
type WalletArtifact = { id: string; data?: { address?: string; name?: string } };

const quiet = { retry: false, refetchOnWindowFocus: false } as const;

export function TheWallet({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('crypto');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const summaryQ = useMacro<Summary>(
    ['crypto-northstar', 'summary'],
    'crypto',
    'portfolio-summary',
    {},
    (result) => {
      if (typeof result.totalValueUsd !== 'number' || !Number.isFinite(result.totalValueUsd)) {
        throw new Error('The wallet did not answer.');
      }
      return result;
    },
  );
  const walletsQ = useQuery({
    queryKey: ['crypto-northstar', 'wallets'],
    ...quiet,
    queryFn: async () => {
      const res = await api.get<{ artifacts?: WalletArtifact[] }>('/api/lens/crypto?type=wallet');
      return res.data?.artifacts ?? [];
    },
  });

  const address = walletsQ.data?.map((w) => w.data?.address).find((a) => typeof a === 'string' && a.length > 0) ?? null;
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [nextAddress, setNextAddress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const saveAddress = async () => {
    if (!label.trim() || !nextAddress.trim()) {
      setError('Receive needs a name and an address.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/lens/crypto', {
        type: 'wallet',
        title: label.trim(),
        data: { name: label.trim(), address: nextAddress.trim(), chainId: 'concord', isDefault: true },
      });
      if (res.data?.ok === false) {
        setError(res.data.error || 'The address was not saved.');
        return;
      }
      setLabel('');
      setNextAddress('');
      setAdding(false);
      await client.invalidateQueries({ queryKey: ['crypto-northstar', 'wallets'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The address was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const total = summaryQ.data?.totalValueUsd;
  const lots = summaryQ.data?.lotCount ?? 0;
  const pnl = summaryQ.data?.unrealizedPnlPct;
  const summaryError = summaryQ.error instanceof Error ? summaryQ.error.message : '';

  return (
    <LensShell lensId="crypto" asMain={false} disableAgentFab>
      <div data-lens-theme="crypto" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Crypto" title={who ? `The wallet, ${who}` : 'The wallet'} />
          <QuietMore items={[{ id: 'desk', label: 'Portfolio desk' }]} onPick={onOpenDesk} />
        </div>

        {(summaryError || error) && <NorthError message={summaryError || error} />}

        <p className="mt-8 font-vault text-[3rem] leading-none tabular-nums text-zinc-100" data-testid="wallet-balance">
          {total == null ? '—' : usd(total)}
        </p>
        {total != null && lots > 0 && typeof pnl === 'number' && Number.isFinite(pnl) && (
          <p className="mt-2 text-[14px] text-zinc-500">Unrealized {pnl}%</p>
        )}
        {address && <p className="mt-6 max-w-xl break-all font-mono text-[13px] text-zinc-400">{address}</p>}

        {adding && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void saveAddress(); }}>
            <input aria-label="Wallet name" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <input aria-label="Receive address" value={nextAddress} onChange={(e) => setNextAddress(e.target.value)} placeholder="Address" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Save address</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setAdding(true)}>Receive</button>
      </div>
    </LensShell>
  );
}
