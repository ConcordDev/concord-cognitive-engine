import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { RepresentativeFinder, type Rep } from '@/components/government/RepresentativeFinder';

function fillAndSubmit(address: string) {
  fireEvent.change(screen.getByPlaceholderText(/Address or ZIP/i), { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: /Find/i }));
}

describe('RepresentativeFinder', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('rejects submission with an empty address', () => {
    render(<RepresentativeFinder />);
    fireEvent.click(screen.getByRole('button', { name: /Find/i }));
    expect(screen.getByText(/Enter address or ZIP/i)).toBeInTheDocument();
    expect(lensRunMock).not.toHaveBeenCalled();
  });

  it('calls lensRun with the trimmed address and government domain', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { representatives: [] } } });
    render(<RepresentativeFinder />);
    fillAndSubmit('  123 Main St  ');
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith({
      domain: 'government', action: 'representatives-find', input: { address: '123 Main St' },
    }));
  });

  it('shows an honest "no representatives found" message on an empty result', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { representatives: [] } } });
    render(<RepresentativeFinder />);
    fillAndSubmit('00000');
    expect(await screen.findByText(/No representatives found/i)).toBeInTheDocument();
  });

  it('surfaces a thrown error message instead of a fabricated result', async () => {
    lensRunMock.mockRejectedValue(new Error('network down'));
    render(<RepresentativeFinder />);
    fillAndSubmit('00000');
    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });

  it('groups representatives by level and renders contact links', async () => {
    const reps: Rep[] = [
      { name: 'Alice Rep', party: 'D', office: 'U.S. Senate', level: 'federal', phone: '555-1111', email: 'alice@gov.example', website: 'https://alice.example', twitter: '@alicerep' },
      { name: 'Bob Local', party: 'R', office: 'City Council', level: 'local', district: '4' },
    ];
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { representatives: reps } } });
    render(<RepresentativeFinder />);
    fillAndSubmit('123 Main St');

    expect(await screen.findByText('Alice Rep')).toBeInTheDocument();
    expect(screen.getByText('Bob Local')).toBeInTheDocument();
    expect(screen.getByText('federal')).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText(/District 4/i)).toBeInTheDocument();

    const twitterLink = screen.getByRole('link', { name: /@alicerep/i });
    expect(twitterLink).toHaveAttribute('href', 'https://twitter.com/alicerep');
    expect(screen.getByRole('link', { name: /555-1111/i })).toHaveAttribute('href', 'tel:555-1111');
    expect(screen.getByRole('link', { name: /Email/i })).toHaveAttribute('href', 'mailto:alice@gov.example');
    expect(screen.getByRole('link', { name: /Site/i })).toHaveAttribute('href', 'https://alice.example');
  });

  it('shows a loading state while the lookup is in flight', async () => {
    let resolve!: (v: unknown) => void;
    lensRunMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<RepresentativeFinder />);
    fillAndSubmit('123 Main St');
    expect(screen.getByRole('button', { name: /Find/i })).toBeDisabled();
    resolve({ data: { ok: true, result: { representatives: [] } } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Find/i })).not.toBeDisabled());
  });
});
