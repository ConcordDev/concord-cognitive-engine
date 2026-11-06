/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Announcements full build (B6) — the two priced legs of R4's gate +
 * determination record:
 *   S1 / F1 — the declaration was HALF-present: the page's own StatusDot
 *   read Live while the tier banner could not render, because the
 *   manifest entry carried no dataTier and useDepthBadge returns null
 *   without one. The build declares REAL_LIVE on the lens's own entry
 *   with a scoped caption (the feed is Concord's own operator record,
 *   not an external source).
 *   S2 / F3 — the admin gate disclosed itself only at submit. The build
 *   states it at the door: a standing note beside the page actions and
 *   a statement at the top of the Compose panel, before the first field.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import { ComposePanel } from '@/components/announcements/ComposePanel';

describe('Announcements declaration (S1)', () => {
  it('the manifest entry declares REAL_LIVE — the banner has something to read', () => {
    expect(getLensManifest('announcements')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped operator-record caption', () => {
    const badge = renderHook(() => useDepthBadge('announcements')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/own operator announcements/);
    expect(badge?.caption).toMatch(/nothing has been published yet/);
    expect(badge?.caption).not.toMatch(/external source/);
  });
});

describe('Compose door disclosure (S2)', () => {
  it('the panel states admin-only publishing before the first field', () => {
    render(<ComposePanel onClose={() => {}} onPublished={() => {}} />);
    const note = screen.getByText(/Publishing is admin-only\. Only admin accounts can publish/);
    expect(note).toBeInTheDocument();
    const title = screen.getByLabelText('Title');
    expect(note.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'tester' } }) }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import AnnouncementsLensPage from '@/app/lenses/announcements/page';

describe('Announcements page door note (S2)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, announcements: [] }),
    })));
  });

  it('the landing carries the visible “Publishing is admin-only” note beside the actions', async () => {
    render(<AnnouncementsLensPage />);
    expect(await screen.findByText('Publishing is admin-only')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No announcements yet.')).toBeInTheDocument());
  });
});
