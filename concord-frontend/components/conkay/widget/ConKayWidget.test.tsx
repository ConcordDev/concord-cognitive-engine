/**
 * ConKayWidget — the ambient character shell (CK1) and its new CK4
 * pendingCount badge. No test file existed for CK1/CK2 before this one;
 * covers both the pre-existing honesty contract (state is a pure prop,
 * never self-assigned) and the additive pendingCount prop.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ConKayWidget } from './ConKayWidget';

describe('ConKayWidget — state is a pure prop', () => {
  it('defaults to idle with no badges/rings from the other states', () => {
    render(<ConKayWidget />);
    const btn = screen.getByRole('button', { name: /ConKay/i });
    expect(btn).toHaveAttribute('data-conkay-widget-state', 'idle');
    expect(screen.getByText(/Idle and ready/i)).toBeInTheDocument();
  });

  it('renders exactly what state says, nothing more — listening', () => {
    render(<ConKayWidget state="listening" />);
    expect(screen.getByText(/Listening to you right now/i)).toBeInTheDocument();
  });

  it('activates on click and on Enter/Space when focused', () => {
    const onActivate = vi.fn();
    render(<ConKayWidget onActivate={onActivate} />);
    const btn = screen.getByRole('button', { name: /ConKay/i });

    fireEvent.click(btn);
    expect(onActivate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(btn, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it('renders no dismiss control when onDismiss is omitted', () => {
    render(<ConKayWidget />);
    expect(screen.queryByRole('button', { name: /Hide ConKay widget/i })).not.toBeInTheDocument();
  });

  it('calls onDismiss without also triggering onActivate', () => {
    const onActivate = vi.fn();
    const onDismiss = vi.fn();
    render(<ConKayWidget onActivate={onActivate} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /Hide ConKay widget/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe('ConKayWidget — CK4 pendingCount badge (real-data-only)', () => {
  it('renders no badge when pendingCount is omitted, zero, or undefined', () => {
    const { rerender } = render(<ConKayWidget />);
    expect(screen.queryByText(/waiting from Concord/i)).not.toBeInTheDocument();

    rerender(<ConKayWidget pendingCount={0} />);
    expect(screen.queryByText(/waiting from Concord/i)).not.toBeInTheDocument();
  });

  it('renders the exact real count when positive', () => {
    render(<ConKayWidget pendingCount={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/3 real updates waiting from Concord/i)).toBeInTheDocument();
  });

  it('uses correct singular/plural sr-only phrasing at exactly 1', () => {
    render(<ConKayWidget pendingCount={1} />);
    expect(screen.getByText(/1 real update waiting from Concord/i)).toBeInTheDocument();
  });

  it('caps the visible badge text at "9+" without lying about the real count in the sr-only text', () => {
    render(<ConKayWidget pendingCount={14} />);
    expect(screen.getByText('9+')).toBeInTheDocument();
    // The accessible description still states the true number — the visible
    // badge is a space-constrained display cap, not a data cap.
    expect(screen.getByText(/14 real updates waiting from Concord/i)).toBeInTheDocument();
  });

  it('never claims "speaking" — the badge is additive, not a fake TTS state', () => {
    render(<ConKayWidget state="idle" pendingCount={2} />);
    const btn = screen.getByRole('button', { name: /ConKay/i });
    expect(btn).toHaveAttribute('data-conkay-widget-state', 'idle');
    expect(screen.queryByText(/Speaking a real response/i)).not.toBeInTheDocument();
  });

  it('exposes the pending count on a data attribute for non-visual consumers (e.g. e2e)', () => {
    render(<ConKayWidget pendingCount={5} />);
    const btn = screen.getByRole('button', { name: /ConKay/i });
    expect(btn).toHaveAttribute('data-conkay-pending-count', '5');
  });
});
