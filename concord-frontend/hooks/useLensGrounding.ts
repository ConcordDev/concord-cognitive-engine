'use client';

// useLensGrounding — pull a lens's OWN grounding DTUs (job a + b payoff).
//
// Calls the discovery.search macro with the lens hint, which (post DTU→lens
// routing) filters the corpus to rows stamped with this lens's lens_id instead
// of free-text-searching the flat pool. So the math lens sees the math grounding
// pack, robotics sees control-theory, pharmacy sees pharmacology — each lens
// reaches its own depth. Returns [] gracefully on any failure (never throws into
// the render).

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api/client';

export interface GroundingDTU {
  id: string;
  kind: string;
  title: string;
  snippet?: string;
}

export function useLensGrounding(lens: string | undefined, query = '', limit = 12) {
  const [items, setItems] = useState<GroundingDTU[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!lens) { setItems([]); return; }
    setLoading(true); setError(null);
    try {
      // discovery.search requires a query ≥2 chars; default to the lens name so a
      // bare "show me this lens's grounding" call still returns its routed corpus.
      const q = (query && query.length >= 2) ? query : lens;
      const { data } = await api.post('/api/lens/run', {
        domain: 'discovery',
        name: 'search',
        input: { query: q, lens, limit },
      });
      const results = data?.results ?? data?.result?.results ?? [];
      setItems(Array.isArray(results) ? results : []);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [lens, query, limit]);

  useEffect(() => { refresh(); }, [refresh]);

  return { items, loading, error, refresh };
}

export default useLensGrounding;
