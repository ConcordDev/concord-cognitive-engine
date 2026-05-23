import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PermitsPanel } from '@/components/government/PermitsPanel';

const PERMITS = [
  { id: 'p1', recordNumber: 'PMT-1', kind: 'building', description: 'New deck', applicantName: 'Jane', applicantEmail: 'j@x.com', applicantPhone: '', siteAddress: '1 St', feeUsd: 100, paid: false, status: 'applied', inspectionIds: [], submittedAt: '2026-01-01' },
  { id: 'p2', recordNumber: 'PMT-2', kind: 'fence', description: '', applicantName: 'Bob', applicantEmail: 'b@x.com', applicantPhone: '', siteAddress: '2 St', feeUsd: 0, paid: true, status: 'under_review', inspectionIds: [], submittedAt: '2026-01-02' },
  { id: 'p3', recordNumber: 'PMT-3', kind: 'event', description: '', applicantName: 'Cara', applicantEmail: 'c@x.com', applicantPhone: '', siteAddress: '3 St', feeUsd: 0, paid: true, status: 'approved', inspectionIds: [], submittedAt: '2026-01-03' },
  { id: 'p4', recordNumber: 'PMT-4', kind: 'business_license', description: '', applicantName: 'Dan', applicantEmail: 'd@x.com', applicantPhone: '', siteAddress: '4 St', feeUsd: 0, paid: true, status: 'denied', inspectionIds: [], submittedAt: '2026-01-04', denialReason: 'incomplete' },
];

describe('PermitsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { permits: [] } } });
  });

  it('shows empty state', async () => {
    render(<PermitsPanel />);
    expect(await screen.findByText('No permits yet.')).toBeInTheDocument();
  });

  it('renders permits with all status branches and action buttons', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { permits: PERMITS } } });
    render(<PermitsPanel />);
    expect(await screen.findByText('PMT-1')).toBeInTheDocument();
    expect(screen.getByText('applied')).toBeInTheDocument();
    expect(screen.getByText('under review')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
    expect(screen.getByText('Pay fee')).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Issue')).toBeInTheDocument();
    expect(screen.getByText(/Denial reason: incomplete/)).toBeInTheDocument();
  });

  it('does not apply with missing applicant fields', async () => {
    render(<PermitsPanel />);
    await screen.findByText('No permits yet.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Apply for permit'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'permits-apply' }));
  });

  it('applies for a permit with valid inputs', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'permits-apply'
        ? Promise.resolve({ data: { ok: true } })
        : Promise.resolve({ data: { ok: true, result: { permits: [] } } }),
    );
    render(<PermitsPanel />);
    await screen.findByText('No permits yet.');
    fireEvent.change(screen.getByPlaceholderText('Applicant name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'j@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Fee $'), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Apply for permit'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'permits-apply', input: expect.objectContaining({ feeUsd: 250 }) }),
      ),
    );
  });

  it('approves a permit under review', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'permits-list'
        ? Promise.resolve({ data: { ok: true, result: { permits: PERMITS } } })
        : Promise.resolve({ data: { ok: true } }),
    );
    render(<PermitsPanel />);
    await screen.findByText('PMT-2');
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'permits-approve', input: { id: 'p2' } }),
      ),
    );
  });

  it('issues an approved permit with validForDays', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'permits-list'
        ? Promise.resolve({ data: { ok: true, result: { permits: PERMITS } } })
        : Promise.resolve({ data: { ok: true } }),
    );
    render(<PermitsPanel />);
    await screen.findByText('PMT-3');
    fireEvent.click(screen.getByText('Issue'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'permits-issue', input: { id: 'p3', validForDays: 365 } }),
      ),
    );
  });

  it('denies a permit with a prompt reason', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('missing docs');
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'permits-list'
        ? Promise.resolve({ data: { ok: true, result: { permits: PERMITS } } })
        : Promise.resolve({ data: { ok: true } }),
    );
    render(<PermitsPanel />);
    await screen.findByText('PMT-1');
    fireEvent.click(screen.getAllByText('Deny')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'permits-deny', input: { id: 'p1', reason: 'missing docs' } }),
      ),
    );
    promptSpy.mockRestore();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<PermitsPanel />);
    expect(await screen.findByText('No permits yet.')).toBeInTheDocument();
  });
});
