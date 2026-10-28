/**
 * Council chamber greeting (HANDOFF-3 batch L16b).
 *
 * The Council concept opens on the serif headline addressed to the
 * signed-in user, in the same font-vault style as the other L-batch
 * greetings. This pins the chamber header carrying it — the chamber
 * is the council lens's real surface (the page is a thin shell over
 * it). Sub-panels and data hooks are mocked away; the header is the
 * chamber's own.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isError: false, error: null, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})) }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({ ok: true, result: {} })) }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { council: { reviewGlobal: vi.fn(async () => ({ data: {} })) } },
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/council/CouncilVoices', () => ({ CouncilVoices: () => null }));
vi.mock('@/components/council/CouncilActionPanel', () => ({ CouncilActionPanel: () => null }));
vi.mock('@/components/council/MeetingsWorkspace', () => ({ MeetingsWorkspace: () => null }));
vi.mock('@/components/council/DecisionArchive', () => ({ DecisionArchive: () => null }));
vi.mock('@/components/council/CouncilTheaterPanel', () => ({ default: () => null }));
vi.mock('@/components/emergent/GovernanceVotingPanel', () => ({ GovernanceVotingPanel: () => null }));
vi.mock('@/components/entity/EntityCard', () => ({ EntityCard: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CouncilChamber from '@/components/council/CouncilChamber';

describe('Council chamber greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<CouncilChamber />);
    const greeting = screen.getByTestId('council-greeting');
    expect(greeting.textContent).toBe('The question before us, Ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
