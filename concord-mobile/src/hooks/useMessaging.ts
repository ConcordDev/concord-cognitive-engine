// Concord Mobile — Messaging Hook (Phase Y).
//
// Cross-platform message bindings (whatsapp / slack / sms / email).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Messaging } from '../api/macro-client';

export interface BindingEntry {
  id: string;
  platform: 'whatsapp' | 'slack' | 'sms' | 'email' | string;
  handle: string;
  is_default: boolean;
}

interface UseMessagingResult {
  bindings: BindingEntry[];
  add: (platform: string, handle: string) => Promise<void>;
  remove: (bindingId: string) => Promise<void>;
  setDefault: (bindingId: string) => Promise<void>;
  refresh: () => Promise<void>;
  busy: boolean;
}

export function useMessaging(): UseMessagingResult {
  const [bindings, setBindings] = useState<BindingEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    const r = await Messaging.listBindings();
    if (cancelled.current) return;
    const next = (r as unknown as { bindings?: BindingEntry[] }).bindings;
    if (r.ok && Array.isArray(next)) setBindings(next);
  }, []);

  useEffect(() => {
    cancelled.current = false;
    refresh();
    return () => { cancelled.current = true; };
  }, [refresh]);

  const add = useCallback(async (platform: string, handle: string) => {
    setBusy(true);
    try { await Messaging.addBinding(platform, handle); await refresh(); }
    finally { setBusy(false); }
  }, [refresh]);

  const remove = useCallback(async (bindingId: string) => {
    setBusy(true);
    try { await Messaging.removeBinding(bindingId); await refresh(); }
    finally { setBusy(false); }
  }, [refresh]);

  const setDefault = useCallback(async (bindingId: string) => {
    setBusy(true);
    try { await Messaging.setDefault(bindingId); await refresh(); }
    finally { setBusy(false); }
  }, [refresh]);

  return { bindings, add, remove, setDefault, refresh, busy };
}
