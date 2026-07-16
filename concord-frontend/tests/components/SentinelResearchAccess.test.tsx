/**
 * SentinelResearchAccess — pins the frontend workflow closing the
 * "intel.research.* governance-controlled research-access workflow
 * completely unsurfaced" gap (docs/WAVE4_INVENTORY.md line 303 /
 * docs/lens-specs/sentinel-capability-map.md). Exercises apply -> track ->
 * status -> (once approved) data/synthesis/archive pulls, plus the
 * role-gated governance review affordance, against the real
 * intel.research.* macro response shapes (server/server.js registrations).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

const useAuthMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

import { SentinelResearchAccess } from '@/components/sentinel/SentinelResearchAccess';

const envelope = (result: unknown) => ({ data: { ok: true, result, error: null } });
const errEnvelope = (error: string) => ({ data: { ok: false, result: null, error } });

const CATEGORIES = ['cross_medium_synthesis', 'historical_archaeology', 'deep_geological'];

const PENDING_APP = {
  id: 'app_pending1',
  researcherId: 'me',
  institution: 'Test Institute',
  purpose: 'studying signals',
  requestedCategories: ['cross_medium_synthesis'],
  status: 'pending',
  submitted: '2026-07-01T00:00:00Z',
  reviewed: null,
  reviewedBy: null,
  decision: null,
};

const APPROVED_APP = {
  ...PENDING_APP,
  id: 'app_approved1',
  status: 'approved',
  reviewed: '2026-07-02T00:00:00Z',
  reviewedBy: 'gov_1',
  decision: 'granted',
};

function setupLensRun(opts: {
  statusById?: Record<string, unknown>;
  applyResult?: { ok: boolean; applicationId?: string; error?: string };
  dataOk?: boolean;
  reviewResult?: { ok: boolean; status?: string; error?: string };
} = {}) {
  const { statusById = {}, applyResult, dataOk = true, reviewResult } = opts;
  lensRun.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
    if (domain === 'intel' && action === 'classifier.status') {
      return Promise.resolve(envelope({ researchCategories: CATEGORIES }));
    }
    if (domain === 'intel' && action === 'research.status') {
      const id = input.applicationId as string;
      const found = statusById[id];
      if (found) return Promise.resolve(envelope({ application: found }));
      return Promise.resolve(errEnvelope('application_not_found'));
    }
    if (domain === 'intel' && action === 'research.apply') {
      if (applyResult && applyResult.ok === false) {
        return Promise.resolve(errEnvelope(applyResult.error || 'application failed'));
      }
      return Promise.resolve(envelope({ applicationId: applyResult?.applicationId || 'app_new1', status: 'pending' }));
    }
    if (domain === 'intel' && (action === 'research.data' || action === 'research.synthesis' || action === 'research.archive')) {
      if (!dataOk) return Promise.resolve(errEnvelope('access_denied'));
      return Promise.resolve(envelope({ tier: 'RESEARCH', category: 'all', count: 1, researcherId: 'me', data: [{ id: 'x' }] }));
    }
    if (domain === 'intel' && action === 'research.review') {
      if (reviewResult && reviewResult.ok === false) {
        return Promise.resolve(errEnvelope(reviewResult.error || 'review failed'));
      }
      return Promise.resolve(envelope({ applicationId: input.applicationId, status: reviewResult?.status || 'approved' }));
    }
    return Promise.resolve(envelope({}));
  });
}

// research.status reads are keyed off what's in localStorage, so each test
// controls "my applications" by seeding localStorage directly, mirroring
// how the component itself persists applicationIds after a successful apply.
function seedTracked(ids: string[]) {
  window.localStorage.setItem('concord:sentinel:researchApplicationIds', JSON.stringify(ids));
}

describe('SentinelResearchAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useAuthMock.mockReturnValue({ user: { id: 'u1', role: 'member' }, isAuthenticated: true, isLoading: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches research categories from intel.classifier.status and renders them (never hardcoded)', async () => {
    setupLensRun();
    render(<SentinelResearchAccess />);
    await waitFor(() => {
      expect(screen.getByText('cross medium synthesis')).toBeDefined();
    });
    expect(screen.getByText('historical archaeology')).toBeDefined();
    expect(lensRun).toHaveBeenCalledWith('intel', 'classifier.status', {});
  });

  it('shows the empty state when no applications are tracked', async () => {
    setupLensRun();
    render(<SentinelResearchAccess />);
    await waitFor(() => {
      expect(screen.getByText(/No applications tracked in this browser yet/)).toBeDefined();
    });
  });

  it('submit is disabled until both institution and purpose are filled', async () => {
    setupLensRun();
    render(<SentinelResearchAccess />);
    await waitFor(() => expect(screen.getByLabelText('Institution')).toBeDefined());

    const submitBtn = screen.getByText('Submit application').closest('button')!;
    expect(submitBtn).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Institution'), { target: { value: 'Test Institute' } });
    expect(submitBtn).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'studying signals' } });
    expect(submitBtn).toHaveProperty('disabled', false);
  });

  it('submitting an application calls research.apply, tracks the new id, and shows it Pending', async () => {
    const onChanged = vi.fn();
    setupLensRun({
      applyResult: { ok: true, applicationId: 'app_new1' },
      statusById: { app_new1: PENDING_APP },
    });
    render(<SentinelResearchAccess onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByLabelText('Institution')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Institution'), { target: { value: 'Test Institute' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'studying signals' } });
    await waitFor(() => expect(screen.getByText('cross medium synthesis')).toBeDefined());
    fireEvent.click(screen.getByText('cross medium synthesis'));

    fireEvent.click(screen.getByText('Submit application').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('intel', 'research.apply', {
        institution: 'Test Institute',
        purpose: 'studying signals',
        categories: ['cross_medium_synthesis'],
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeDefined();
    });
    expect(screen.getByText('app_new1')).toBeDefined();
    expect(onChanged).toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem('concord:sentinel:researchApplicationIds') || '[]')).toContain('app_new1');
  });

  it('shows an honest error when research.apply fails, without tracking a fake id', async () => {
    setupLensRun({ applyResult: { ok: false, error: 'submission rejected' } });
    render(<SentinelResearchAccess />);
    await waitFor(() => expect(screen.getByLabelText('Institution')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Institution'), { target: { value: 'Test Institute' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'studying signals' } });
    fireEvent.click(screen.getByText('Submit application').closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('submission rejected')).toBeDefined();
    });
    expect(window.localStorage.getItem('concord:sentinel:researchApplicationIds')).toBeNull();
  });

  it('tracking an application by id re-verifies it live against research.status', async () => {
    setupLensRun({ statusById: { app_approved1: APPROVED_APP } });
    render(<SentinelResearchAccess />);
    await waitFor(() => expect(screen.getByLabelText('Application ID to track')).toBeDefined());

    fireEvent.change(screen.getByLabelText('Application ID to track'), { target: { value: 'app_approved1' } });
    fireEvent.click(screen.getByText('Track').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('intel', 'research.status', { applicationId: 'app_approved1' });
    });
    await waitFor(() => {
      expect(screen.getByText('Approved')).toBeDefined();
    });
  });

  it('a not-found / not-mine tracked id renders its real server error and can be removed', async () => {
    seedTracked(['app_not_mine']);
    setupLensRun({ statusById: {} });
    render(<SentinelResearchAccess />);

    await waitFor(() => {
      expect(screen.getByText('application_not_found')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => {
      expect(screen.queryByText('app_not_mine')).toBeNull();
    });
    expect(JSON.parse(window.localStorage.getItem('concord:sentinel:researchApplicationIds') || '[]')).not.toContain('app_not_mine');
  });

  it('no data-access buttons render until an application is approved', async () => {
    seedTracked(['app_pending1']);
    setupLensRun({ statusById: { app_pending1: PENDING_APP } });
    render(<SentinelResearchAccess />);

    await waitFor(() => {
      expect(screen.getByText(/No approved application yet/)).toBeDefined();
    });
    expect(screen.queryByText('Fetch Data')).toBeNull();
  });

  it('once approved, Fetch Data/Synthesis/Archive pull real Tier-2 data and render it', async () => {
    seedTracked(['app_approved1']);
    setupLensRun({ statusById: { app_approved1: APPROVED_APP }, dataOk: true });
    render(<SentinelResearchAccess />);

    await waitFor(() => {
      expect(screen.getByText('Fetch Data')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Fetch Data').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('intel', 'research.data', {});
    });
    await waitFor(() => {
      expect(screen.getByText(/"researcherId": "me"/)).toBeDefined();
    });
  });

  it('an honest access_denied still renders (never fabricates approved-looking data)', async () => {
    seedTracked(['app_approved1']);
    setupLensRun({ statusById: { app_approved1: APPROVED_APP }, dataOk: false });
    render(<SentinelResearchAccess />);

    await waitFor(() => expect(screen.getByText('Fetch Data')).toBeDefined());
    fireEvent.click(screen.getByText('Fetch Data').closest('button')!);

    await waitFor(() => {
      expect(screen.getByText(/"error": "access_denied"/)).toBeDefined();
    });
  });

  it('governance review section is hidden for a plain member', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1', role: 'member' }, isAuthenticated: true, isLoading: false });
    setupLensRun();
    render(<SentinelResearchAccess />);
    await waitFor(() => expect(screen.getByLabelText('Institution')).toBeDefined());
    expect(screen.queryByText('Governance review')).toBeNull();
  });

  it('governance review section renders for owner/admin/founder and approves by id', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'gov1', role: 'owner' }, isAuthenticated: true, isLoading: false });
    setupLensRun({ reviewResult: { ok: true, status: 'approved' } });
    render(<SentinelResearchAccess />);

    await waitFor(() => {
      expect(screen.getByText('Governance review')).toBeDefined();
    });
    fireEvent.change(screen.getByLabelText('Application ID to review'), { target: { value: 'app_pending1' } });
    fireEvent.click(screen.getByText('Approve').closest('button')!);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('intel', 'research.review', {
        applicationId: 'app_pending1', approved: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('app_pending1: approved')).toBeDefined();
    });
  });

  it('governance review shows an honest error when the server rejects the review (e.g. already reviewed)', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'gov1', role: 'admin' }, isAuthenticated: true, isLoading: false });
    setupLensRun({ reviewResult: { ok: false, error: 'already_reviewed' } });
    render(<SentinelResearchAccess />);

    await waitFor(() => expect(screen.getByLabelText('Application ID to review')).toBeDefined());
    fireEvent.change(screen.getByLabelText('Application ID to review'), { target: { value: 'app_x' } });
    fireEvent.click(screen.getByText('Deny').closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('already_reviewed')).toBeDefined();
    });
  });
});
