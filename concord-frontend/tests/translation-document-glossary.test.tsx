/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRunMock(...args) }));
const glossaryStore: { id: string; title: string; data: Record<string, unknown> }[] = [];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    items: type === 'glossary' ? glossaryStore : [],
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'tester' } }) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));

import TranslationLens from '@/app/lenses/translation/page';
import { chunkDocument } from '@/components/translation/TranslationPanels';

const CATALOG = { languages: [{ code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }], formalities: ['neutral'], count: 2 };

beforeEach(() => { lensRunMock.mockReset(); glossaryStore.length = 0; });

describe('chunkDocument', () => {
  it('keeps paragraph order, skips blanks, and splits by size', () => {
    const big = 'x'.repeat(4000);
    const r = chunkDocument(`a\n\n\n\nb\n\n${big}\n\n${big}`);
    expect(r.tooLong).toBeNull();
    expect(r.chunks.flat().map((i) => r.paragraphs[i].slice(0, 1))).toEqual(['a', 'b', 'x', 'x']);
    expect(r.chunks.length).toBe(2);
    expect(chunkDocument('y'.repeat(7001)).tooLong).toBe(0);
  });
});

describe('translation lens — glossary, swap, document', () => {
  it('sends glossary terms with a translation and warns on terms the engine ignored', async () => {
    glossaryStore.push({ id: 'g1', title: 'x', data: { kind: 'glossary', source: 'dashboard', target: 'panel' } });
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG } });
      return Promise.resolve({ data: { ok: true, result: { translated: 'el tablero', glossaryMisses: [{ source: 'dashboard', target: 'panel' }] } } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await act(async () => { fireEvent.change(view!.getByLabelText('Text to translate'), { target: { value: 'the dashboard' } }); });
    await act(async () => { fireEvent.click(view!.getByLabelText('Translate text')); });
    await waitFor(() => expect(view!.getByTestId('translation-glossary-misses')).toBeInTheDocument());
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'translate');
    expect(call![2]).toMatchObject({ glossary: [{ source: 'dashboard', target: 'panel' }] });
  });

  it('swap is disabled on auto-detect and swaps From/To once a source is picked', async () => {
    lensRunMock.mockImplementation(() => Promise.resolve({ data: { ok: true, result: CATALOG } }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    const swap = view!.getByLabelText('Swap languages');
    expect(swap).toBeDisabled();
    fireEvent.change(view!.getByLabelText('Translate from'), { target: { value: 'en' } });
    fireEvent.click(swap);
    expect((view!.getByLabelText('Translate from') as HTMLSelectElement).value).toBe('es');
    expect((view!.getByLabelText('Translate to') as HTMLSelectElement).value).toBe('en');
  });

  it('document mode translates paragraphs through batch and keeps their order', async () => {
    lensRunMock.mockImplementation((_d: string, action: string, input: { items?: string[] }) => {
      if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG } });
      if (action === 'batch') return Promise.resolve({ data: { ok: true, result: { translations: input.items!.map((s) => `ES:${s}`) } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await act(async () => { fireEvent.click(view!.getByLabelText('Document translation mode')); });
    const file = new File(['First para\n\nSecond para'], 'notes.md', { type: 'text/markdown' });
    await act(async () => { fireEvent.change(view!.getByLabelText('Document to translate'), { target: { files: [file] } }); });
    await waitFor(() => expect(view!.getByLabelText('Translate document')).not.toBeDisabled());
    await act(async () => { fireEvent.click(view!.getByLabelText('Translate document')); });
    await waitFor(() => expect(view!.getByTestId('translation-doc-result')).toBeInTheDocument());
    expect(view!.getByTestId('translation-doc-result').textContent).toContain('ES:First para\n\nES:Second para');
  });

  it('document mode stops honestly when the engine fails', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG } });
      return Promise.resolve({ data: { ok: false, error: 'translation_unavailable' } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await act(async () => { fireEvent.click(view!.getByLabelText('Document translation mode')); });
    const file = new File(['Hello'], 'a.txt', { type: 'text/plain' });
    await act(async () => { fireEvent.change(view!.getByLabelText('Document to translate'), { target: { files: [file] } }); });
    await waitFor(() => expect(view!.getByLabelText('Translate document')).not.toBeDisabled());
    await act(async () => { fireEvent.click(view!.getByLabelText('Translate document')); });
    await waitFor(() => expect(view!.getByTestId('translation-doc-error')).toBeInTheDocument());
    expect(view!.queryByTestId('translation-doc-result')).toBeNull();
  });
});
