/**
 * Concordia Phase 2 — BloodlineBadge presentational tests.
 *
 * Pins:
 *   - Renders no-ancestry placeholder when bloodline null
 *   - Renders meta glyph for each of the 10 bloodlines
 *   - dilution-bucket attribute set at 0.30 / 0.60 / 0.90 thresholds
 *   - ARIA label includes bloodline id + bucket
 *   - compact mode hides short label + dilution suffix
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BloodlineBadge } from '@/components/concordia/BloodlineBadge';

function tip(c: HTMLElement): HTMLElement | null {
  return c.querySelector('[data-testid="bloodline-badge"]');
}

describe('BloodlineBadge — no-ancestry placeholder', () => {
  it('renders neutral placeholder when bloodline is null', () => {
    const { container } = render(<BloodlineBadge bloodline={null} dilution={null} />);
    expect(tip(container)?.getAttribute('data-bloodline')).toBe('none');
  });

  it('placeholder has ARIA tooltip', () => {
    const { container } = render(<BloodlineBadge bloodline={null} dilution={null} />);
    expect(tip(container)?.getAttribute('role')).toBe('tooltip');
    expect(tip(container)?.getAttribute('aria-label')).toMatch(/No bloodline/);
  });
});

describe('BloodlineBadge — known bloodlines render meta', () => {
  const ids = ['sanguire', 'medici', 'sahm', 'iron_warden', 'akeia', 'kree', 'asbir', 'dinye', 'aekon', 'fluxom'];
  for (const id of ids) {
    it(`renders ${id}`, () => {
      const { container } = render(<BloodlineBadge bloodline={id} dilution={0.1} />);
      expect(tip(container)?.getAttribute('data-bloodline')).toBe(id);
    });
  }
});

describe('BloodlineBadge — dilution buckets', () => {
  it('pure at dilution=0.10', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.10} />);
    expect(tip(container)?.getAttribute('data-dilution-bucket')).toBe('pure');
  });

  it('mild at dilution=0.45', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.45} />);
    expect(tip(container)?.getAttribute('data-dilution-bucket')).toBe('mild');
  });

  it('heavy at dilution=0.75', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.75} />);
    expect(tip(container)?.getAttribute('data-dilution-bucket')).toBe('heavy');
  });

  it('faded at dilution=0.95', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.95} />);
    expect(tip(container)?.getAttribute('data-dilution-bucket')).toBe('faded');
  });

  it('boundary: 0.30 → mild', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.30} />);
    expect(tip(container)?.getAttribute('data-dilution-bucket')).toBe('mild');
  });

  it('boundary: 0.60 → heavy', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.60} />);
    expect(tip(container)?.getAttribute('data-dilution-bucket')).toBe('heavy');
  });

  it('boundary: 0.90 → faded', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.90} />);
    expect(tip(container)?.getAttribute('data-dilution-bucket')).toBe('faded');
  });
});

describe('BloodlineBadge — ARIA accessibility', () => {
  it('aria-label includes bloodline + dilution descriptor', () => {
    const { container } = render(<BloodlineBadge bloodline="medici" dilution={0.7} />);
    const label = tip(container)?.getAttribute('aria-label') || '';
    expect(label).toMatch(/medici/);
    expect(label).toMatch(/heavily diluted/);
  });

  it('role=tooltip on badge', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.1} />);
    expect(tip(container)?.getAttribute('role')).toBe('tooltip');
  });
});

describe('BloodlineBadge — compact mode', () => {
  it('omits short label in compact mode', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.1} compact />);
    // Short label "SANG" not rendered in compact.
    expect(container.textContent).not.toMatch(/SANG/);
  });

  it('includes short label in default mode', () => {
    const { container } = render(<BloodlineBadge bloodline="sanguire" dilution={0.1} />);
    expect(container.textContent).toMatch(/SANG/);
  });
});
