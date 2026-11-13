import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LiveIndicator, BADGE_SETTLE_MS } from './LiveIndicator';

// FIX-social-010 (badge leg): the compact LIVE badge sits last in lens
// header clusters; in a shrink-0 cluster inside an overflow-clipped page
// its right edge was the first thing cut at 390px. The badge itself now
// refuses to shrink or wrap, and header clusters let it wrap whole.
describe('LiveIndicator compact badge (FIX-social-010)', () => {
  it('renders LIVE uncompressed and on one line', () => {
    render(<LiveIndicator isLive lastUpdated={new Date().toISOString()} compact />);
    const badge = screen.getByText('LIVE');
    expect(badge.className).toContain('shrink-0');
    expect(badge.className).toContain('whitespace-nowrap');
  });

  it('still settles to OFF when never live (after the settle window)', () => {
    vi.useFakeTimers();
    try {
      render(<LiveIndicator isLive={false} lastUpdated={null} compact />);
      expect(screen.getByText('CONNECTING')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(BADGE_SETTLE_MS + 50); });
      expect(screen.getByText('OFF')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
