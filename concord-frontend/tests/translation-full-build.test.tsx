/**
 * build(translation) — the full-build FE pins (S1 · S4).
 *
 *   S1 — the declaration: manifest REAL_LIVE, the badge's Live label with
 *        the local-model caption (never the generic "polled from an
 *        external source" line, which is exactly backwards here), and
 *        the integration registry's REAL_LIVE entry.
 *   S4 — the Single panel states the engine's 8,000-character cap and
 *        blocks past it; saved rows show the SOURCE text, are
 *        searchable, editable, and two-step deleted; an identical
 *        re-save is refused instead of stacking a duplicate.
 *
 * Page renders mirror the shipped states suite's mocks, extended with
 * useLensData's update verb.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const savedStore: { id: string; title: string; data: Record<string, unknown> }[] = [];
const createMock = vi.fn((item: { title: string; data: Record<string, unknown> }) => {
  savedStore.push({ id: `t_${savedStore.length}`, ...item });
});
const removeMock = vi.fn();
const updateMock = vi.fn(() => Promise.resolve());
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: savedStore, create: createMock, remove: removeMock, update: updateMock }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'tester' } }) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));

import TranslationLens from '@/app/lenses/translation/page';

const CATALOG = {
  languages: [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
  ],
  formalities: ['neutral', 'formal', 'informal'],
  count: 3,
};

beforeEach(() => {
  lensRunMock.mockReset();
  createMock.mockClear();
  removeMock.mockClear();
  updateMock.mockClear();
  savedStore.length = 0;
  localStorage.clear();
  lensRunMock.mockImplementation((_d: string, action: string) => {
    if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG, error: null } });
    if (action === 'translate') {
      return Promise.resolve({ data: { ok: true, result: { translated: 'Hola, mundo', targetLanguage: 'Spanish', chars: 12 }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  });
});

describe('translation declaration (S1)', () => {
  it('the manifest declares REAL_LIVE', () => {
    expect(getLensManifest('translation')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the local-model caption', () => {
    const badge = renderHook(() => useDepthBadge('translation')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/local model/);
    expect(badge?.caption).toMatch(/never leaves your server/);
    expect(badge?.caption).not.toMatch(/polled live from an external source/i);
  });

  it('the integration registry carries translation at REAL_LIVE', () => {
    const src = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    expect(src).toMatch(/translation:\s*\{\s*tier: TIER\.REAL_LIVE/);
  });
});

describe('translation build (S4)', () => {
  it('the Single panel states the cap and blocks translation past it', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await waitFor(() => expect(view!.getByLabelText('Text to translate')).toBeInTheDocument());
    expect(view!.getByTestId('translation-char-count').textContent).toMatch(/8,000 characters/);

    await act(async () => {
      fireEvent.change(view!.getByLabelText('Text to translate'), { target: { value: 'x'.repeat(8001) } });
    });
    expect(view!.getByTestId('translation-char-count').textContent).toMatch(/over the engine limit/);
    expect(view!.getByLabelText('Translate text')).toBeDisabled();
  });

  it('saved rows show the source, search, edit through update, and delete in two steps', async () => {
    savedStore.push({
      id: 'sv1',
      title: 'the fox → es',
      data: { source: 'en', target: 'es', formality: 'neutral', input: 'the fox', output: 'el zorro' },
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await waitFor(() => expect(view!.getByTestId('translation-saved')).toBeInTheDocument());
    expect(view!.getByTestId('translation-saved').textContent).toMatch(/the fox/);
    expect(view!.getByTestId('translation-saved').textContent).toMatch(/el zorro/);

    // search filters the rows
    await act(async () => {
      fireEvent.change(view!.getByLabelText('Search saved translations'), { target: { value: 'nomatch' } });
    });
    expect(view!.getByTestId('translation-saved-nomatch')).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(view!.getByLabelText('Search saved translations'), { target: { value: '' } });
    });

    // edit writes through useLensData.update
    await act(async () => { fireEvent.click(view!.getByLabelText(/Edit saved translation/)); });
    await act(async () => {
      fireEvent.change(view!.getByLabelText('Edit saved translation output'), { target: { value: 'el zorro editado' } });
    });
    await act(async () => { fireEvent.click(view!.getByLabelText('Save edited translation')); });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toBe('sv1');
    expect((updateMock.mock.calls[0][1] as { data: { output: string } }).data.output).toBe('el zorro editado');

    // delete is two-step: the first click arms, the row survives
    await act(async () => { fireEvent.click(view!.getByTestId('saved-delete')); });
    expect(removeMock).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(view!.getByTestId('saved-delete-confirm')); });
    expect(removeMock).toHaveBeenCalledWith('sv1');
  });

  it('an identical re-save is refused instead of stacking a duplicate', async () => {
    savedStore.push({
      id: 'sv1',
      title: 'Hello, world → es',
      data: { source: 'auto', target: 'es', formality: 'neutral', input: 'Hello, world', output: 'Hola, mundo' },
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await waitFor(() => expect(view!.getByLabelText('Text to translate')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(view!.getByLabelText('Text to translate'), { target: { value: 'Hello, world' } });
    });
    await act(async () => { fireEvent.click(view!.getByLabelText('Translate text')); });
    await waitFor(() => expect(view!.getByTestId('translation-output')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view!.getByLabelText('Save translation')); });
    expect(createMock).not.toHaveBeenCalled();
  });
});
