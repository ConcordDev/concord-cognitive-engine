import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ProjectTracker } from '@/components/urban-planning/ProjectTracker';

const PARCELS = [
  { id: 'parcel_1', apn: 'APN-100', address: '100 Main St' },
  { id: 'parcel_2', apn: 'APN-200', address: '200 Oak Ave' },
];

const PROJECTS = [
  {
    id: 'proj_1', name: 'Riverside Tower', description: 'Mixed-use build',
    parcelId: 'parcel_1', parcelApn: 'APN-100', parcelAddress: '100 Main St',
    projectType: 'mixed_use', budget: 5_000_000, permitNumber: 'BP-1',
    targetCompletionDate: '2028-01-01', status: 'approved',
    statusHistory: [
      { status: 'proposed', at: '2026-01-01T00:00:00.000Z', note: null },
      { status: 'approved', at: '2026-02-01T00:00:00.000Z', note: 'Planning commission approved' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'proj_2', name: 'Unlinked Park', description: '',
    parcelId: null, parcelApn: null, parcelAddress: null,
    projectType: 'public_space', budget: 0, permitNumber: '',
    targetCompletionDate: '', status: 'built',
    statusHistory: [
      { status: 'proposed', at: '2025-01-01T00:00:00.000Z', note: null },
      { status: 'built', at: '2025-06-01T00:00:00.000Z', note: null },
    ],
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-06-01T00:00:00.000Z',
  },
];

function mockDefaultResponses() {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain === 'urban-planning' && action === 'project-list') {
      return Promise.resolve({
        data: {
          ok: true,
          result: { projects: PROJECTS, count: PROJECTS.length, byStatus: { approved: 1, built: 1 }, totalBudget: 5_000_000 },
          error: null,
        },
      });
    }
    if (domain === 'urban-planning' && action === 'parcel-list') {
      return Promise.resolve({ data: { ok: true, result: { parcels: PARCELS }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: null, error: null } });
  });
}

describe('ProjectTracker', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('loads real projects and parcels on mount', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    expect(lensRunMock).toHaveBeenCalledWith('urban-planning', 'project-list', {});
    expect(lensRunMock).toHaveBeenCalledWith('urban-planning', 'parcel-list', {});
    expect(screen.getByText('Riverside Tower')).toBeInTheDocument();
    expect(screen.getByText('Unlinked Park')).toBeInTheDocument();
  });

  it('the parcel picker is a real select sourced from parcel-list, not free text', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    const select = screen.getByLabelText('Linked parcel') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels.some((l) => l?.includes('APN-100'))).toBe(true);
    expect(optionLabels.some((l) => l?.includes('APN-200'))).toBe(true);
    expect(optionLabels).toContain('No parcel link (optional)');
  });

  it('renders status badges with distinct labels for each lifecycle stage present', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Built').length).toBeGreaterThan(0);
  });

  it('renders the linked-parcel display for a linked project and omits it for an unlinked one', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    expect(screen.getByText(/Parcel: APN-100/)).toBeInTheDocument();
    // "Unlinked Park" has no parcelId, so no "Parcel:" text should reference it specifically —
    // only the one linked project's parcel line should exist.
    expect(screen.getAllByText(/^Parcel: /).length).toBe(1);
  });

  it('create flow: submitting calls project-add with the entered fields (with a parcel link)', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'New Transit Hub' } });
    fireEvent.change(screen.getByLabelText('Project type'), { target: { value: 'transit' } });
    fireEvent.change(screen.getByLabelText('Linked parcel'), { target: { value: 'parcel_2' } });
    fireEvent.change(screen.getByPlaceholderText('Budget ($, optional)'), { target: { value: '750000' } });

    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { project: { id: 'proj_new' } }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByText('Add Project'));
    });

    expect(lensRunMock).toHaveBeenCalledWith('urban-planning', 'project-add', expect.objectContaining({
      name: 'New Transit Hub', projectType: 'transit', parcelId: 'parcel_2', budget: 750000,
    }));
  });

  it('create flow: submitting without a parcel selection omits a fabricated parcel link', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'No Parcel Project' } });
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { project: { id: 'proj_new2' } }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByText('Add Project'));
    });
    expect(lensRunMock).toHaveBeenCalledWith('urban-planning', 'project-add', expect.objectContaining({
      name: 'No Parcel Project', parcelId: undefined,
    }));
  });

  it('a required-field rejection (empty name) surfaces an inline error without calling the backend', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Add Project'));
    });
    expect(screen.getByText('project name is required')).toBeInTheDocument();
    expect(lensRunMock).not.toHaveBeenCalledWith('urban-planning', 'project-add', expect.anything());
  });

  it('a hard-rejected backend call (e.g. unrecognized status) surfaces an inline error', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'unrecognized status: (none)' } });
    const approvedCard = screen.getByText('Riverside Tower').closest('div.rounded-lg') as HTMLElement;
    const advance = within(approvedCard).getByText('Under Construction');
    await act(async () => {
      fireEvent.click(advance);
    });
    expect(screen.getByText('unrecognized status: (none)')).toBeInTheDocument();
  });

  it('the status-transition control is a designed button group of legal next stages, not a raw select', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    const approvedCard = screen.getByText('Riverside Tower').closest('div.rounded-lg') as HTMLElement;
    // approved -> [under_construction, cancelled]
    expect(within(approvedCard).getByText('Under Construction')).toBeInTheDocument();
    expect(within(approvedCard).getByText('Cancelled')).toBeInTheDocument();
    // Terminal statuses like "built" or "denied" are not offered from "approved".
    expect(within(approvedCard).queryByText('Built')).not.toBeInTheDocument();
  });

  it('a terminal-status project (built) shows no further Advance transitions', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    const builtCard = screen.getByText('Unlinked Park').closest('div.rounded-lg') as HTMLElement;
    expect(within(builtCard).queryByText('Advance:')).not.toBeInTheDocument();
  });

  it('status-transition flow: clicking a next-stage button calls project-status-update and refreshes', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    const approvedCard = screen.getByText('Riverside Tower').closest('div.rounded-lg') as HTMLElement;
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { project: { ...PROJECTS[0], status: 'under_construction' } }, error: null },
    });
    await act(async () => {
      fireEvent.click(within(approvedCard).getByText('Under Construction'));
    });
    expect(lensRunMock).toHaveBeenCalledWith('urban-planning', 'project-status-update', { id: 'proj_1', status: 'under_construction' });
    // Refresh re-fetches the list.
    expect(lensRunMock.mock.calls.filter((c) => c[0] === 'urban-planning' && c[1] === 'project-list').length).toBeGreaterThan(1);
  });

  it('status history is hidden by default and expands to show the audit trail on click', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    const approvedCard = screen.getByText('Riverside Tower').closest('div.rounded-lg') as HTMLElement;
    expect(within(approvedCard).queryByText('Planning commission approved')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(approvedCard).getByText(/Show status history/));
    });
    expect(within(approvedCard).getByText(/Planning commission approved/)).toBeInTheDocument();
  });

  it('delete flow: clicking delete calls project-remove and refreshes the list', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { removed: 1 }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete project Riverside Tower'));
    });
    expect(lensRunMock).toHaveBeenCalledWith('urban-planning', 'project-remove', { id: 'proj_1' });
  });

  it('renders the aggregate byStatus/totalBudget stats bar from real list data', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProjectTracker />);
    });
    const summary = screen.getByText(/2 projects/);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toContain('$5,000,000');
    expect(screen.getByText('1 Approved')).toBeInTheDocument();
    expect(screen.getByText('1 Built')).toBeInTheDocument();
  });

  it('empty state renders a named honest message when there are no tracked projects', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'urban-planning' && action === 'project-list') {
        return Promise.resolve({ data: { ok: true, result: { projects: [], count: 0, byStatus: {}, totalBudget: 0 }, error: null } });
      }
      if (domain === 'urban-planning' && action === 'parcel-list') {
        return Promise.resolve({ data: { ok: true, result: { parcels: [] }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: null, error: null } });
    });
    await act(async () => {
      render(<ProjectTracker />);
    });
    expect(screen.getByText(/No projects tracked yet/)).toBeInTheDocument();
  });
});
