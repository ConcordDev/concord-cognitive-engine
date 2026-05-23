import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// the panel dynamically imports ServiceRequestsMap — stub it out
vi.mock('next/dynamic', () => ({
  default: () => () => <div data-testid="sr-map" />,
}));

import { ServiceRequestsPanel } from '@/components/government/ServiceRequestsPanel';

const REQUESTS = [
  { id: 'r1', referenceNumber: 'SR-1', category: 'pothole', description: 'big hole', lat: 40, lng: -73, address: '1 St', reporterName: 'A', reporterEmail: 'a@x.com', assignedDepartmentId: null, status: 'submitted', priority: 'urgent', createdAt: '2026-01-01' },
  { id: 'r2', referenceNumber: 'SR-2', category: 'graffiti', description: 'tag', lat: 41, lng: -74, address: '', reporterName: 'B', reporterEmail: 'b@x.com', assignedDepartmentId: 'd1', assignedDepartmentName: 'DPW', status: 'closed_resolved', priority: 'low', createdAt: '2026-01-02' },
];
const DEPTS = [{ id: 'd1', name: 'DPW' }];

function mockBoth(requests: unknown[], depts: unknown[]) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'service-requests-list') return Promise.resolve({ data: { ok: true, result: { requests } } });
    if (spec.action === 'departments-list') return Promise.resolve({ data: { ok: true, result: { departments: depts } } });
    return Promise.resolve({ data: { ok: true } });
  });
}

describe('ServiceRequestsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBoth([], []);
  });

  it('shows empty state', async () => {
    render(<ServiceRequestsPanel />);
    expect(await screen.findByText('No requests in this view.')).toBeInTheDocument();
  });

  it('renders requests with priority badges and address fallback', async () => {
    mockBoth(REQUESTS, DEPTS);
    render(<ServiceRequestsPanel />);
    expect(await screen.findByText('SR-1')).toBeInTheDocument();
    expect(screen.getByText('urgent')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();
    // r2 has empty address -> coordinates shown
    expect(screen.getByText('41.000,-74.000')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    mockBoth(REQUESTS, DEPTS);
    render(<ServiceRequestsPanel />);
    await screen.findByText('SR-1');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'submitted' } });
    expect(screen.getByText('SR-1')).toBeInTheDocument();
    expect(screen.queryByText('SR-2')).not.toBeInTheDocument();
  });

  it('does not create with missing description or coords', async () => {
    render(<ServiceRequestsPanel />);
    await screen.findByText('No requests in this view.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('File service request'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'service-requests-create' }));
  });

  it('creates a service request with valid inputs', async () => {
    mockBoth([], []);
    render(<ServiceRequestsPanel />);
    await screen.findByText('No requests in this view.');
    fireEvent.change(screen.getByPlaceholderText('Lat'), { target: { value: '40.5' } });
    fireEvent.change(screen.getByPlaceholderText('Lng'), { target: { value: '-73.5' } });
    fireEvent.change(screen.getByPlaceholderText('Issue description'), { target: { value: 'broken light' } });
    fireEvent.click(screen.getByText('File service request'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'service-requests-create', input: expect.objectContaining({ lat: 40.5, lng: -73.5 }) }),
      ),
    );
  });

  it('assigns a department to a request', async () => {
    mockBoth(REQUESTS, DEPTS);
    render(<ServiceRequestsPanel />);
    await screen.findByText('SR-1');
    lensRun.mockClear();
    mockBoth(REQUESTS, DEPTS);
    // first per-row select is the department assign select
    const rowSelects = document.querySelectorAll('li select');
    fireEvent.change(rowSelects[0], { target: { value: 'd1' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'service-requests-assign', input: { id: 'r1', departmentId: 'd1' } }),
      ),
    );
  });

  it('updates a request status', async () => {
    mockBoth(REQUESTS, DEPTS);
    render(<ServiceRequestsPanel />);
    await screen.findByText('SR-1');
    lensRun.mockClear();
    mockBoth(REQUESTS, DEPTS);
    const rowSelects = document.querySelectorAll('li select');
    fireEvent.change(rowSelects[1], { target: { value: 'in_progress' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'service-requests-update-status', input: { id: 'r1', status: 'in_progress' } }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ServiceRequestsPanel />);
    expect(await screen.findByText('No requests in this view.')).toBeInTheDocument();
  });
});
