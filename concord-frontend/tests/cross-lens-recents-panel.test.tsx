import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ lensRun }));

import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';

describe('CrossLensRecentsPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders a cross-lens row with source and age', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ok: true,
          surfaces: [
            { dtuId: 'd1', title: 'Study', sourceLens: 'engineering', creatorId: 'u1', kind: 'report', surfacedAt: Math.floor(Date.now() / 1000) - 3 * 86_400 },
          ],
        },
      },
    });
    render(<CrossLensRecentsPanel lensId="code" hideWhenEmpty={false} />);
    expect(await screen.findByText('Study')).toBeInTheDocument();
    expect(screen.getByText(/engineering/i)).toBeInTheDocument();
    expect(screen.getByText(/3d ago/i)).toBeInTheDocument();
  });

  it('degrades silently on quiet macro failures', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'missing_lens_id', result: null } });
    render(<CrossLensRecentsPanel lensId="code" hideWhenEmpty={false} />);
    // Quiet read-path failures should not surface as error text.
    expect(await screen.findByText(/No DTUs surfaced/)).toBeInTheDocument();
    expect(screen.queryByText('missing_lens_id')).not.toBeInTheDocument();
  });

  it('surfaces a small error line for real macro failures', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, error: 'offline', result: null } })
      .mockResolvedValueOnce({ data: { ok: true, result: { ok: true, surfaces: [] } } });
    render(<CrossLensRecentsPanel lensId="code" hideWhenEmpty={false} />);
    expect(await screen.findByText(/Could not load recents: offline/)).toBeInTheDocument();
    expect(screen.queryByText(/No DTUs surfaced/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh items from other lenses/i }));
    expect(await screen.findByText(/No DTUs surfaced/)).toBeInTheDocument();
  });

  it('does not call the macro when lensId is missing', async () => {
    render(<CrossLensRecentsPanel lensId="" hideWhenEmpty={false} />);
    // Wait a tick so any effect would have run.
    await new Promise((r) => setTimeout(r, 10));
    expect(lensRun).not.toHaveBeenCalled();
  });
});
