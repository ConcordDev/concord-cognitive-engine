/// <reference types="@testing-library/jest-dom/vitest" />
// Phase S4 — the provenance overlay + "Own it / List it". Pins:
//  • published → Grounded + DTU id + lineage + a List affordance;
//  • un-published edit → honest "not yet published", NO List affordance;
//  • List reuses the existing marketplace.listings-create macro and sends ZERO
//    fee/royalty fields (the money-safety guard — the macro owns all money
//    semantics; this component computes none);
//  • a failed listing surfaces the error and changes nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { detectArtifact, type ConkayArtifact } from '@/lib/conkay/artifact-kinds';
import { ArtifactProvenance } from './ArtifactProvenance';
import { lensRun } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));
const mockLensRun = vi.mocked(lensRun);

const INPUT = { archetype: 'tower', name: 'Test Tower', position: { x: 0, y: 0, z: 0 }, dimensions: { width: 6, height: 20, depth: 6 } };
const published = detectArtifact('game-design', 'building-publish', INPUT, {
  ok: true, buildingId: 'b1', dtuId: 'dtu_9', citations: [{ parentId: 'dtu_p1' }],
}) as ConkayArtifact;
const edited = detectArtifact('game-design', 'building-publish', INPUT, { ok: true, buildingId: 'b1' }) as ConkayArtifact;

beforeEach(() => mockLensRun.mockReset());

describe('ArtifactProvenance — S4', () => {
  it('published: Grounded badge + DTU id + lineage + List affordance', () => {
    render(<ArtifactProvenance artifact={published} />);
    expect(screen.getByTestId('ck-provenance-grounded')).toHaveTextContent('Grounded');
    expect(screen.getByTestId('ck-provenance-dtu')).toHaveTextContent('dtu_9');
    expect(screen.getByTestId('ck-provenance-lineage')).toHaveTextContent('cites 1 source');
    expect(screen.getByTestId('ck-provenance-list')).toBeInTheDocument();
  });

  it('un-published edit: honest "not yet published", no List affordance', () => {
    render(<ArtifactProvenance artifact={edited} />);
    expect(screen.getByTestId('ck-provenance-unpublished')).toHaveTextContent(/not yet published/i);
    expect(screen.queryByTestId('ck-provenance-list')).toBeNull();
  });

  it('List reuses marketplace.listings-create and sends NO fee/royalty fields', async () => {
    mockLensRun.mockResolvedValue({ data: { ok: true, result: { listing: { number: 'L-00001' } }, error: null } } as never);
    render(<ArtifactProvenance artifact={published} />);
    fireEvent.click(screen.getByTestId('ck-provenance-list'));
    fireEvent.change(screen.getByTestId('ck-provenance-price'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('ck-provenance-list-confirm'));

    await waitFor(() => expect(mockLensRun).toHaveBeenCalledTimes(1));
    const [domain, macro, payload] = mockLensRun.mock.calls[0];
    expect(domain).toBe('marketplace');
    expect(macro).toBe('listings-create');
    expect((payload as { priceUsd: number }).priceUsd).toBe(12);
    // money-safety: this component computes no split — it sends only listing fields.
    const keys = Object.keys(payload as object);
    expect(keys.sort()).toEqual(['description', 'kind', 'priceUsd', 'tags', 'title']);
    for (const banned of ['fee', 'royalty', 'platformFee', 'creatorShare', 'royaltyRate']) {
      expect(keys).not.toContain(banned);
    }
    await waitFor(() => expect(screen.getByTestId('ck-provenance-listed')).toHaveTextContent('L-00001'));
  });

  it('a failed listing surfaces the error, lists nothing', async () => {
    mockLensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'title + non-negative priceUsd required' } } as never);
    render(<ArtifactProvenance artifact={published} />);
    fireEvent.click(screen.getByTestId('ck-provenance-list'));
    fireEvent.change(screen.getByTestId('ck-provenance-price'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('ck-provenance-list-confirm'));
    await waitFor(() => expect(screen.getByTestId('ck-provenance-error')).toHaveTextContent('priceUsd required'));
    expect(screen.queryByTestId('ck-provenance-listed')).toBeNull();
  });

  it('guard: the source delegates to the listing macro and does no price arithmetic', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ArtifactProvenance.tsx'), 'utf8');
    expect(src).toMatch(/lensRun\(\s*['"]marketplace['"]\s*,\s*['"]listings-create['"]/);
    expect(src).not.toMatch(/\*\s*0\.\d/); // no `* 0.05`-style fee math
    expect(src).not.toMatch(/priceUsd\s*\*/); // never splits the price
  });
});
