/**
 * useApiRequest.ts — fetch with timeout, retry, and loading state.
 *
 * Defaults to 10s timeout (per the user's "forever loading" complaint —
 * the old 120s default meant a hung request would never fail visibly).
 * Retries 2x on 5xx + network errors. Returns loading/error/data state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseApiRequestOptions<T> {
  /** The fetch URL (or function that returns one) */
  url: string | (() => string);
  /** Fetch options */
  fetchOptions?: RequestInit;
  /** Auto-run on mount (default: false) */
  autoRun?: boolean;
  /** Default timeout (ms). Default 10s — never more. */
  timeoutMs?: number;
  /** Max retries (default: 2). Retries on 5xx + network errors only. */
  maxRetries?: number;
  /** Backoff base (ms). Default 500 — doubles per retry. */
  backoffMs?: number;
  /** Called on each successful response */
  onSuccess?: (data: T) => void;
  /** Called on final error */
  onError?: (error: ApiRequestError) => void;
}

export class ApiRequestError extends Error {
  status?: number;
  retryable: boolean;
  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export interface UseApiRequestResult<T> {
  data: T | null;
  loading: boolean;
  error: ApiRequestError | null;
  /** Manually trigger a fetch */
  refetch: () => Promise<void>;
  /** Cancel any in-flight request */
  cancel: () => void;
}

export function useApiRequest<T = unknown>(options: UseApiRequestOptions<T>): UseApiRequestResult<T> {
  const {
    url,
    fetchOptions,
    autoRun = false,
    timeoutMs = 10_000,
    maxRetries = 2,
    backoffMs = 500,
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const fetchOptionsKey = JSON.stringify(fetchOptions);
  const stableFetchOptions = useMemo(() => fetchOptions, [fetchOptionsKey]);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const refetch = useCallback(async () => {
    cancel(); // cancel any prior request
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    const urlStr = typeof url === 'function' ? url() : url;
    let lastError: ApiRequestError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (controller.signal.aborted) break;

      // Timeout per attempt (not total)
      const timeoutHandle = setTimeout(() => {
        if (!controller.signal.aborted) controller.abort();
      }, timeoutMs);

      try {
        const res = await fetch(urlStr, {
          ...stableFetchOptions,
          signal: controller.signal,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...stableFetchOptions?.headers,
          },
        });

        clearTimeout(timeoutHandle);

        if (controller.signal.aborted) break;

        if (!res.ok) {
          const is5xx = res.status >= 500 && res.status < 600;
          const isRetryable = is5xx || res.status === 429;
          const body = await res.text().catch(() => '');
          const err = new ApiRequestError(
            `HTTP ${res.status}: ${body.slice(0, 200)}`,
            res.status,
            isRetryable,
          );
          if (!isRetryable || attempt === maxRetries) {
            setError(err);
            onErrorRef.current?.(err);
            setLoading(false);
            return;
          }
          lastError = err;
          // Retry after backoff
          await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          continue;
        }

        const json = (await res.json()) as T;
        if (controller.signal.aborted) break;
        setData(json);
        setLoading(false);
        onSuccessRef.current?.(json);
        return;
      } catch (e) {
        clearTimeout(timeoutHandle);
        if (controller.signal.aborted) break;

        const err = e instanceof Error ? e : new Error(String(e));
        const wrapped = new ApiRequestError(
          err.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : err.message,
          undefined,
          err.name !== 'AbortError',
        );
        if (attempt === maxRetries) {
          setError(wrapped);
          onErrorRef.current?.(wrapped);
          setLoading(false);
          return;
        }
        lastError = wrapped;
        await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
      }
    }

    // Cancelled or gave up
    if (lastError) {
      setError(lastError);
      onErrorRef.current?.(lastError);
    }
    setLoading(false);
  }, [url, stableFetchOptions, timeoutMs, maxRetries, backoffMs]);

  useEffect(() => {
    if (autoRun) {
      refetch();
    }
    return () => cancel();
  }, [autoRun, refetch, cancel]);

  return { data, loading, error, refetch, cancel };
}

export default useApiRequest;
