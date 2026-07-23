import { describe, it, expect } from 'vitest';
import { computePeriodRange, deltaPct } from '@/components/accounting/period-range';

describe('computePeriodRange', () => {
  it('mtd: current month start through today, prior = same-length prior month', () => {
    const r = computePeriodRange('mtd', new Date('2026-07-23T00:00:00Z'));
    expect(r.start).toBe('2026-07-01');
    expect(r.end).toBe('2026-07-23');
    expect(r.priorStart).toBe('2026-06-01');
    expect(r.priorEnd).toBe('2026-06-23');
    expect(r.label).toBe('This month');
  });

  it('ytd: this year vs the same calendar day last year', () => {
    const r = computePeriodRange('ytd', new Date('2026-07-23T00:00:00Z'));
    expect(r.start).toBe('2026-01-01');
    expect(r.end).toBe('2026-07-23');
    expect(r.priorStart).toBe('2025-01-01');
    expect(r.priorEnd).toBe('2025-07-23');
  });

  it('last_month: the full previous calendar month vs the one before it', () => {
    const r = computePeriodRange('last_month', new Date('2026-07-23T00:00:00Z'));
    expect(r.start).toBe('2026-06-01');
    expect(r.end).toBe('2026-06-30');
    expect(r.priorStart).toBe('2026-05-01');
    expect(r.priorEnd).toBe('2026-05-31');
  });

  it('qtd: this quarter through today vs the same-length prior quarter', () => {
    const r = computePeriodRange('qtd', new Date('2026-08-05T00:00:00Z'));
    expect(r.start).toBe('2026-07-01');
    expect(r.priorStart).toBe('2026-04-01');
  });
});

describe('deltaPct', () => {
  it('computes a real percentage change', () => {
    expect(deltaPct(150, 100)).toBeCloseTo(50, 5);
    expect(deltaPct(50, 100)).toBeCloseTo(-50, 5);
  });

  it('is honest about a zero baseline — no division-by-zero fabrication', () => {
    expect(deltaPct(0, 0)).toBe(0);
    expect(deltaPct(500, 0)).toBeUndefined();
  });

  it('is undefined when either input is not a finite number', () => {
    expect(deltaPct(NaN, 10)).toBeUndefined();
    expect(deltaPct(10, NaN)).toBeUndefined();
  });
});
