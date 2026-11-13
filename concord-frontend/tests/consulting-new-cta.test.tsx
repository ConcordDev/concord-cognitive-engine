/**
 * FIX-consulting-004 — the consulting workspace's floating '+ New' CTA
 * only switched to the Engagements tool, which is the default view:
 * pressed there it did nothing at all, and it never reached the
 * new-engagement form. The CTA now bumps a signal the EngagementTracker
 * answers by focusing the create form's first field.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useQuery: () => ({ data: { engs: [], dash: null }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  };
});

import { EngagementTracker } from '@/components/consulting/EngagementTracker';

describe('FIX-consulting-004 — + New focuses the engagement form', () => {
  it('focus moves to the name field when the signal bumps, and only then', () => {
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { engagements: [] } } });
    const { rerender } = render(<EngagementTracker newFocusSignal={0} />);
    const input = screen.getByLabelText('New engagement name');
    expect(document.activeElement).not.toBe(input);
    rerender(<EngagementTracker newFocusSignal={1} />);
    expect(document.activeElement).toBe(input);
  });
});
