/**
 * FIX-attention-007 — the Attention Cognition view crashed with the
 * lens-level error surface. Root cause: EntityGrowthDashboard's sections
 * dereference nested metrics records (processingPathDistribution,
 * sourceVisits, recentCascades, …) unconditionally, so a partial metrics
 * payload — a fresh system whose emergent modules have recorded nothing
 * yet — throws "Cannot convert undefined or null to object" and the
 * boundary takes the whole view. Pin: with empty/partial payloads the
 * desk mounts and both sections render their zero states.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const anyNs = () => new Proxy({}, { get: () => vi.fn(async () => ({ data: {} })) });
vi.mock('@/lib/api/client', () => ({
  apiHelpers: new Proxy({}, { get: (_t, ns) => (ns === 'attention' ? { threads: vi.fn(async () => ({ data: { threads: [] } })) } : anyNs()) }),
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { EmergentDeskPanel } from '@/components/attention/EmergentDeskPanel';

describe('FIX-attention-007 Cognition view survives partial payloads', () => {
  it('desk mounts with empty emergent payloads and renders both metric sections', async () => {
    const boundaryErrors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { if (JSON.stringify(a).includes('ErrorBoundary')) boundaryErrors.push(a); };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><EmergentDeskPanel /></QueryClientProvider>);
    expect(await screen.findByText('Web Exploration')).toBeTruthy();
    expect(await screen.findByText('Hive Communication')).toBeTruthy();
    console.error = orig;
    expect(boundaryErrors).toHaveLength(0);
  });
});
