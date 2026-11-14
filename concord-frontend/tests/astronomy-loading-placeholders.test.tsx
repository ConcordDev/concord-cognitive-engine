/**
 * FIX-astronomy-007 — the astronomy Live Data tab's panels rendered blank
 * bodies during their initial load (the loading state existed but nothing
 * rendered for it). Pin: each panel shows a labelled loading placeholder
 * while its first fetch is in flight.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => new Promise(() => {})) }, // fetch never settles
}));

import { SpaceflightNewsPanel } from '@/components/space/SpaceflightNewsPanel';
import { UpcomingLaunchesPanel } from '@/components/space/UpcomingLaunchesPanel';

describe('FIX-astronomy-007 — loading placeholders', () => {
  it('news panel shows its labelled skeleton while loading', () => {
    render(<SpaceflightNewsPanel domain="astronomy" />);
    expect(screen.getByRole('status', { name: /Loading spaceflight news/ })).toBeTruthy();
    expect(screen.getByText('Loading spaceflight news…')).toBeTruthy();
  });
  it('launches panel shows its labelled skeleton while loading', () => {
    render(<UpcomingLaunchesPanel domain="astronomy" />);
    expect(screen.getByRole('status', { name: /Loading upcoming launches/ })).toBeTruthy();
    expect(screen.getByText('Loading upcoming launches…')).toBeTruthy();
  });
});
