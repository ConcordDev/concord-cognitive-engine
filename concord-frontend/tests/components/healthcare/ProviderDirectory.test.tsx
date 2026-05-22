import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => React.createElement('button', { 'data-testid': 'save-dtu' }, 'Save DTU'),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t2, layout: _l, ...rest } = props;
      void _i; void _a; void _e; void _t2; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { ProviderDirectory } from '@/components/healthcare/ProviderDirectory';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const providerResult = {
  providers: [
    { id: 'np1', npi: '1234567890', name: 'Dr. Alice Lee', specialty: 'Family Medicine', credential: 'MD',
      practice: 'Main Clinic', city: 'Austin', state: 'TX', zip: '78701', phone: '512-555-1111',
      fax: '512-555-2222', gender: 'F', enumeratedAt: '2010-01-01' },
    { id: 'np2', npi: '0987654321', name: 'Bob Kim', specialty: 'Cardiology', credential: null,
      practice: null, city: null, state: null, zip: null, phone: null, fax: null, gender: 'M', enumeratedAt: null },
  ],
  count: 2, totalMatching: 12, source: 'cms-nppes',
  query: { taxonomy: 'Family Medicine' },
};

describe('ProviderDirectory', () => {
  beforeEach(() => { runDomain.mockReset(); });

  it('renders the initial empty hint and specialty chips', () => {
    wrap(<ProviderDirectory />);
    expect(screen.getByText(/Pick a specialty above/)).toBeInTheDocument();
    expect(screen.getByText('Family Medicine')).toBeInTheDocument();
    expect(screen.getByText('Cardiology')).toBeInTheDocument();
  });

  it('searches when the Search button is clicked and renders provider cards', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: providerResult } });
    wrap(<ProviderDirectory />);
    fireEvent.click(screen.getByRole('button', { name: /Search providers/ }));
    await waitFor(() => expect(screen.getByText('Dr. Alice Lee')).toBeInTheDocument());
    expect(screen.getByText('Bob Kim')).toBeInTheDocument();
    expect(screen.getByText(/2 of 12 shown/)).toBeInTheDocument();
  });

  it('searches when a specialty chip is clicked', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: providerResult } });
    wrap(<ProviderDirectory />);
    fireEvent.click(screen.getByText('Pediatrics'));
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
  });

  it('shows the no-results message when the API returns zero providers', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ...providerResult, providers: [], count: 0 } } });
    wrap(<ProviderDirectory />);
    fireEvent.click(screen.getByRole('button', { name: /Search providers/ }));
    await waitFor(() => expect(screen.getByText(/No providers match/)).toBeInTheDocument());
  });

  it('shows an error message when the API envelope is ok:false', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'registry down' } });
    wrap(<ProviderDirectory />);
    fireEvent.click(screen.getByRole('button', { name: /Search providers/ }));
    await waitFor(() => expect(screen.getByText('registry down')).toBeInTheDocument());
  });

  it('submits a custom specialty via the form', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: providerResult } });
    wrap(<ProviderDirectory />);
    const input = screen.getByPlaceholderText(/Other specialty/);
    fireEvent.change(input, { target: { value: 'Nephrology' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
  });

  it('does not submit an empty custom specialty', () => {
    wrap(<ProviderDirectory />);
    const input = screen.getByPlaceholderText(/Other specialty/);
    fireEvent.submit(input.closest('form')!);
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('toggles a provider save heart and shows a clear-filters button when filters are set', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: providerResult } });
    wrap(<ProviderDirectory />);
    fireEvent.change(screen.getByPlaceholderText('ZIP'), { target: { value: '78701' } });
    fireEvent.change(screen.getByPlaceholderText('State'), { target: { value: 'tx' } });
    expect(screen.getByRole('button', { name: /Clear filters/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Search providers/ }));
    await waitFor(() => screen.getByText('Dr. Alice Lee'));
    // One heart button per provider card; toggle the first.
    const saveBtns = screen.getAllByRole('button', { name: /Save provider/ });
    expect(saveBtns.length).toBe(2);
    fireEvent.click(saveBtns[0]);
    expect(screen.getByRole('button', { name: /Unsave provider/ })).toBeInTheDocument();
    // clear filters
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
    expect(screen.queryByRole('button', { name: /Clear filters/ })).not.toBeInTheDocument();
  });

  it('surfaces a thrown error from the mutation', async () => {
    runDomain.mockRejectedValue(new Error('network fail'));
    wrap(<ProviderDirectory />);
    fireEvent.click(screen.getByRole('button', { name: /Search providers/ }));
    await waitFor(() => expect(screen.getByText('network fail')).toBeInTheDocument());
  });
});
