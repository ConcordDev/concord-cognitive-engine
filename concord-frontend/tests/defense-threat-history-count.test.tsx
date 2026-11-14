/**
 * FIX-defense-004 — the ThreatBoard severity-change count.
 *
 * The ticket: one Escalate click moved severity once but the card read
 * "2 escalation events". The server seeds history with an "added" event
 * and records exactly one entry per escalate; the board counted EVERY
 * history entry (creation + status changes included) and labelled them
 * all "escalation events". The board now counts only severity changes
 * (escalated / deescalated / severity:<set>) and labels them as such.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('lucide-react', () => {
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return {
    Plus: make('Plus'), Loader2: make('Loader2'), AlertTriangle: make('AlertTriangle'),
    ChevronUp: make('ChevronUp'), ChevronDown: make('ChevronDown'), ShieldAlert: make('ShieldAlert'),
    Pencil: make('Pencil'), Trash2: make('Trash2'),
  };
});

import { ThreatBoard, severityChanges } from '@/components/defense/ThreatBoard';

const H = (event: string, severity = 'low') => ({ at: '2026-11-09T00:00:00Z', event, severity });
const THREATS = [
  { id: 't1', name: 'Fresh Threat', category: 'cyber', severity: 'low', status: 'watching', region: 'EU', note: '', history: [H('added')] },
  { id: 't2', name: 'Escalated Once', category: 'cyber', severity: 'high', status: 'watching', region: 'EU', note: '', history: [H('added'), H('escalated', 'high')] },
  { id: 't3', name: 'Moved Twice', category: 'cyber', severity: 'medium', status: 'engaged', region: 'EU', note: '', history: [H('added'), H('escalated', 'high'), H('deescalated', 'medium'), H('status:engaged', 'medium')] },
];

describe('FIX-defense-004 — severityChanges helper', () => {
  it('counts only severity changes, never the creation or status events', () => {
    expect(severityChanges(THREATS[0].history)).toHaveLength(0);
    expect(severityChanges(THREATS[1].history)).toHaveLength(1);
    expect(severityChanges(THREATS[2].history)).toHaveLength(2);
    expect(severityChanges([H('added'), H('severity:critical', 'critical')])).toHaveLength(1);
  });
});

describe('FIX-defense-004 — ThreatBoard rendering', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'threat-board') {
        return { data: { ok: true, result: { threats: THREATS, total: 3, bySeverity: {}, byStatus: {}, highestSeverity: 'high', activeWatch: 3 } } };
      }
      return { data: { ok: true, result: null } };
    });
  });

  it('one Escalate reads as 1 severity change; a fresh threat shows no count line', async () => {
    render(<ThreatBoard />);
    expect(await screen.findByText(/1 severity change · latest: escalated → high/)).toBeTruthy();
    expect(screen.getByText(/2 severity changes · latest: deescalated → medium/)).toBeTruthy();
    // The old mislabel is gone entirely.
    expect(screen.queryByText(/escalation events/)).toBeNull();
  });
});
