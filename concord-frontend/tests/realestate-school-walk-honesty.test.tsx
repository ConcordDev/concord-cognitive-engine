// INC-63: SchoolWalkPanel must not paint fabricated school ratings, walk
// scores, or commute times. An unavailable provider result stays a
// not-connected state even if the payload also carries numbers or names.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let respond: (action: string) => unknown = () => ({ ok: true, result: { available: false, reason: 'unavailable' } });

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((spec: { domain: string; action: string; input: Record<string, unknown> }) => {
    calls.push({ action: spec.action, input: spec.input });
    return Promise.resolve({ data: respond(spec.action) });
  }),
}));

import { SchoolWalkPanel } from '@/components/realestate/SchoolWalkPanel';

describe('SchoolWalkPanel unavailable state', () => {
  beforeEach(() => {
    calls.length = 0;
    respond = () => ({ ok: true, result: { available: false, reason: 'unavailable' } });
  });

  it('shows not connected / unavailable and hides poisoned scores and school names', async () => {
    respond = (action) => {
      if (action === 'school-ratings') {
        return {
          ok: true,
          result: {
            available: false,
            reason: 'greatschools_not_configured',
            schools: [{ kind: 'elementary', name: 'St Elementary', rating: 3, distance: 0.4 }],
            averageRating: 4.3,
            districtName: 'St School District',
          },
        };
      }
      if (action === 'walk-score') {
        return {
          ok: true,
          result: {
            available: false,
            reason: 'walkscore_not_configured',
            walkScore: 29,
            walkDesc: "Walker's Paradise",
            transitScore: 40,
            bikeScore: 55,
          },
        };
      }
      return {
        ok: true,
        result: {
          available: false,
          reason: 'routing_not_configured',
          minutes: 50,
          rushHourMinutes: 70,
          distanceMi: 12,
        },
      };
    };

    render(<SchoolWalkPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Address/), { target: { value: '1 Main St, Albany, NY' } });
    fireEvent.change(screen.getByPlaceholderText(/Commute to/), { target: { value: 'Times Square, New York, NY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));

    await waitFor(() => {
      expect(screen.getAllByText('Not connected / unavailable').length).toBe(3);
    });
    expect(screen.getByText('greatschools_not_configured')).toBeTruthy();
    expect(screen.getByText('walkscore_not_configured')).toBeTruthy();
    expect(screen.getByText('routing_not_configured')).toBeTruthy();
    expect(screen.queryByText('St Elementary')).toBeNull();
    expect(screen.queryByText('St School District')).toBeNull();
    expect(screen.queryByText("Walker's Paradise")).toBeNull();
    expect(screen.queryByText('29')).toBeNull();
    expect(screen.queryByText('50m')).toBeNull();
    expect(screen.queryByText('70m')).toBeNull();
    expect(calls.map((c) => c.action)).toEqual(['school-ratings', 'walk-score', 'commute-estimate']);
  });
});
