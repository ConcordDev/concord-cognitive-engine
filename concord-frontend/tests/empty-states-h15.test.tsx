/**
 * H15 — empty and permanent-loading states say something: Approvals with no
 * wallet stops loading, the DTU score table and Billing panels explain an
 * empty result, the Scheduled queue tab no longer points at a form that is
 * not on it, and the mesh Signal tab explains "no data".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn(async () => ({ data: { result: { allowances: [] } } })), api: { get: vi.fn(), post: vi.fn() }, apiHelpers: {} }));

import { ApprovalsManager } from '@/components/crypto/ApprovalsManager';
import { JobList } from '@/components/queue/JobList';

afterEach(cleanup);
const src = (f: string) => readFileSync(resolve(__dirname, `../components/${f}`), 'utf8');

describe('H15 empty states', () => {
  it('Approvals with no wallet says so instead of showing loading rows forever', () => {
    render(<ApprovalsManager />);
    expect(screen.getByText('Select a wallet to see its token approvals.')).toBeTruthy();
  });

  it('JobList uses a caller-supplied empty hint, and keeps the default otherwise', () => {
    const noop = vi.fn();
    const props = { jobs: [], busyId: null, onProcess: noop, onRetry: noop, onRemove: noop, onSelect: noop };
    const { rerender } = render(<JobList {...props} emptyHint="No scheduled jobs. Use Overview." />);
    expect(screen.getByText('No scheduled jobs. Use Overview.')).toBeTruthy();
    rerender(<JobList {...props} />);
    expect(screen.getByText(/Enqueue one above/)).toBeTruthy();
  });

  it.each([
    ['cri/ScoresPanel.tsx', 'No DTUs match the current filters.'],
    ['billing/BillingWorkbench.tsx', 'No transactions yet. Purchases, credits and spend'],
    ['billing/BillingWorkbench.tsx', 'No token movement yet.'],
    ['mesh/MeshSignal.tsx', 'No signal readings yet.'],
    ['queue/QueueTabPanels.tsx', 'No scheduled jobs. Enqueue a job with a Delay (s) from the Overview tab'],
  ])('%s carries "%s"', (f, text) => {
    expect(src(f)).toContain(text);
  });
});
