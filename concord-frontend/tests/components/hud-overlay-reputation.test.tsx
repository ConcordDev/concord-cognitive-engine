/**
 * HUDOverlay's "Profession + Reputation" sub-block used to render
 * unconditionally with a hardcoded `reputationLevel={1}` at its one call
 * site (components/world/WorldOsSurface.tsx) — a plausible-looking fake "Lv.1" shown
 * regardless of the real player's state, since no World Lens page fetches
 * a real per-player reputation signal today. Both props are now optional;
 * the block hides entirely when reputationLevel is omitted rather than
 * fabricate a value.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import HUDOverlay from '@/components/world-lens/HUDOverlay';

function baseProps() {
  return {
    mode: 'explore' as const,
    district: 'Test District',
    timeOfDay: 'Midday',
    weather: 'clear' as const,
    playerCount: 1,
    currency: { concordCoin: 500, pendingRoyalties: 0 },
    notifications: [],
    unreadCount: 0,
    tools: [],
    onToolSelect: () => {},
    onMenuOpen: () => {},
  };
}

describe('HUDOverlay — Profession + Reputation honesty', () => {
  it('hides the reputation block entirely when reputationLevel is not supplied', () => {
    render(<HUDOverlay {...baseProps()} />);
    expect(screen.queryByText(/Lv\./)).not.toBeInTheDocument();
  });

  it('shows a real reputation level when one is actually supplied', () => {
    render(<HUDOverlay {...baseProps()} reputationLevel={7} />);
    expect(screen.getByText('Lv.7')).toBeInTheDocument();
  });

  it('shows the profession badge only alongside a real reputation level, never alone', () => {
    render(<HUDOverlay {...baseProps()} professionBadge="Blacksmith" />);
    expect(screen.queryByText('Blacksmith')).not.toBeInTheDocument();

    render(<HUDOverlay {...baseProps()} professionBadge="Blacksmith" reputationLevel={3} />);
    expect(screen.getByText('Blacksmith')).toBeInTheDocument();
    expect(screen.getByText('Lv.3')).toBeInTheDocument();
  });

  it('still renders the real currency balance passed in', () => {
    render(<HUDOverlay {...baseProps()} currency={{ concordCoin: 4200, pendingRoyalties: 0 }} />);
    expect(screen.getByText('4,200')).toBeInTheDocument();
  });
});
