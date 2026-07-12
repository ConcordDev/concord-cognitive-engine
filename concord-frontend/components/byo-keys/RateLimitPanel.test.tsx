/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RateLimitPanel } from './RateLimitPanel';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

describe('RateLimitPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads rate_limit_status on mount and renders all 5 slots', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { slots: [] }, error: null },
    });

    render(<RateLimitPanel />);

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('byo_keys', 'rate_limit_status', {}));
    expect(screen.getByTestId('ratelimit-conscious')).toBeInTheDocument();
    expect(screen.getByTestId('ratelimit-subconscious')).toBeInTheDocument();
    expect(screen.getByTestId('ratelimit-utility')).toBeInTheDocument();
    expect(screen.getByTestId('ratelimit-repair')).toBeInTheDocument();
    expect(screen.getByTestId('ratelimit-vision')).toBeInTheDocument();
  });

  it('shows "unrestricted" for a slot with no configured limit', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { slots: [] }, error: null },
    });
    render(<RateLimitPanel />);
    await waitFor(() => expect(screen.getByTestId('ratelimit-conscious')).toBeInTheDocument());
    // All 5 slots are unconfigured in this fixture — scope the assertion to one.
    expect(screen.getByTestId('ratelimit-conscious')).toHaveTextContent(/unrestricted/i);
  });

  it('renders the remaining/max count and gauge for a configured slot', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: { slots: [{ slot: 'conscious', maxPerMinute: 10, remaining: 7, nextTokenInMs: 0 }] },
        error: null,
      },
    });
    render(<RateLimitPanel />);
    await waitFor(() => expect(screen.getByTestId('ratelimit-conscious-count')).toBeInTheDocument());
    expect(screen.getByTestId('ratelimit-conscious-count')).toHaveTextContent('7 / 10 available');
    expect(screen.getByTestId('ratelimit-conscious-gauge')).toBeInTheDocument();
    expect(screen.queryByTestId('ratelimit-conscious-throttled')).toBeNull();
  });

  it('shows a "throttled" badge and a next-token countdown when the bucket is empty', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: { slots: [{ slot: 'utility', maxPerMinute: 5, remaining: 0, nextTokenInMs: 12000 }] },
        error: null,
      },
    });
    render(<RateLimitPanel />);
    await waitFor(() => expect(screen.getByTestId('ratelimit-utility-throttled')).toBeInTheDocument());
    expect(screen.getByTestId('ratelimit-utility-next')).toHaveTextContent('next in 12s');
  });

  it('setting a limit calls rate_limit_set with the entered value and refreshes', async () => {
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { slots: [] }, error: null } });
    render(<RateLimitPanel />);
    await waitFor(() => expect(screen.getByTestId('ratelimit-conscious-edit-btn')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('ratelimit-conscious-edit-btn'));
    const input = screen.getByTestId('ratelimit-conscious-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '15' } });

    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { slot: 'conscious', rateLimit: { maxPerMinute: 15 } }, error: null } });
    lensRunMock.mockResolvedValueOnce({
      data: {
        ok: true,
        result: { slots: [{ slot: 'conscious', maxPerMinute: 15, remaining: 15, nextTokenInMs: 0 }] },
        error: null,
      },
    });

    fireEvent.click(screen.getByTestId('ratelimit-conscious-save-btn'));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('byo_keys', 'rate_limit_set', { slot: 'conscious', maxPerMinute: 15 })
    );
  });

  it('clearing a limit calls rate_limit_set with maxPerMinute:null', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: {
        ok: true,
        result: { slots: [{ slot: 'repair', maxPerMinute: 5, remaining: 5, nextTokenInMs: 0 }] },
        error: null,
      },
    });
    render(<RateLimitPanel />);
    await waitFor(() => expect(screen.getByTestId('ratelimit-repair-clear-btn')).toBeInTheDocument());

    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { slot: 'repair', rateLimit: null }, error: null } });
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { slots: [] }, error: null } });

    fireEvent.click(screen.getByTestId('ratelimit-repair-clear-btn'));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('byo_keys', 'rate_limit_set', { slot: 'repair', maxPerMinute: null })
    );
  });

  it('surfaces a load error without crashing', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'no_actor' } });
    render(<RateLimitPanel />);
    await waitFor(() => expect(screen.getByTestId('ratelimit-error')).toBeInTheDocument());
    expect(screen.getByTestId('ratelimit-error')).toHaveTextContent('no_actor');
  });
});
