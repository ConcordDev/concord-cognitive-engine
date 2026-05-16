import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const addToast = vi.fn();
const create = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
    dtus: { create: (...args: unknown[]) => create(...args) },
  },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
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

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const MOCK_PROVIDER = {
  id: 'npi_1234567890',
  npi: '1234567890',
  name: 'Dr. Jane Smith',
  specialty: 'Family Medicine',
  credential: 'MD',
  practice: '123 Main Street',
  city: 'Boston',
  state: 'MA',
  zip: '02108',
  phone: '617-555-0123',
  fax: null,
  gender: 'F',
  enumeratedAt: '2010-03-15',
};

describe('ProviderDirectory', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
  });

  it('renders popular specialty chips + idle state', () => {
    renderWithQuery(<ProviderDirectory />);
    expect(screen.getByText('Family Medicine')).toBeInTheDocument();
    expect(screen.getByText('Pediatrics')).toBeInTheDocument();
    expect(screen.getByText('OB-GYN')).toBeInTheDocument();
    expect(screen.getByText('Cardiology')).toBeInTheDocument();
    expect(screen.getByText(/Pick a specialty above/i)).toBeInTheDocument();
  });

  it('clicks a specialty chip → posts providers-search with NUCC taxonomy', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      providers: [MOCK_PROVIDER], count: 1, totalMatching: 1,
      source: 'NPI registry (CMS NPPES)', query: { taxonomy: 'Allergy & Immunology', limit: 20 },
    } } } });
    renderWithQuery(<ProviderDirectory />);
    fireEvent.click(screen.getByText('Allergy & Immunology'));
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const call = runDomain.mock.calls[0];
    expect(call[0]).toBe('healthcare');
    expect(call[1]).toBe('providers-search');
    // NUCC taxonomy string passed (not the human label "Allergy & Immunology" rendered on chip)
    expect((call[2] as { input?: { specialty?: string } })?.input?.specialty).toBe('Allergy & Immunology');
  });

  it('passes ZIP / state / city filters when set', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      providers: [], count: 0, totalMatching: 0, source: 'NPI registry (CMS NPPES)', query: {},
    } } } });
    renderWithQuery(<ProviderDirectory />);
    fireEvent.change(screen.getByPlaceholderText('ZIP'), { target: { value: '02108' } });
    fireEvent.change(screen.getByPlaceholderText('State'), { target: { value: 'ma' } });
    fireEvent.change(screen.getByPlaceholderText(/City/), { target: { value: 'Boston' } });
    fireEvent.click(screen.getByRole('button', { name: /Search providers/i }));
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const input = (runDomain.mock.calls[0][2] as { input?: Record<string, unknown> }).input;
    expect(input?.zipCode).toBe('02108');
    expect(input?.state).toBe('MA');   // uppercased
    expect(input?.city).toBe('Boston');
  });

  it('renders provider cards with name, specialty, credential, location, NPI footer', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      providers: [MOCK_PROVIDER], count: 1, totalMatching: 47,
      source: 'NPI registry (CMS NPPES)', query: {},
    } } } });
    renderWithQuery(<ProviderDirectory />);
    fireEvent.click(screen.getByText('Family Medicine'));
    await waitFor(() => expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument());
    expect(screen.getByText('MD')).toBeInTheDocument();
    // "Family Medicine" appears in both the chip + the card; just assert >1 match
    expect(screen.getAllByText('Family Medicine').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Boston, MA, 02108/)).toBeInTheDocument();
    expect(screen.getByText('123 Main Street')).toBeInTheDocument();
    // NPI verified footer is present but the literal NPI is in a tooltip, not body text
    expect(screen.getByText(/Verified provider/i)).toBeInTheDocument();
    // 1 of 47 count in header
    expect(screen.getByText(/1 of 47 shown/)).toBeInTheDocument();
  });

  it('toggles Heart save icon per-card', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      providers: [MOCK_PROVIDER], count: 1, totalMatching: 1, source: 'NPI registry (CMS NPPES)', query: {},
    } } } });
    renderWithQuery(<ProviderDirectory />);
    fireEvent.click(screen.getByText('Family Medicine'));
    await waitFor(() => expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument());
    const heart = screen.getByLabelText('Save provider');
    fireEvent.click(heart);
    // After save, the aria-label flips to Unsave
    expect(screen.getByLabelText('Unsave provider')).toBeInTheDocument();
  });

  it('renders empty-state with retry hint when 0 results', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      providers: [], count: 0, totalMatching: 0, source: 'NPI registry (CMS NPPES)', query: {},
    } } } });
    renderWithQuery(<ProviderDirectory />);
    fireEvent.click(screen.getByText('Pediatrics'));
    await waitFor(() => expect(screen.getByText(/No providers match/i)).toBeInTheDocument());
  });

  it('surfaces error from macro', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'NPI registry 503' } } });
    renderWithQuery(<ProviderDirectory />);
    fireEvent.click(screen.getByText('Cardiology'));
    await waitFor(() => expect(screen.getByText(/NPI registry 503/i)).toBeInTheDocument());
  });
});
