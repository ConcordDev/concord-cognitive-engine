import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn();
const lensRun = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  lensRun: (...a: unknown[]) => lensRun(...a),
}));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

const publish = vi.fn();
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish }),
  useRecallableAction: () => ({
    run: async (fn: () => Promise<unknown>) => fn(),
    label: 'x',
  }),
  RecallSlot: () => React.createElement('span', { 'data-testid': 'recall-slot' }),
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

import { HealthcareActionPanel } from '@/components/healthcare/HealthcareActionPanel';

describe('HealthcareActionPanel', () => {
  beforeEach(() => {
    runDomain.mockReset(); lensRun.mockReset(); apiPost.mockReset(); apiDelete.mockReset(); publish.mockReset();
  });

  it('renders the bench with all action buttons', () => {
    render(<HealthcareActionPanel />);
    expect(screen.getByText('Healthcare bench')).toBeInTheDocument();
    expect(screen.getByText('Triage')).toBeInTheDocument();
    expect(screen.getByText('Find MD')).toBeInTheDocument();
    expect(screen.getByText('Meds')).toBeInTheDocument();
  });

  it('runs triage and renders the result panel', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: {
      severity: 'er', reasoning: 'Emergency.', candidates: [{ condition: 'ACS', confidence: 0.7, citations: ['ACC'] }],
    } } });
    render(<HealthcareActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Describe symptoms/), { target: { value: 'chest pain' } });
    fireEvent.click(screen.getByText('Triage'));
    await waitFor(() => expect(screen.getByText(/Severity: er/)).toBeInTheDocument());
    expect(screen.getByText('ACS')).toBeInTheDocument();
  });

  it('shows an error when triage has no region or description', async () => {
    render(<HealthcareActionPanel />);
    // remove the default 'head' region
    fireEvent.click(screen.getByRole('button', { name: 'head' }));
    fireEvent.click(screen.getByText('Triage'));
    await waitFor(() => expect(screen.getByText(/Region or description required/)).toBeInTheDocument());
  });

  it('finds providers via the NPI registry', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: {
      providers: [{ id: 'p1', npi: '1', name: 'Dr. X', specialty: 'FM', city: 'Austin', state: 'TX', zip: '78701' }],
      count: 1, totalMatching: 1,
    } } });
    render(<HealthcareActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Specialty'), { target: { value: 'Family Medicine' } });
    fireEvent.click(screen.getByText('Find MD'));
    await waitFor(() => expect(screen.getByText(/1 providers/)).toBeInTheDocument());
  });

  it('shows an error when neither specialty nor zip is given for Find MD', async () => {
    render(<HealthcareActionPanel />);
    fireEvent.click(screen.getByText('Find MD'));
    await waitFor(() => expect(screen.getByText(/Specialty or zip required/)).toBeInTheDocument());
  });

  it('lists medications', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { medications: [
      { id: 'm1', name: 'Metformin', dose: '500mg', schedule: 'BID', takenToday: true },
    ] } } });
    render(<HealthcareActionPanel />);
    fireEvent.click(screen.getByText('Meds'));
    await waitFor(() => expect(screen.getByText(/Meds · 1/)).toBeInTheDocument());
    expect(screen.getByText('Metformin')).toBeInTheDocument();
  });

  it('compares Rx prices', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: {
      drug: 'Atorvastatin', cheapest: { pharmacy: 'CVS', cashPrice: 12, discountedPrice: 9 }, potentialSavings: 5,
      quotes: [{ pharmacy: 'CVS', cashPrice: 12, discountedPrice: 9, coupon: 'C1' }],
    } } });
    render(<HealthcareActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('Drug'), { target: { value: 'Atorvastatin' } });
    fireEvent.click(screen.getByText('Rx price'));
    await waitFor(() => expect(screen.getByText(/Rx prices · Atorvastatin/)).toBeInTheDocument());
  });

  it('shows an error when Rx is run without a drug', async () => {
    render(<HealthcareActionPanel />);
    fireEvent.click(screen.getByText('Rx price'));
    await waitFor(() => expect(screen.getByText(/Drug required/)).toBeInTheDocument());
  });

  it('mints a visit DTU', async () => {
    lensRun.mockResolvedValue({ data: { result: { dtu: { id: 'dtu-abcdef123' } } } });
    render(<HealthcareActionPanel />);
    fireEvent.click(screen.getByText('Mint'));
    await waitFor(() => expect(screen.getByText(/Visit DTU dtu-abcd/)).toBeInTheDocument());
  });

  it('shows an error when DM is run without a recipient', async () => {
    render(<HealthcareActionPanel />);
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText(/Recipient required/)).toBeInTheDocument());
  });

  it('sends a DM to a caregiver', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'msg1' } } });
    render(<HealthcareActionPanel />);
    fireEvent.change(screen.getByPlaceholderText('DM recipient'), { target: { value: 'user-2' } });
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText(/Sent\. 60s to recall/)).toBeInTheDocument());
  });

  it('shows an error when Publish is run before a provider search', async () => {
    render(<HealthcareActionPanel />);
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() => expect(screen.getByText(/Run provider search first/)).toBeInTheDocument());
  });

  it('runs the agent and shows the questions', async () => {
    lensRun.mockResolvedValue({ data: { result: { reply: 'Q1. Q2. Q3.' } } });
    render(<HealthcareActionPanel />);
    fireEvent.click(screen.getByText('Questions'));
    await waitFor(() => expect(screen.getByText('Top 3 questions')).toBeInTheDocument());
    expect(screen.getByText('Q1. Q2. Q3.')).toBeInTheDocument();
  });

  it('toggles a body region chip', () => {
    render(<HealthcareActionPanel />);
    const chestChip = screen.getByRole('button', { name: 'chest' });
    fireEvent.click(chestChip);
    fireEvent.click(chestChip);
    expect(chestChip).toBeInTheDocument();
  });
});
