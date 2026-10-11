'use client';

import { useEffect, useRef } from 'react';
import { reportFrontendError } from '@/lib/report-frontend-error';

/**
 * Report a Next.js route error boundary once per distinct error.
 * A re-render with the same message, digest, and route does not post again.
 */
export function useReportRouteError(
  error: { message?: string; stack?: string; name?: string; digest?: string } | null | undefined,
  lens: string,
): void {
  const reportedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!error) return;
    let route = '';
    try {
      route = typeof window !== 'undefined' ? window.location.pathname : '';
    } catch {
      route = '';
    }
    const key = `${lens}|${route}|${error.message || ''}|${error.digest || ''}`;
    if (reportedKey.current === key) return;
    reportedKey.current = key;
    void reportFrontendError(
      {
        message: error.message || 'Unknown error',
        stack: error.stack,
        name: error.name,
        digest: error.digest,
      },
      { lens, route },
    );
  }, [error, lens]);
}
