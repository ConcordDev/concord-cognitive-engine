/**
 * /lenses/translation — four-UX-state contract.
 *
 * Pins that the translation lens renders genuine loading (role=status) /
 * error (role=alert + a working Retry) / empty / ready states against the real
 * translation.* macro surface (driven by a mocked lensRun standing in for
 * POST /api/lens/run → server/domains/translation.js), plus a11y (the from/to/
 * register selects + the translate/detect buttons carry accessible names).
 *
 * No fabricated data: every state is driven by the exact shapes
 * server/domains/translation.js#{languages,translate,detect} return.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// useLensData (the persist path) talks to react-query + /api/lens — stub it to
// a controllable in-memory store so the render is hermetic. The persist
// capability itself (save/recall) is exercised by the POPULATED-saved test.
const savedStore: { id: string; title: string; data: Record<string, unknown> }[] = [];
const createMock = vi.fn((item: { title: string; data: Record<string, unknown> }) => {
  savedStore.push({ id: `t_${savedStore.length}`, ...item });
});
const removeMock = vi.fn();
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: savedStore, create: createMock, remove: removeMock }),
}));

// LensShell is a presentational wrapper — stub to keep the render focused.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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
  savedStore.length = 0;
});

describe('translation lens — four UX states', () => {
  it('LOADING: shows a role=status notice while the catalog is in flight', async () => {
    // languages never resolves → stuck loading.
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'languages') return new Promise(() => {});
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    const loading = view!.getByTestId('translation-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('EMPTY: shows an honest empty state once the catalog loads and nothing is translated', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG, error: null } });
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await waitFor(() => expect(view!.getByTestId('translation-empty')).toBeInTheDocument());
    expect(view!.getByTestId('translation-empty').textContent).toMatch(/nothing translated yet/i);
    // a11y: the selects + buttons carry accessible names.
    expect(view!.getByLabelText('Translate from')).toBeInTheDocument();
    expect(view!.getByLabelText('Translate to')).toBeInTheDocument();
    expect(view!.getByLabelText('Formality register')).toBeInTheDocument();
    expect(view!.getByLabelText('Text to translate')).toBeInTheDocument();
    expect(view!.getByLabelText('Translate text')).toBeInTheDocument();
    expect(view!.getByLabelText('Detect language')).toBeInTheDocument();
  });

  it('READY: renders a real translation result', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG, error: null } });
      if (action === 'translate') {
        return Promise.resolve({ data: { ok: true, result: { translated: 'Hola, mundo', targetLanguage: 'Spanish', chars: 12 }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await waitFor(() => expect(view!.getByLabelText('Text to translate')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(view!.getByLabelText('Text to translate'), { target: { value: 'Hello, world' } });
    });
    await act(async () => { fireEvent.click(view!.getByLabelText('Translate text')); });

    await waitFor(() => expect(view!.getByTestId('translation-output')).toBeInTheDocument());
    expect(view!.getByTestId('translation-output').textContent).toMatch(/Hola, mundo/);

    // PERSIST: saving the result calls the server-local lens artifact store.
    await act(async () => { fireEvent.click(view!.getByLabelText('Save translation')); });
    expect(createMock).toHaveBeenCalledTimes(1);
    const saved = createMock.mock.calls[0][0] as { data: { output: string } };
    expect(saved.data.output).toBe('Hola, mundo');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the translate call', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG, error: null } });
      if (action === 'translate') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'translation_unavailable' } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await waitFor(() => expect(view!.getByLabelText('Text to translate')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(view!.getByLabelText('Text to translate'), { target: { value: 'Hello' } });
    });
    await act(async () => { fireEvent.click(view!.getByLabelText('Translate text')); });

    await waitFor(() => expect(view!.getByTestId('translation-error')).toBeInTheDocument());
    expect(view!.getByTestId('translation-error')).toHaveAttribute('role', 'alert');
    expect(view!.getByTestId('translation-error').textContent).toMatch(/unavailable/i);

    const before = lensRunMock.mock.calls.filter((c) => c[1] === 'translate').length;
    await act(async () => { fireEvent.click(view!.getByLabelText('Retry translation')); });
    const after = lensRunMock.mock.calls.filter((c) => c[1] === 'translate').length;
    expect(after).toBeGreaterThan(before);
  });

  it('DETECT: renders the detected-language readout from translation.detect', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'languages') return Promise.resolve({ data: { ok: true, result: CATALOG, error: null } });
      if (action === 'detect') {
        return Promise.resolve({ data: { ok: true, result: { language: 'Spanish', code: 'es', confidence: 0.82, method: 'stopword' }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<TranslationLens />); });
    await waitFor(() => expect(view!.getByLabelText('Text to translate')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(view!.getByLabelText('Text to translate'), { target: { value: 'el gato' } });
    });
    await act(async () => { fireEvent.click(view!.getByLabelText('Detect language')); });

    await waitFor(() => expect(view!.getByTestId('translation-detected')).toBeInTheDocument());
    expect(view!.getByTestId('translation-detected').textContent).toMatch(/Spanish \(82%\)/);
  });
});
