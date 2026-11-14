/**
 * RESIDUE B7 — FIX-classroom-010, reflow leg: the cohorts status line
 * ('✓ Left the cohort') rendered conditionally above the cohort cards,
 * so its appearance — and its disappearance 4s later — shifted every
 * row twice and clicks landed on the wrong cohort. The status now fills
 * a fixed-height live region whose slot is always reserved.
 * (The row's other legs at head: Archive/Leave already carry the
 * two-step StickyDeleteConfirm, and the post-reload scope restore +
 * row toggle are the designed interaction — see the premise file.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/classroom/OpenLibrarySearch', () => ({ OpenLibrarySearch: () => null }));
vi.mock('@/components/classroom/ClassroomWorkspace', () => ({ ClassroomWorkspace: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

import ClassroomPage from '@/app/lenses/classroom/page';

const cohort = { id: 7, name: 'Bio 101', rubric_dtu_id: null, created_at: 1, teacher_display_name: 'Ms Rao' };

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body || '{}') as { name?: string };
    const payload = body.name === 'list_cohorts'
      ? { ok: true, teaching: [], studying: [cohort] }
      : { ok: true };
    return { json: async () => ({ ok: true, result: payload }) };
  }));
});

describe('FIX-classroom-010 — status banner never reflows the cohort rows', () => {
  it('the live region reserves its slot before any status exists', async () => {
    const { container } = render(<ClassroomPage />);
    await waitFor(() => expect(screen.getByText(/Bio 101/)).toBeTruthy());
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeTruthy();
    expect(region?.className).toContain('min-h-[38px]');
    expect(region?.textContent).toBe('');
  });

  it('leaving a cohort fills the same reserved slot (two-step confirm intact)', async () => {
    const { container } = render(<ClassroomPage />);
    await waitFor(() => expect(screen.getByText(/Bio 101/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Leave Bio 101' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm leave Bio 101' }));
    await waitFor(() => expect(screen.getByText(/Left the cohort/)).toBeTruthy());
    const region = container.querySelector('[aria-live="polite"]');
    expect(region?.className).toContain('min-h-[38px]');
  });
});
