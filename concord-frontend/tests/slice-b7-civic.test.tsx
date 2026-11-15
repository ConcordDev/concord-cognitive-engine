import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-civic-bonds-008: both legs (own Feed post shows no
// Delete; Feed Profile says "Sign in" while signed in) trace to
// useAuth settling on null forever after ONE transient
// /api/auth/me failure. The hook now retries before believing
// "signed out", and the profile panel distinguishes loading from
// signed-out.

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  lensRun: vi.fn(),
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/components/social/UserProfile', () => ({
  UserProfile: ({ userId }: { userId: string }) => <div>profile-of-{userId}</div>,
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { useAuth } from '@/hooks/useAuth';
import { FeedProfilePanel } from '@/components/feed/FeedProfilePanel';

function Probe() {
  const { user, isLoading } = useAuth();
  return <div>{isLoading ? 'loading' : user ? `user:${user.id}` : 'signed-out'}</div>;
}

beforeEach(() => { apiGet.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('useAuth — transient failure self-heals (FIX-civic-bonds-008)', () => {
  it('a rejected /me retries and the signed-in user lands without a remount', async () => {
    vi.useFakeTimers();
    apiGet
      .mockRejectedValueOnce(new Error('refresh window'))
      .mockResolvedValue({ data: { ok: true, user: { id: 'u1', username: 'qa', email: 'q@x', role: 'user' } } });
    render(<Probe />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('loading')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve(); });
    expect(screen.getByText('user:u1')).toBeInTheDocument();
  });

  it('persistent failure settles signed-out after the retries', async () => {
    vi.useFakeTimers();
    apiGet.mockRejectedValue(new Error('down'));
    render(<Probe />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(6000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(9000); await Promise.resolve(); });
    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(4);
  });
});

describe('FeedProfilePanel — loading is not signed-out', () => {
  it('shows a loading line while auth resolves, the sign-in line only when settled', () => {
    const { rerender } = render(<FeedProfilePanel userId={null} loading />);
    expect(screen.getByText('Loading your profile…')).toBeInTheDocument();
    expect(screen.queryByText('Sign in to see your profile.')).not.toBeInTheDocument();
    rerender(<FeedProfilePanel userId={null} loading={false} />);
    expect(screen.getByText('Sign in to see your profile.')).toBeInTheDocument();
    rerender(<FeedProfilePanel userId="u1" loading={false} />);
    expect(screen.getByText('profile-of-u1')).toBeInTheDocument();
  });
});
