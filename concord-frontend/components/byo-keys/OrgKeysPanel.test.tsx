/// <reference types="@testing-library/jest-dom/vitest" />
// OrgKeysPanel — org-shared key groups. Pins FIX-byo-keys-012:
//   1. A member with a resolved display label renders by that name —
//      the raw user id never appears as the row's text.
//   2. A member whose id has no account row (label null) renders a
//      shortened id, not the full raw UUID.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { OrgKeysPanel } from './OrgKeysPanel';

const OWNER_ID = '3f9a2c1e-44b7-4c1a-9e2d-0123456789ab';
const GHOST_ID = '77aa10bc-1111-4222-8333-444455556666';

describe('OrgKeysPanel member labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          orgs: [{
            orgId: 'org_test1',
            label: 'Eng team',
            provider: 'anthropic',
            slot: null,
            myRole: 'owner',
            isOwner: true,
            memberCount: 2,
            createdAt: 1700000000,
            members: [
              { memberId: OWNER_ID, role: 'owner', label: 'Alice' },
              { memberId: GHOST_ID, role: 'user', label: null },
            ],
          }],
        },
        error: null,
      },
    });
  });

  it('renders members by display name, never the raw owner UUID', async () => {
    const { container } = render(<OrgKeysPanel />);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(container.textContent).not.toContain(OWNER_ID);
  });

  it('falls back to a shortened id when no label resolved', async () => {
    const { container } = render(<OrgKeysPanel />);
    expect(await screen.findByText('77aa10bc…')).toBeInTheDocument();
    expect(container.textContent).not.toContain(GHOST_ID);
  });
});
