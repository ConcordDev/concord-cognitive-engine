/**
 * build(concord-link-frontier) — the full-build FE pins (S1 · S2 floor · S3 · S4).
 *
 *   S1 — the declaration: manifest REAL_LIVE on the lens's own entry,
 *        the badge's Live label with the own-records caption (never the
 *        generic "polled from an external source" line), and the
 *        integration registry's REAL_LIVE entries.
 *   S2 (floor) — the catalogue card describes the annotator that exists:
 *        the lens-registry description names the annotator, and the
 *        federation-news sentence is gone from the catalogue.
 *   S3 — delete is two-step: the first click makes NO server call, Keep
 *        disarms, and confirming the delete of the last link returns
 *        the lens to "No link open."
 *   S4 — every inline form can be left without saving: a Cancel control
 *        and Escape on the input both return to the view, unsaved.
 *
 * Page renders mirror the shipped page suite's mocks, with a stateful
 * lensRun that also serves link-delete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import ConcordLinkFrontierPage from '../app/lenses/concord-link-frontier/page';

interface Stored {
  id: string;
  name: string;
  bearing: string;
  mark: string | null;
}

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function install(links: Stored[]) {
  lensRun.mockImplementation(async (_domain: string, name: string, input: Record<string, unknown> = {}) => {
    if (name === 'link-list') {
      return ok({ links: links.map((item) => ({ id: item.id, name: item.name })), count: links.length });
    }
    if (name === 'link-detail') {
      const row = links.find((item) => item.id === input.id);
      if (!row) return { data: { ok: false, result: null, error: 'link_not_found' } };
      return ok({ link: { id: row.id, name: row.name, bearing: row.bearing, mark: row.mark } });
    }
    if (name === 'link-delete') {
      const idx = links.findIndex((item) => item.id === input.id);
      if (idx < 0) return { data: { ok: false, result: null, error: 'link_not_found' } };
      const [gone] = links.splice(idx, 1);
      return ok({ linkId: gone.id, link: { id: gone.id, name: gone.name } });
    }
    if (name === 'link-bearing') {
      const row = links.find((item) => item.id === input.id);
      if (row) row.bearing = String(input.bearing);
      return ok({ linkId: input.id, link: { id: input.id, name: row?.name } });
    }
    return { data: { ok: false, result: null, error: `unexpected ${name}` } };
  });
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('concord link frontier full build — declaration (S1) and the card (S2 floor)', () => {
  it('the manifest declares REAL_LIVE on the lens entry, over the link artifact', () => {
    const entry = getLensManifest('concord-link-frontier');
    expect(entry?.dataTier).toBe('REAL_LIVE');
    expect(entry?.artifacts).toEqual(['link']);
  });

  it('the badge reads Live with the own-records caption', () => {
    const badge = renderHook(() => useDepthBadge('concord-link-frontier')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('your own link records');
  });

  it('the integration registry carries the lens at REAL_LIVE under both key forms', () => {
    const registry = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    expect(registry).toContain('concord_link_frontier: { tier: TIER.REAL_LIVE');
    expect(registry).toContain('"concord-link-frontier": { tier: TIER.REAL_LIVE');
  });

  it('the catalogue card describes the annotator; the federation-news sentence is gone', () => {
    const catalogue = readFileSync(join(__dirname, '../lib/lens-registry.ts'), 'utf8');
    expect(catalogue).toContain('Your link annotator');
    expect(catalogue).not.toContain('news layer of the federation');
  });
});

describe('concord link frontier full build — the lifecycle exit (S3) and form exits (S4)', () => {
  it('delete is two-step: no call on the first click, Keep disarms, confirm deletes to the empty state', async () => {
    const links: Stored[] = [{ id: 'lk_1', name: 'The Frontier', bearing: 'PR2 test bearing 1031', mark: 'PR2 test mark 1031' }];
    install(links);
    const view = render(<ConcordLinkFrontierPage />);
    expect(await view.findByRole('heading', { name: 'The Frontier' })).toBeInTheDocument();

    fireEvent.click(view.getByTestId('clf-delete'));
    expect(lensRun).not.toHaveBeenCalledWith('concord-link-frontier', 'link-delete', expect.anything());
    expect(view.getByText('Delete "The Frontier"?')).toBeInTheDocument();

    fireEvent.click(view.getByRole('button', { name: 'Keep' }));
    expect(lensRun).not.toHaveBeenCalledWith('concord-link-frontier', 'link-delete', expect.anything());
    expect(view.getByRole('heading', { name: 'The Frontier' })).toBeInTheDocument();

    fireEvent.click(view.getByTestId('clf-delete'));
    fireEvent.click(view.getByTestId('clf-delete-confirm-btn'));
    expect(await view.findByText('No link open.')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('concord-link-frontier', 'link-delete', { id: 'lk_1' });
  });

  it('Cancel leaves the bearing form unsaved and returns to the view', async () => {
    const links: Stored[] = [{ id: 'lk_1', name: 'North gate', bearing: '', mark: null }];
    install(links);
    const view = render(<ConcordLinkFrontierPage />);
    expect(await view.findByRole('heading', { name: 'North gate' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Set the bearing' }));
    fireEvent.change(view.getByTestId('clf-bearing-input'), { target: { value: 'Two spans north.' } });
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(view.queryByTestId('clf-bearing-input')).toBeNull();
    expect(lensRun).not.toHaveBeenCalledWith('concord-link-frontier', 'link-bearing', expect.anything());
    expect(view.getByRole('button', { name: 'Set the bearing' })).toBeInTheDocument();
  });

  it('Escape leaves the open form unsaved', async () => {
    install([]);
    const view = render(<ConcordLinkFrontierPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the link' }));
    const input = view.getByTestId('clf-name');
    fireEvent.change(input, { target: { value: 'North gate' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(view.queryByTestId('clf-name')).toBeNull();
    expect(lensRun).not.toHaveBeenCalledWith('concord-link-frontier', 'link-open', expect.anything());
    expect(view.getByText('No link open.')).toBeInTheDocument();
  });
});
