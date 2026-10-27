/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TelecommunicationsActionPanel } from './TelecommunicationsActionPanel';

const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({
    status: 'idle', label: '', token: null, remainingMs: 0, windowMs: 0, error: null,
    run: async (op: () => Promise<string | null>) => op(),
    recall: async () => {},
    dismiss: () => {},
  }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: unknown) => input,
}));

function envelope(result: Record<string, unknown>) {
  return { data: { ok: true, result: { ok: true, result } } };
}

describe('TelecommunicationsActionPanel coverage nulls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a tower with no range as an em dash plus the reason', async () => {
    runDomainMock.mockResolvedValue(envelope({
      towers: 1,
      activeTowers: 1,
      totalCoverageKm2: null,
      technologies: ['4G'],
      coverageReason: 'range_not_recorded',
    }));
    render(<TelecommunicationsActionPanel />);
    const area = document.querySelector('textarea');
    expect(area).toBeTruthy();
    fireEvent.change(area as HTMLTextAreaElement, { target: { value: '[{"name":"A"}]' } });
    fireEvent.click(screen.getByRole('button', { name: /^Coverage/i }));
    await waitFor(() => expect(screen.getByText(/Not recorded: range_not_recorded/)).toBeInTheDocument());
    expect(screen.getAllByText(/—/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\bnull\b/);
    expect(screen.getByText(/1\/1 active · — km² \(range_not_recorded\)/)).toBeInTheDocument();
  });

  it('shows the empty-tower message instead of mapping a missing technology list', async () => {
    runDomainMock.mockResolvedValue({
      data: { ok: true, result: { message: 'Add tower locations to map coverage.' } },
    });
    render(<TelecommunicationsActionPanel />);
    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '[]' } });
    fireEvent.click(screen.getByRole('button', { name: /^Coverage/i }));
    await waitFor(() => expect(screen.getAllByText('Add tower locations to map coverage.').length).toBeGreaterThan(0));
    expect(screen.queryByText(/km²/)).toBeNull();
  });

  it('keeps a measured coverage area', async () => {
    runDomainMock.mockResolvedValue(envelope({
      towers: 1,
      activeTowers: 1,
      totalCoverageKm2: 79,
      technologies: ['5G'],
    }));
    render(<TelecommunicationsActionPanel />);
    const area = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '[{"name":"A","rangeKm":5}]' } });
    fireEvent.click(screen.getByRole('button', { name: /^Coverage/i }));
    await waitFor(() => expect(screen.getByText('79')).toBeInTheDocument());
    expect(screen.getByText(/1\/1 active · 79 km²/)).toBeInTheDocument();
  });
});
