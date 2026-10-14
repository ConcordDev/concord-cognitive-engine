// Pins Intervention ROI planner rank label: server roi 1.5 must render as
// "ROI 1.5%", not toFixed(0) "ROI 2%". Track description uses the same helper.
import { describe, it, expect } from 'vitest';
import { formatRoiPct } from '@/components/suffering/InterventionPlanner';

describe('formatRoiPct', () => {
  it('keeps one decimal when the server returns 1.5', () => {
    expect(formatRoiPct(1.5)).toBe('1.5');
  });

  it('does not round 1.5 up to 2', () => {
    expect(formatRoiPct(1.5)).not.toBe('2');
  });

  it('keeps integers compact', () => {
    expect(formatRoiPct(2)).toBe('2');
  });

  it('rank label and tracked description both show 1.5%', () => {
    const label = `ROI ${formatRoiPct(1.5)}%`;
    expect(label).toBe('ROI 1.5%');
    const tracked = `From ROI planner — priority 0.913, ROI ${formatRoiPct(1.5)}%, cost-benefit 0.025, coverage 100%.`;
    expect(tracked).toContain('ROI 1.5%');
    expect(tracked).not.toContain('ROI 2%');
  });
});
