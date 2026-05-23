import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SchoolWalkPanel } from '@/components/realestate/SchoolWalkPanel';

const SCHOOLS = {
  districtName: 'Austin ISD',
  averageRating: 7.3,
  schools: [
    { kind: 'elementary', name: 'Maple Elem', rating: 9, distance: 0.4 },
    { kind: 'middle', name: 'Oak Middle', rating: 6, distance: 1.2 },
    { kind: 'high', name: 'Pine High', rating: 4, distance: 2.5 },
  ],
};
const WALK = { walkScore: 82, walkDesc: "Walker's paradise", transitScore: 55, transitDesc: 'Good transit', bikeScore: 30, bikeDesc: 'Somewhat bikeable' };
const COMMUTE = { minutes: 24, distanceMi: 11, mode: 'drive', rushHourMinutes: 38 };

function route(impl: (action: string) => unknown) {
  lensRun.mockImplementation((spec: { action: string }) => Promise.resolve(impl(spec.action)));
}

describe('SchoolWalkPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('shows the prompt before any address is entered', () => {
    render(<SchoolWalkPanel />);
    expect(screen.getByText('Enter an address to see schools, walk score & commute.')).toBeInTheDocument();
  });

  it('does not fetch with an empty address', () => {
    render(<SchoolWalkPanel />);
    const btn = screen.getByRole('button', { name: /Fetch/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('fetches schools and walk scores and renders tiles', async () => {
    route((action) => {
      if (action === 'school-ratings') return { data: { ok: true, result: SCHOOLS } };
      if (action === 'walk-score') return { data: { ok: true, result: WALK } };
      return { data: { ok: true, result: {} } };
    });
    render(<SchoolWalkPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Address/), { target: { value: '1 Main St' } });
    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }));
    expect(await screen.findByText('Austin ISD')).toBeInTheDocument();
    expect(screen.getByText('Maple Elem')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText("Walker's paradise")).toBeInTheDocument();
    expect(screen.queryByText(/Commute ·/)).not.toBeInTheDocument();
  });

  it('also fetches commute when a destination is provided', async () => {
    route((action) => {
      if (action === 'school-ratings') return { data: { ok: true, result: SCHOOLS } };
      if (action === 'walk-score') return { data: { ok: true, result: WALK } };
      if (action === 'commute-estimate') return { data: { ok: true, result: COMMUTE } };
      return { data: { ok: true, result: {} } };
    });
    render(<SchoolWalkPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Address/), { target: { value: '1 Main St' } });
    fireEvent.change(screen.getByPlaceholderText('Commute to (optional)'), { target: { value: 'Downtown' } });
    fireEvent.change(screen.getByDisplayValue('Drive'), { target: { value: 'transit' } });
    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }));
    expect(await screen.findByText('Commute · drive')).toBeInTheDocument();
    expect(screen.getByText('24m')).toBeInTheDocument();
    expect(screen.getByText('38m')).toBeInTheDocument();
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'commute-estimate', input: expect.objectContaining({ mode: 'transit' }) }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<SchoolWalkPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Address/), { target: { value: '1 Main St' } });
    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }));
    await waitFor(() => {
      expect(screen.getByText('Enter an address to see schools, walk score & commute.')).toBeInTheDocument();
    });
  });
});
