/**
 * Tier-2 frontend test for ConcordantLawBadge.
 *
 * Pins:
 *   - Renders only when worldId is the hub
 *   - Hidden in combat / dialogue / vehicle / photo modes
 *   - Hidden in non-hub worlds
 *   - Concordia alias 'concordia' also surfaces the badge
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';
import { ConcordantLawBadge } from '@/components/world/concordia-hud/ConcordantLawBadge';

beforeEach(() => {
  useHUDContext.setState({ worldId: 'concordia-hub', inputMode: 'exploration' });
});

describe('ConcordantLawBadge', () => {
  it('renders in concordia-hub during exploration', () => {
    const { container } = render(<ConcordantLawBadge />);
    expect(container.querySelector('[data-testid="hud-concordant-law-badge"]')).not.toBeNull();
  });

  it('also renders for legacy concordia alias', () => {
    useHUDContext.setState({ worldId: 'concordia', inputMode: 'exploration' });
    const { container } = render(<ConcordantLawBadge />);
    expect(container.querySelector('[data-testid="hud-concordant-law-badge"]')).not.toBeNull();
  });

  it('does NOT render in tunya', () => {
    useHUDContext.setState({ worldId: 'tunya', inputMode: 'exploration' });
    const { container } = render(<ConcordantLawBadge />);
    expect(container.querySelector('[data-testid="hud-concordant-law-badge"]')).toBeNull();
  });

  it('hides in combat mode even at hub', () => {
    useHUDContext.setState({ worldId: 'concordia-hub', inputMode: 'combat' });
    const { container } = render(<ConcordantLawBadge />);
    expect(container.querySelector('[data-testid="hud-concordant-law-badge"]')).toBeNull();
  });

  it('hides in dialogue mode', () => {
    useHUDContext.setState({ worldId: 'concordia-hub', inputMode: 'dialogue' });
    const { container } = render(<ConcordantLawBadge />);
    expect(container.querySelector('[data-testid="hud-concordant-law-badge"]')).toBeNull();
  });

  it('hides in vehicle mode', () => {
    useHUDContext.setState({ worldId: 'concordia-hub', inputMode: 'vehicle' });
    const { container } = render(<ConcordantLawBadge />);
    expect(container.querySelector('[data-testid="hud-concordant-law-badge"]')).toBeNull();
  });

  it('hides in photo mode', () => {
    useHUDContext.setState({ worldId: 'concordia-hub', inputMode: 'photo' });
    const { container } = render(<ConcordantLawBadge />);
    expect(container.querySelector('[data-testid="hud-concordant-law-badge"]')).toBeNull();
  });
});
