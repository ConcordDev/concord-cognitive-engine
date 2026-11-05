// F1 (Review 2 first pass, cross-check #77 repricing): the 990 Explorer
// crashed the lens render on its own search because ProPublica returns each
// org's EIN as an integer and the surface called ein.replace(...) in
// render. The Explorer now normalizes the EIN to a string at its boundary.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let respond: () => unknown = () => ({ ok: true, result: { orgs: [] } });

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: {
      runDomain: vi.fn(() => Promise.resolve({ data: respond() })),
    },
  },
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { PropublicaSearch } from '@/components/nonprofit/PropublicaSearch';

function renderExplorer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PropublicaSearch />
    </QueryClientProvider>,
  );
}

describe('nonprofit 990 Explorer (F1)', () => {
  beforeEach(() => { respond = () => ({ ok: true, result: { orgs: [] } }); });

  it('renders results whose EIN arrives as a number, without throwing', async () => {
    // ProPublica's real shape: ein is an integer, strein is the string.
    respond = () => ({
      ok: true,
      result: {
        orgs: [
          { ein: 530196605, name: 'American Red Cross', city: 'Washington', state: 'DC', nteeCode: 'P20', score: 12.5, rulingYear: 1938 },
        ],
        totalResults: 1,
      },
    });
    renderExplorer();
    fireEvent.change(screen.getByPlaceholderText(/Organization name/), { target: { value: 'Red Cross' } });
    fireEvent.click(screen.getByRole('button', { name: /Search 990s/ }));
    await waitFor(() => expect(screen.getByText('American Red Cross')).toBeTruthy());
    expect(screen.getByText(/EIN 530196605/)).toBeTruthy();
    // The ProPublica link is built from the digit string without throwing.
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toContain('/organizations/530196605');
  });

  it('renders a string EIN identically', async () => {
    respond = () => ({
      ok: true,
      result: { orgs: [{ ein: '13-1644147', name: 'Museum of Modern Art', city: 'New York', state: 'NY' }] },
    });
    renderExplorer();
    fireEvent.change(screen.getByPlaceholderText(/Organization name/), { target: { value: 'MoMA' } });
    fireEvent.click(screen.getByRole('button', { name: /Search 990s/ }));
    await waitFor(() => expect(screen.getByText('Museum of Modern Art')).toBeTruthy());
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toContain('/organizations/131644147');
  });
});
