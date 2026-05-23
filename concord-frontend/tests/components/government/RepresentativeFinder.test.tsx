import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RepresentativeFinder } from '@/components/government/RepresentativeFinder';

const REPS = [
  { name: 'Alice Dem', party: 'D', office: 'Senator', level: 'federal', phone: '555-1', email: 'a@x.com', website: 'https://a', twitter: '@alice', photoUrl: 'https://p/a.jpg' },
  { name: 'Bob Rep', party: 'R', office: 'Governor', level: 'state', district: '4' },
  { name: 'Carl Ind', party: 'I', office: 'Mayor', level: 'local' },
];

describe('RepresentativeFinder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { representatives: [] } } });
  });

  it('shows an error when address is blank', () => {
    render(<RepresentativeFinder />);
    fireEvent.submit(screen.getByPlaceholderText('Address or ZIP').closest('form')!);
    expect(screen.getByText('Enter address or ZIP')).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('shows not-found error when zero reps returned', async () => {
    render(<RepresentativeFinder />);
    fireEvent.change(screen.getByPlaceholderText('Address or ZIP'), { target: { value: '90210' } });
    fireEvent.submit(screen.getByPlaceholderText('Address or ZIP').closest('form')!);
    expect(await screen.findByText('No representatives found for that address.')).toBeInTheDocument();
  });

  it('renders reps grouped by level with party badges, photo, and links', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { representatives: REPS } } });
    render(<RepresentativeFinder />);
    fireEvent.change(screen.getByPlaceholderText('Address or ZIP'), { target: { value: '1 Main St' } });
    fireEvent.submit(screen.getByPlaceholderText('Address or ZIP').closest('form')!);
    expect(await screen.findByText('Alice Dem')).toBeInTheDocument();
    expect(screen.getByText('Bob Rep')).toBeInTheDocument();
    expect(screen.getByText('Carl Ind')).toBeInTheDocument();
    expect(screen.getByText('federal')).toBeInTheDocument();
    expect(screen.getByText('state')).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
    // photo path for Alice, initial fallback for others
    expect(screen.getByAltText('Alice Dem')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    // district suffix
    expect(screen.getByText(/District 4/)).toBeInTheDocument();
    // contact links
    expect(screen.getByText('@alice')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('lookup boom'));
    render(<RepresentativeFinder />);
    fireEvent.change(screen.getByPlaceholderText('Address or ZIP'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByPlaceholderText('Address or ZIP').closest('form')!);
    expect(await screen.findByText('lookup boom')).toBeInTheDocument();
  });
});
