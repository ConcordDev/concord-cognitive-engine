/**
 * CB-0521 FE pin — FIX-concord-link-frontier-003 (rename leg).
 * A link could be opened, borne, marked and deleted, but never renamed.
 * The detail view now offers Rename the link → Save the name, wired to
 * the link-rename verb, with the board reading the new name back.
 * (The delete leg was already wired — StickyDeleteConfirm per row.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: { username: 'tester' } as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import ConcordLinkFrontierPage from '../app/lenses/concord-link-frontier/page';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

interface Stored { id: string; name: string; bearing: string; mark: string | null }
let links: Stored[];
let calls: Array<{ name: string; input: Record<string, unknown> }>;

beforeEach(() => {
  lensRun.mockReset();
  calls = [];
  links = [{ id: 'l1', name: 'North gate', bearing: '', mark: null }];
  lensRun.mockImplementation(async (_domain: string, name: string, input: Record<string, unknown> = {}) => {
    calls.push({ name, input });
    if (name === 'link-list') return ok({ links: links.map((l) => ({ id: l.id, name: l.name })), count: links.length });
    if (name === 'link-detail') {
      const row = links.find((l) => l.id === input.id);
      return ok({ link: row ? { id: row.id, name: row.name, bearing: row.bearing, mark: row.mark } : null });
    }
    if (name === 'link-rename') {
      const row = links.find((l) => l.id === input.id);
      if (row) row.name = String(input.name);
      return ok({ linkId: input.id, link: row ? { id: row.id, name: row.name } : null });
    }
    return ok({});
  });
});

describe('FIX-concord-link-frontier-003 — rename the link', () => {
  it('renaming from the detail view sends link-rename and the board reads the new name back', async () => {
    render(<ConcordLinkFrontierPage />);
    const rowButton = await screen.findByRole('button', { name: 'North gate' });
    fireEvent.click(rowButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Rename the link' }));
    const input = await screen.findByTestId('clf-rename-input');
    expect((input as HTMLInputElement).value).toBe('North gate');
    fireEvent.change(input, { target: { value: 'North gate (winter)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));
    await waitFor(() => {
      const rename = calls.find((c) => c.name === 'link-rename');
      expect(rename).toBeTruthy();
      expect(rename!.input).toMatchObject({ id: 'l1', name: 'North gate (winter)' });
    });
    expect(await screen.findByRole('button', { name: 'North gate (winter)' })).toBeTruthy();
  });

  it('the row still carries its delete confirm (the already-wired leg)', async () => {
    render(<ConcordLinkFrontierPage />);
    expect(await screen.findByRole('button', { name: 'Delete link North gate' })).toBeTruthy();
  });
});
