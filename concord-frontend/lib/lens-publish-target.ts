'use client';

import { useEffect, useState } from 'react';

/** The manuscript or record the lens toolbar should share, once it has been saved. */
let current: { domain: string; id: string; title?: string } | null = null;
const listeners = new Set<() => void>();

export function setLensPublishTarget(domain: string, id: string, title?: string) {
  current = id ? { domain, id, title } : null;
  listeners.forEach((fn) => fn());
}

export function useLensPublishTarget(domain: string) {
  const [hit, setHit] = useState(current?.domain === domain ? current : null);
  useEffect(() => {
    const sync = () => setHit(current?.domain === domain ? current : null);
    sync();
    listeners.add(sync);
    return () => { listeners.delete(sync); };
  }, [domain]);
  return hit;
}
