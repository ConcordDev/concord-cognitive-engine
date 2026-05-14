/**
 * Concordia Phase 1 — NPCStressTooltip presentational tests.
 *
 * Pins:
 *   - bucket transitions at the 35/45/60/80 thresholds
 *   - glyph count matches bucket.intensity
 *   - coping trait line surfaced in default mode, hidden in compact
 *   - renders nothing when stress is null AND no coping trait
 *   - ARIA: role=tooltip + aria-label includes bucket + coping
 *   - data-stress-bucket attribute is set (for e2e selectors)
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { NPCStressTooltip } from '@/components/concordia/NPCStressTooltip';

function getTip(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="npc-stress-tooltip"]');
}

describe('NPCStressTooltip — bucket thresholds', () => {
  it('renders calm bucket for stress=30 (baseline)', () => {
    const { container } = render(<NPCStressTooltip stress={30} />);
    const tip = getTip(container)!;
    expect(tip.getAttribute('data-stress-bucket')).toBe('calm');
  });

  it('renders unsettled at stress=35', () => {
    const { container } = render(<NPCStressTooltip stress={35} />);
    expect(getTip(container)!.getAttribute('data-stress-bucket')).toBe('unsettled');
  });

  it('renders anxious at stress=45', () => {
    const { container } = render(<NPCStressTooltip stress={45} />);
    expect(getTip(container)!.getAttribute('data-stress-bucket')).toBe('anxious');
  });

  it('renders breaking at stress=60', () => {
    const { container } = render(<NPCStressTooltip stress={60} />);
    expect(getTip(container)!.getAttribute('data-stress-bucket')).toBe('breaking');
  });

  it('renders broken at stress=80', () => {
    const { container } = render(<NPCStressTooltip stress={80} />);
    expect(getTip(container)!.getAttribute('data-stress-bucket')).toBe('broken');
  });

  it('also broken at stress=100', () => {
    const { container } = render(<NPCStressTooltip stress={100} />);
    expect(getTip(container)!.getAttribute('data-stress-bucket')).toBe('broken');
  });
});

describe('NPCStressTooltip — glyph count', () => {
  it('renders 1 glyph for calm', () => {
    const { container } = render(<NPCStressTooltip stress={20} />);
    const glyphs = container.querySelectorAll('[aria-hidden="true"]');
    expect(glyphs.length).toBe(1);
  });

  it('renders 5 glyphs for broken', () => {
    const { container } = render(<NPCStressTooltip stress={90} />);
    const glyphs = container.querySelectorAll('[aria-hidden="true"]');
    expect(glyphs.length).toBe(5);
  });
});

describe('NPCStressTooltip — coping trait line', () => {
  it('surfaces drink coping line in default mode', () => {
    const { container } = render(<NPCStressTooltip stress={85} copingTrait="drink" />);
    expect(container.querySelector('[data-coping-line]')?.textContent).toMatch(/drinking/i);
  });

  it('omits coping line in compact mode', () => {
    const { container } = render(<NPCStressTooltip stress={85} copingTrait="drink" compact />);
    expect(container.querySelector('[data-coping-line]')).toBeNull();
  });

  it('renders all 5 coping traits without crashing', () => {
    for (const ct of ['drink', 'reckless', 'paranoid', 'withdraw', 'cruel'] as const) {
      const { container } = render(<NPCStressTooltip stress={85} copingTrait={ct} />);
      expect(container.querySelector('[data-coping-line]')).not.toBeNull();
    }
  });
});

describe('NPCStressTooltip — render guards', () => {
  it('renders nothing when stress is null and no coping trait', () => {
    const { container } = render(<NPCStressTooltip stress={null} />);
    expect(getTip(container)).toBeNull();
  });

  it('renders when stress is null but coping trait given', () => {
    const { container } = render(<NPCStressTooltip stress={null} copingTrait="cruel" />);
    expect(getTip(container)).not.toBeNull();
  });
});

describe('NPCStressTooltip — accessibility', () => {
  it('has role=tooltip', () => {
    const { container } = render(<NPCStressTooltip stress={50} />);
    expect(getTip(container)!.getAttribute('role')).toBe('tooltip');
  });

  it('aria-label includes bucket and coping trait', () => {
    const { container } = render(<NPCStressTooltip stress={85} copingTrait="paranoid" />);
    const label = getTip(container)!.getAttribute('aria-label') || '';
    expect(label).toMatch(/broken/);
    expect(label).toMatch(/paranoid/);
  });

  it('exposes data-npc-id for e2e selectors', () => {
    const { container } = render(<NPCStressTooltip stress={60} npcId="npc_hostile" />);
    expect(getTip(container)!.getAttribute('data-npc-id')).toBe('npc_hostile');
  });
});
