// Null-figure genus — platform formatting layer pins.
//
// The genus (Lead ruling, Energy §8 Q2): an absent value reaches the
// render unguarded and stringifies literally — "NaNB CC Earned"
// (Profile, via formatNumber), "$null" (Energy, raw interpolation),
// "null%" (Household), "1991 HONDA null" (Automotive). The fix is at
// the formatting layer: formatNumber / formatFigure / joinParts in
// lib/utils.ts render an absence as an em dash (or a caller-supplied
// contextual fallback) and never as a figure; present values render
// byte-identically to before.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { formatNumber, formatRelativeTime, formatFigure, joinParts } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { EnergyBillingPanel } from '@/components/energy/EnergyBillingPanel';
import { ChoreBoard } from '@/components/household/ChoreBoard';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(),
  apiHelpers: {},
}));

// The ui barrel is outside this suite's scope; ErrorState renders only
// on a load failure, which the unset-state legs never trigger.
vi.mock('@/components/ui', () => ({
  ErrorState: (props: { message?: string }) => React.createElement('div', null, props.message ?? ''),
}));

const mockLensRun = vi.mocked(lensRun);

describe('formatNumber — the shared abbreviator', () => {
  it('renders an absence as an em dash, never "NaNB"', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(Infinity)).toBe('—');
  });
  it('present values are byte-identical across the range, boundaries included', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(999999)).toBe('1000.0K');
    expect(formatNumber(1000000)).toBe('1.0M');
    expect(formatNumber(1000000000)).toBe('1.0B');
    expect(formatNumber(-5)).toBe('-5');
    expect(formatNumber(-1500)).toBe('-1500');
  });
});

describe('formatRelativeTime — the same hole, date form', () => {
  it('an unparseable date renders the absence, never "NaNy ago"', () => {
    expect(formatRelativeTime('not-a-date')).toBe('—');
    expect(formatRelativeTime(Date.now())).toBe('just now');
  });
});

describe('formatFigure — currency/percent composition', () => {
  it('an absence renders the fallback alone — prefix and suffix never wrap it', () => {
    expect(formatFigure(null, { prefix: '$' })).toBe('—');
    expect(formatFigure(undefined, { prefix: '$', suffix: '/kWh' })).toBe('—');
    expect(formatFigure(null, { suffix: '%' })).toBe('—');
    expect(formatFigure(null, { prefix: '$', fallback: 'set yours below' })).toBe('set yours below');
  });
  it('present values render exactly as the raw interpolation did', () => {
    expect(formatFigure(42.5, { prefix: '$' })).toBe('$42.5');
    expect(formatFigure(0, { suffix: '%' })).toBe('0%');
    expect(formatFigure(0.154, { prefix: '$', suffix: '/kWh' })).toBe('$0.154/kWh');
    expect(formatFigure(3.14159, { digits: 2 })).toBe('3.14');
  });
});

describe('joinParts — composed names drop absent parts', () => {
  it('an absent model never prints "null"', () => {
    expect(joinParts([1991, 'HONDA', null])).toBe('1991 HONDA');
    expect(joinParts([1991, 'HONDA', 'Civic'])).toBe('1991 HONDA Civic');
    expect(joinParts([null, undefined, ''])).toBe('');
    expect(joinParts(['a', '  ', 'b'])).toBe('a b');
  });
});

describe('exhibit renders — the unset states', () => {
  beforeEach(() => {
    mockLensRun.mockReset();
  });

  it('Energy billing with no rate set renders dashes, never "$null" / "$undefined"', async () => {
    mockLensRun.mockImplementation(async (domain: string, action: string) => {
      if (action === 'rate-get') return { data: { ok: true, result: { rate: null } } } as never;
      if (action === 'bill-estimate') return { data: { ok: true, result: { estimatedBill: null, netKwh: null, consumedKwh: null, solarKwh: null, ratePerKwh: null, solarSavings: 0 } } } as never;
      return { data: { ok: true, result: {} } } as never;
    });
    const { container } = render(<EnergyBillingPanel onChange={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain('This month'));
    expect(container.textContent).toContain('Current:');
    expect(container.textContent).not.toContain('null');
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('NaN');
  });

  it('Household board at zero chores renders a dash for Clean, never "null%"', async () => {
    mockLensRun.mockImplementation(async (domain: string, action: string) => {
      if (action === 'household-dashboard') {
        return { data: { ok: true, result: { rooms: 0, tasks: 0, cleanlinessPct: null, needsAttention: 0, paused: false } } } as never;
      }
      if (action === 'room-list') return { data: { ok: true, result: { rooms: [] } } } as never;
      if (action === 'chore-board') return { data: { ok: true, result: { board: [] } } } as never;
      if (action === 'assignee-leaderboard') return { data: { ok: true, result: { leaderboard: [] } } } as never;
      return { data: { ok: true, result: {} } } as never;
    });
    const { container } = render(<ChoreBoard />);
    await waitFor(() => expect(container.textContent).toContain('Clean'));
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('null%');
    expect(container.textContent).not.toContain('null');
  });
});
