/**
 * /lenses/concord-link-frontier — the frontier link.
 *
 * Open the link stores a name. The bearing and the mark show only after
 * link-detail returns them. A second link stays on the board. The feed
 * and the royalty ledger stay off this card.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
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

import ConcordLinkFrontierPage from './page';

interface Stored {
  id: string;
  name: string;
  bearing: string;
  mark: string | null;
}

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function install(links: Stored[], extra?: (name: string, input: Record<string, unknown>) => unknown) {
  lensRun.mockImplementation(async (_domain: string, name: string, input: Record<string, unknown> = {}) => {
    if (extra) {
      const overridden = extra(name, input);
      if (overridden) return overridden;
    }
    if (name === 'link-list') {
      return ok({
        links: links.map((item) => ({ id: item.id, name: item.name })),
        count: links.length,
      });
    }
    if (name === 'link-detail') {
      const row = links.find((item) => item.id === input.id);
      if (!row) return { data: { ok: false, result: null, error: 'link_not_found' } };
      return ok({
        link: { id: row.id, name: row.name, bearing: row.bearing, mark: row.mark },
      });
    }
    return { data: { ok: false, result: null, error: `unexpected ${name}` } };
  });
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('concord link frontier', () => {
  it('EMPTY: says no link is open and offers Open the link', async () => {
    install([]);
    const view = render(<ConcordLinkFrontierPage />);
    expect(await view.findByText('No link open.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The frontier link' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Open the link' })).toBeEnabled();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('Royalty flow')).toBeNull();
    expect(view.queryByText('Cross-world feed')).toBeNull();
  });

  it('WARMING: a shed list retries and then shows the empty grid', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockImplementation(async () => ok({ links: [], count: 0 }));
    const view = render(<ConcordLinkFrontierPage />);
    expect(await view.findByText('No link open.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<ConcordLinkFrontierPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    install([]);
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No link open.')).toBeInTheDocument();
  });

  it('does not send a blank name', async () => {
    install([]);
    const view = render(<ConcordLinkFrontierPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the link' }));
    fireEvent.click(view.getByRole('button', { name: 'Open this' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/name is required/i);
    expect(lensRun).not.toHaveBeenCalledWith('concord-link-frontier', 'link-open', expect.anything());
  });

  it('shows the name only after list matches, with no bearing yet', async () => {
    const links: Stored[] = [];
    install(links, (name, input) => {
      if (name !== 'link-open') return undefined;
      links.push({ id: 'lk_1', name: String(input.name), bearing: '', mark: null });
      return ok({ linkId: 'lk_1', link: { id: 'lk_1', name: input.name } });
    });
    const view = render(<ConcordLinkFrontierPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the link' }));
    fireEvent.change(view.getByTestId('clf-name'), { target: { value: 'North gate' } });
    fireEvent.click(view.getByRole('button', { name: 'Open this' }));
    expect(await view.findByRole('heading', { name: 'North gate' })).toBeInTheDocument();
    expect(view.queryByTestId('clf-bearing')).toBeNull();
    expect(view.queryByTestId('clf-mark')).toBeNull();
    expect(view.queryByText('No link open.')).toBeNull();
    expect(view.getByRole('button', { name: 'Set the bearing' })).toBeInTheDocument();
    expect(view.container.querySelector('input')).toBeNull();
  });

  it('stays on the composer when the list does not echo the name', async () => {
    install([], (name) => {
      if (name === 'link-open') return ok({ linkId: 'lk_1', link: { id: 'lk_1', name: 'North gate' } });
      if (name === 'link-list') return ok({ links: [], count: 0 });
      return undefined;
    });
    const view = render(<ConcordLinkFrontierPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the link' }));
    fireEvent.change(view.getByTestId('clf-name'), { target: { value: 'North gate' } });
    fireEvent.click(view.getByRole('button', { name: 'Open this' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.getByTestId('clf-name')).toBeInTheDocument();
    expect(view.queryByRole('heading', { name: 'North gate' })).toBeNull();
  });

  it('sets and edits the bearing only after detail reads it', async () => {
    const links: Stored[] = [{ id: 'lk_1', name: 'North gate', bearing: '', mark: null }];
    install(links, (name, input) => {
      if (name !== 'link-bearing') return undefined;
      const row = links.find((item) => item.id === input.id);
      if (row) row.bearing = String(input.bearing);
      return ok({ linkId: 'lk_1', link: { id: 'lk_1', name: 'North gate' } });
    });
    const view = render(<ConcordLinkFrontierPage />);
    expect(await view.findByRole('heading', { name: 'North gate' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Set the bearing' }));
    fireEvent.click(view.getByRole('button', { name: 'Save the bearing' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/bearing is required/i);
    expect(lensRun).not.toHaveBeenCalledWith('concord-link-frontier', 'link-bearing', expect.anything());
    fireEvent.change(view.getByTestId('clf-bearing-input'), { target: { value: 'Two spans north.' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the bearing' }));
    expect(await view.findByTestId('clf-bearing')).toHaveTextContent('Two spans north.');
    fireEvent.click(view.getByRole('button', { name: 'Edit the bearing' }));
    fireEvent.change(view.getByTestId('clf-bearing-input'), { target: { value: 'Three spans north.' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the bearing' }));
    expect(await view.findByTestId('clf-bearing')).toHaveTextContent('Three spans north.');
    expect(lensRun).toHaveBeenCalledWith('concord-link-frontier', 'link-bearing', { id: 'lk_1', bearing: 'Three spans north.' });
  });

  it('marks the link only after detail returns it, and keeps a second link', async () => {
    const links: Stored[] = [{ id: 'lk_1', name: 'North gate', bearing: 'Two spans north.', mark: null }];
    install(links, (name, input) => {
      if (name === 'link-mark') {
        const row = links.find((item) => item.id === input.id);
        if (row) row.mark = String(input.mark);
        return ok({ linkId: input.id, link: { id: input.id, name: row?.name } });
      }
      if (name === 'link-open') {
        links.push({ id: 'lk_2', name: String(input.name), bearing: '', mark: null });
        return ok({ linkId: 'lk_2', link: { id: 'lk_2', name: input.name } });
      }
      return undefined;
    });
    const view = render(<ConcordLinkFrontierPage />);
    expect(await view.findByTestId('clf-bearing')).toHaveTextContent('Two spans north.');
    fireEvent.click(view.getByRole('button', { name: 'Mark the link' }));
    fireEvent.click(view.getByRole('button', { name: 'Save the mark' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/mark is required/i);
    fireEvent.change(view.getByTestId('clf-mark-input'), { target: { value: 'The hinge is warm.' } });
    fireEvent.click(view.getByRole('button', { name: 'Save the mark' }));
    expect(await view.findByTestId('clf-mark')).toHaveTextContent('The hinge is warm.');
    fireEvent.click(view.getByRole('button', { name: 'Open the link' }));
    fireEvent.change(view.getByTestId('clf-name'), { target: { value: 'South gate' } });
    fireEvent.click(view.getByRole('button', { name: 'Open this' }));
    expect(await view.findByRole('heading', { name: 'South gate' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'North gate' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'North gate' }));
    expect(await view.findByTestId('clf-bearing')).toHaveTextContent('Two spans north.');
    expect(view.getByTestId('clf-mark')).toHaveTextContent('The hinge is warm.');
  });
});
