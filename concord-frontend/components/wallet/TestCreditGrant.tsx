'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { useWalletTestCreditAvailability } from './useWalletQueries';

/**
 * Fixed test-credit grant. The server refuses this for a normal account
 * when NODE_ENV is production; the button stays unrendered unless the
 * probe says the grant is available.
 */
export function TestCreditGrant({ onGranted }: { onGranted: () => void }) {
  const availability = useWalletTestCreditAvailability();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  if (!availability.data?.available || availability.data.gross == null) return null;
  const gross = availability.data.gross;

  const grant = async () => {
    if (pending) return;
    setPending(true);
    setNote('');
    setError('');
    try {
      const res = await api.post('/api/economy/test-credit', {});
      const data = res.data as { ok?: boolean; net?: number; error?: string };
      if (!data.ok || typeof data.net !== 'number') {
        setError('Test credit was not added.');
        return;
      }
      setNote(`Test credit added: ${data.net.toLocaleString()} CC`);
      onGranted();
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'test_credit_unavailable') setError('Test credit is not available for this account.');
      else if (code === 'test_credit_cap') setError('Test credit limit reached for today.');
      else setError('Test credit was not added.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={cn(ds.panel, 'px-4 py-3')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-white">Test credit</p>
          <p className="text-xs text-gray-400">
            {gross.toLocaleString()} CC before the purchase fee. Closed-loop coin for proving a send, not a Stripe purchase.
          </p>
        </div>
        <button
          type="button"
          onClick={grant}
          disabled={pending}
          className={cn(ds.btnSecondary, 'inline-flex items-center gap-2 shrink-0')}
        >
          {pending && <Loader2 className="w-4 h-4 animate-spin" />}
          {pending ? 'Adding test credit' : `Grant ${gross.toLocaleString()} CC test credit`}
        </button>
      </div>
      {note && <p className="text-xs mt-2" style={{ color: 'var(--lens-accent)' }} role="status">{note}</p>}
      {error && <p className="text-xs text-red-400 mt-2" role="alert">{error}</p>}
    </div>
  );
}
