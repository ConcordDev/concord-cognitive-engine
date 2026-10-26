/**
 * WelcomeChecklist — first-run inline checklist (job oc-social-3b item c).
 *
 * No tour overlays: three REAL steps (avatar, bio, first post) whose
 * completion state comes from GET /api/social/welcome-state — the
 * server's own profile/post store. These tests prove: steps check off
 * only from the server's answer, avatar/bio open the SAME profile editor
 * You > Posts uses (a real save through POST /api/social/profile checks
 * the step off), "Write a post" defers to the composer, dismissal POSTs
 * /api/social/welcome-dismiss and hides the checklist, and everything
 * done hides it entirely.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
}));

import { WelcomeChecklist } from '@/components/social/WelcomeChecklist';

function renderChecklist(props: { currentUserId?: string; onStartPost?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WelcomeChecklist
        currentUserId={props.currentUserId || 'viewer-1'}
        fallbackDisplayName="viewer"
        onStartPost={props.onStartPost || vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const FRESH = { hasAvatar: false, hasBio: false, hasFirstPost: false, dismissed: false };

describe('WelcomeChecklist', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders the three steps for a brand-new user, unchecked until the server says so', async () => {
    apiGet.mockResolvedValue({ data: FRESH });
    renderChecklist();
    expect(await screen.findByText('Set your avatar')).toBeTruthy();
    expect(screen.getByText('Add a short bio')).toBeTruthy();
    expect(screen.getByText('Make your first post')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set avatar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add bio' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Write a post' })).toBeTruthy();
    expect(apiGet.mock.calls.some(([url]: unknown[]) => String(url) === '/api/social/welcome-state')).toBe(true);
  });

  it('checks off only the steps the server reports done — never optimistically', async () => {
    apiGet.mockResolvedValue({ data: { hasAvatar: true, hasBio: false, hasFirstPost: true, dismissed: false } });
    renderChecklist();
    expect(await screen.findByText('Set your avatar — done')).toBeTruthy();
    expect(screen.getByText('Make your first post — done')).toBeTruthy();
    // Bio still undone → its action button is the only one left.
    expect(screen.getByRole('button', { name: 'Add bio' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set avatar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write a post' })).toBeNull();
  });

  it('hides itself entirely once every step is done', async () => {
    apiGet.mockResolvedValue({ data: { hasAvatar: true, hasBio: true, hasFirstPost: true, dismissed: false } });
    const { container } = renderChecklist();
    // Nothing to check off and nothing to suggest → no checklist at all.
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.firstElementChild).toBeNull());
  });

  it('hides itself when the server says it was dismissed', async () => {
    apiGet.mockResolvedValue({ data: { ...FRESH, dismissed: true } });
    const { container } = renderChecklist();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(container.firstElementChild).toBeNull());
  });

  it('"Write a post" defers to the composer instead of faking a step', async () => {
    apiGet.mockResolvedValue({ data: FRESH });
    const onStartPost = vi.fn();
    renderChecklist({ onStartPost });
    fireEvent.click(await screen.findByRole('button', { name: 'Write a post' }));
    expect(onStartPost).toHaveBeenCalledTimes(1);
    // It did NOT open the profile editor.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('avatar/bio open the real profile editor; a real save checks the step off from the server', async () => {
    // Call 1: nothing done yet. Call 2 (after the save's invalidation):
    // the server has the bio.
    let calls = 0;
    apiGet.mockImplementation(async (url: unknown) => {
      const path = String(url);
      if (path === '/api/social/welcome-state') {
        calls += 1;
        return { data: calls <= 1 ? FRESH : { ...FRESH, hasBio: true } };
      }
      if (path === '/api/social/profile/viewer-1') {
        return { data: { ok: true, profile: { displayName: 'Viewer', bio: '', avatar: '', website: '', isPublic: true } } };
      }
      return { data: { ok: true } };
    });
    apiPost.mockResolvedValue({ data: { ok: true } });

    renderChecklist();
    fireEvent.click(await screen.findByRole('button', { name: 'Add bio' }));

    // The SAME editor You > Posts uses — a real dialog, not a checklist fake.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    const bioField = dialog.querySelector('textarea');
    expect(bioField).toBeTruthy();
    fireEvent.change(bioField!, { target: { value: 'hello from the checklist test' } });
    fireEvent.submit(dialog);
    // The save went through the real profile route.
    await waitFor(() => {
      expect(apiPost.mock.calls.some(([url, body]: unknown[]) => {
        const b = body as { bio?: string };
        return String(url) === '/api/social/profile' && b?.bio === 'hello from the checklist test';
      })).toBe(true);
    });
    // The step checks off only because the refetched welcome-state says so.
    expect(await screen.findByText('Add a short bio — done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add bio' })).toBeNull();
  });

  it('dismissal POSTs the real dismissal route and the checklist disappears', async () => {
    let calls = 0;
    apiGet.mockImplementation(async () => {
      calls += 1;
      return { data: calls <= 1 ? FRESH : { ...FRESH, dismissed: true } };
    });
    apiPost.mockImplementation(async (url: unknown) => {
      expect(String(url)).toBe('/api/social/welcome-dismiss');
      return { data: { ok: true } };
    });

    const { container } = renderChecklist();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss the welcome checklist' }));
    await waitFor(() => {
      expect(apiPost.mock.calls.some(([url]: unknown[]) => String(url) === '/api/social/welcome-dismiss')).toBe(true);
    });
    // Dismissal persists server-side, so the row is gone from the refetched
    // state — and would stay gone after a reload.
    await waitFor(() => expect(container.firstElementChild).toBeNull());
  });
});