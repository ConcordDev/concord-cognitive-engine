import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ api: { post } }));

import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';

describe('CrossLensRecentsPanel', () => {
  beforeEach(() => post.mockReset());

  it('renders a cross-lens row with source and age', async () => {
    post.mockResolvedValue({ data: { ok: true, surfaces: [{ dtuId: 'd1', title: 'Study', sourceLens: 'engineering', creatorId: 'u1', kind: 'report', surfacedAt: Math.floor(Date.now() / 1000) - 3 * 86_400 }] } });
    render(<CrossLensRecentsPanel lensId="code" hideWhenEmpty={false} />);
    expect(await screen.findByText('Study')).toBeInTheDocument();
    expect(screen.getByText(/engineering/i)).toBeInTheDocument();
    expect(screen.getByText(/3d ago/i)).toBeInTheDocument();
  });

  it('renders honest errors and refreshes empty results', async () => {
    post
      .mockResolvedValueOnce({ data: { ok: false, reason: 'offline' } })
      .mockResolvedValueOnce({ data: { ok: true, surfaces: [] } });
    render(<CrossLensRecentsPanel lensId="code" hideWhenEmpty={false} />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Refresh items from other lenses/i }));
    expect(await screen.findByText(/No DTUs surfaced/)).toBeInTheDocument();
  });
});
