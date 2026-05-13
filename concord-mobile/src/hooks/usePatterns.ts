// Concord Mobile — Patterns Hook (Phase Y).
//
// Discovery search across drift_alerts + cnet-federation findings.
// Debounced 300ms.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Patterns } from '../api/macro-client';

export interface PatternHit {
  id: string;
  kind: string;
  title?: string;
  signature?: string;
  detected_at?: number;
}

interface UsePatternsResult {
  query: string;
  setQuery: (q: string) => void;
  results: PatternHit[];
  busy: boolean;
}

const DEBOUNCE_MS = 300;

export function usePatterns(initialLimit = 25): UsePatternsResult {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatternHit[]>([]);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  const runSearch = useCallback(async (q: string) => {
    setBusy(true);
    try {
      const r = await Patterns.discover(q, initialLimit);
      if (cancelled.current) return;
      const next = (r as unknown as { results?: PatternHit[] }).results;
      if (r.ok && Array.isArray(next)) setResults(next);
    } finally { if (!cancelled.current) setBusy(false); }
  }, [initialLimit]);

  useEffect(() => {
    cancelled.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      cancelled.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  return { query, setQuery, results, busy };
}
