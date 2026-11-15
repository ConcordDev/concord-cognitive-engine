/**
 * FIX-accounting-012 — the accounting dashboard's KPI strip rounded money to
 * whole dollars and compacted cash to $M, so small changes were invisible.
 * Pin: $ values are cents-accurate at every magnitude; other units keep the
 * compact shape.
 */
import { describe, it, expect } from 'vitest';
import { formatKpiValue } from '@/components/accounting/KPIStrip';

describe('FIX-accounting-012 — KPI money formatting', () => {
  it('renders cents at small magnitudes', () => {
    expect(formatKpiValue(12.49, '$')).toBe('$12.49');
    expect(formatKpiValue(0.5, '$')).toBe('$0.50');
  });
  it('never compacts cash into $M', () => {
    expect(formatKpiValue(1234567.89, '$')).toBe('$1,234,567.89');
    expect(formatKpiValue(1200000, '$')).toBe('$1,200,000.00');
  });
  it('keeps the compact shape for non-money units', () => {
    expect(formatKpiValue(1200000)).toBe('1.2M');
    expect(formatKpiValue(12.5, '%')).toBe('12.5%');
  });
});
