import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { RepairBoundary } from '@/components/RepairBoundary';

function Bomb({ throwError }: { throwError: boolean }): React.ReactElement {
  if (throwError) throw new Error('kaboom');
  return <div>fine</div>;
}

describe('RepairBoundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    // React logs the caught error to console.error by design; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders children normally when nothing throws', () => {
    render(
      <RepairBoundary lens="test-lens">
        <Bomb throwError={false} />
      </RepairBoundary>
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('catches a render error, reports it via reportFrontendError, and shows the auto-repair UI', async () => {
    render(
      <RepairBoundary lens="test-lens">
        <Bomb throwError={true} />
      </RepairBoundary>
    );

    expect(screen.getByText(/Self-repairing/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/repair/frontend-error',
      expect.objectContaining({ method: 'POST' })
    );
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.error.message).toBe('kaboom');
    expect(body.lens).toBe('test-lens');
  });

  it('retries render after the backoff delay (retry_render strategy for a generic Error)', async () => {
    render(
      <RepairBoundary lens="test-lens">
        <Bomb throwError={true} />
      </RepairBoundary>
    );
    expect(screen.getByText(/Self-repairing/i)).toBeInTheDocument();

    // First backoff delay is 1000ms (1000 * 2^0).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // hasError resets to false and the (still-throwing) child throws again,
    // re-entering the caught state — this exercises attemptAutoRecovery's
    // retryCount increment path without needing the child to actually heal.
    expect(screen.getByText(/Self-repairing/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 retries and offers Reload Page', async () => {
    render(
      <RepairBoundary lens="test-lens">
        <Bomb throwError={true} />
      </RepairBoundary>
    );

    // Backoff delays are 1000 * 2^retryCount for retryCount 0, 1, 2.
    for (const delay of [1000, 2000, 4000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }

    expect(screen.getByText(/Auto-repair failed after 3 attempts/i)).toBeInTheDocument();
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
  });

  it('renders a custom fallback instead of the default panel once retries are exhausted', async () => {
    render(
      <RepairBoundary lens="test-lens" fallback={<div>custom fallback</div>}>
        <Bomb throwError={true} />
      </RepairBoundary>
    );

    for (const delay of [1000, 2000, 4000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }

    expect(screen.getByText('custom fallback')).toBeInTheDocument();
  });
});
