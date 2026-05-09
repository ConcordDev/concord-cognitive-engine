// Concord Mobile — Discovery Hook
//
// Phase 6d: cross-lens search hook. Debounces input and queries the
// discovery domain. Exposes results + facets.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Discovery } from '../api/macro-client';

interface DiscoveryResult {
  id: string;
  kind: string;
  title: string;
  creator_id: string;
  snippet: string;
  created_at: number;
}

interface UseDiscoveryResult {
  query: string;
  setQuery: (q: string) => void;
  results: DiscoveryResult[];
  facets: { kind: string; n: number }[];
  loading: boolean;
}

const DEBOUNCE_MS = 250;

export function useDiscovery(initial = ''): UseDiscoveryResult {
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [facets, setFacets] = useState<{ kind: string; n: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Facets load once.
  useEffect(() => {
    let cancelled = false;
    Discovery.facets().then(r => {
      if (cancelled) return;
      const fr = r as unknown as { ok: boolean; facets?: { kind: string; n: number }[] };
      if (fr.ok && Array.isArray(fr.facets)) setFacets(fr.facets);
    });
    return () => { cancelled = true; };
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const r = await Discovery.search(q);
      const sr = r as unknown as { ok: boolean; results?: DiscoveryResult[] };
      if (sr.ok && Array.isArray(sr.results)) setResults(sr.results);
      else setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, runSearch]);

  return { query, setQuery, results, facets, loading };
}
