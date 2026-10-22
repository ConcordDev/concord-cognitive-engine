'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useWebPush } from '@/hooks/useWebPush';

/**
 * Shown only when the server has a VAPID public key. The click is the
 * user gesture that asks for notification permission.
 */
export function PushEnableButton() {
  const [ready, setReady] = useState(false);
  const { enable, status, error } = useWebPush();

  useEffect(() => {
    let cancel = false;
    void api.get<{ ok?: boolean; publicKey?: string | null }>('/api/push/vapid-public-key')
      .then((res) => {
        if (!cancel) setReady(!!(res.data?.ok && res.data.publicKey));
      })
      .catch(() => { if (!cancel) setReady(false); });
    return () => { cancel = true; };
  }, []);

  if (!ready) return null;

  const label = status === 'subscribed'
    ? 'Notifications enabled'
    : status === 'denied'
      ? 'Notifications blocked'
      : 'Enable notifications';

  return (
    <button
      type="button"
      onClick={() => { if (status !== 'subscribed') void enable(); }}
      className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300 hover:text-zinc-100"
    >
      {label}
      {error ? <span className="ml-1 text-rose-400">{error}</span> : null}
    </button>
  );
}
