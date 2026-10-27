import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LensErrorBoundary } from '@/components/lens/LensErrorBoundary';

const Throws = () => {
  throw new Error('render boom');
};

describe('LensErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response()));
  });

  it('catches render errors and does NOT POST to /api/lens/run', () => {
    render(
      <LensErrorBoundary lensId="test-lens">
        <Throws />
      </LensErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('recovers when the user clicks Try again', async () => {
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) throw new Error('again');
      return <div data-testid="recovered">ok</div>;
    }
    render(
      <LensErrorBoundary lensId="test-lens">
        <MaybeThrow />
      </LensErrorBoundary>
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    await waitFor(() => expect(screen.getByTestId('recovered')).toBeInTheDocument());
  });
});
