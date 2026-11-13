/**
 * CB-0496 Part A — name-length honesty, second leg: the limit that governs
 * in the domain code is printed on the field as maxLength, so a name can
 * never be silently truncated by the server's clean helper.
 *   civic-bonds title 500 (lib createBond slice) · fractal preset name 120
 *   (fxClean at savePreset) · geology observation name 120 (geoClean) ·
 *   photography shoot name 120 (phclean) · poetry title 200 (poClean) ·
 *   saved folder name 120 (slice) · artistry project title 160 (artClean).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  lensRunBatch: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('@/lib/errors/error-store', () => ({
  useErrorStore: () => ({ addToast: vi.fn(), addError: vi.fn() }),
  useAddError: () => vi.fn(),
  useAddToast: () => vi.fn(),
}));
vi.mock('@/hooks/useSmartPolling', () => ({ useSmartPolling: () => {} }));

import { FractalRenderer } from '@/components/fractal/FractalRenderer';
import { FieldLog } from '@/components/geology/FieldLog';
import { LightroomCollectionsPanel } from '@/components/photography/LightroomCollectionsPanel';
import { ComposePanel } from '@/components/poetry/ComposePanel';
import { FoldersSidebar } from '@/components/saved/FoldersSidebar';
import { ProjectStudio } from '@/components/artistry/ProjectStudio';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

const R = (result: unknown) => ({ data: { ok: true, result, error: null } });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_d: string, action: string) => {
    switch (action) {
      case 'listPresets': return R({ presets: [] });
      case 'listRenders': return R({ renders: [] });
      case 'paletteFor': return R({ swatches: [{ rgb: [1, 2, 3] }] });
      case 'observation-list': return R({ observations: [] });
      case 'site-list': return R({ sites: [] });
      case 'shoot-list': return R({ shoots: [] });
      case 'roll-list': return R({ rolls: [] });
      case 'photo-list': return R({ photos: [] });
      case 'poem-list': return R({ poems: [] });
      case 'collection-list': return R({ collections: [] });
      case 'project-list': return R({ projects: [] });
      default: return R({});
    }
  });
});

describe('CB-0496 Part A — governing length limits ride the fields', () => {
  it('fractal preset name carries the savePreset cap (120)', async () => {
    wrap(<FractalRenderer />);
    const input = await screen.findByPlaceholderText('preset name…');
    expect((input as HTMLInputElement).maxLength).toBe(120);
  });

  it('geology observation name carries the geoClean cap (120)', async () => {
    wrap(<FieldLog />);
    const input = await screen.findByPlaceholderText('Sample / outcrop name');
    expect((input as HTMLInputElement).maxLength).toBe(120);
  });

  it('photography shoot name carries the phclean cap (120)', async () => {
    wrap(<LightroomCollectionsPanel />);
    const input = await screen.findByPlaceholderText('Shoot name');
    expect((input as HTMLInputElement).maxLength).toBe(120);
  });

  it('poetry poem title carries the poClean cap (200)', async () => {
    wrap(<ComposePanel intent={{ nonce: 1 }} />);
    // The panel renders the title field in two layouts — every copy is capped.
    const inputs = await screen.findAllByPlaceholderText('Poem title');
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect((input as HTMLInputElement).maxLength).toBe(200);
  });

  it('saved folder create + rename inputs carry the folder cap (120)', async () => {
    const view = render(
      <FoldersSidebar
        folders={[{ id: 'f1', name: 'Clippings', itemCount: 2 }]}
        unfiledCount={0}
        totalCount={2}
        activeFolderId={null}
        onSelect={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(view.getByRole('button', { name: /new folder/i }));
    const create = await screen.findByPlaceholderText('Folder name');
    expect((create as HTMLInputElement).maxLength).toBe(120);
    fireEvent.click(view.getByRole('button', { name: 'Rename folder' }));
    const rename = view.container.querySelector('input[value="Clippings"]') as HTMLInputElement;
    expect(rename).toBeTruthy();
    expect(rename.maxLength).toBe(120);
  });

  it('artistry project title carries the artClean cap (160)', async () => {
    wrap(<ProjectStudio />);
    fireEvent.click(await screen.findByRole('button', { name: /New Project/ }));
    const input = await screen.findByPlaceholderText('Project title');
    expect((input as HTMLInputElement).maxLength).toBe(160);
  });
});
