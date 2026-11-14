// Residue slice FE pins (B6, CB-0568):
//  - FIX-metacognition-001: past reflections carry Edit (prefills the form,
//    save becomes Save Changes) and a two-step Delete that calls
//    reflectionDelete — reflections were permanent before.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.hoisted(() => vi.fn());
const apiGetMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/lenses/x', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: (...a: unknown[]) => apiGetMock(...a), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {},
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout'].includes(k))), children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { ReflectionPrompts } from '../components/metacognition/ReflectionPrompts';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockResolvedValue({ data: { ok: true, result: {} } });
  apiGetMock.mockReset();
  apiGetMock.mockResolvedValue({ data: [] });
});

describe('FIX-metacognition-001 reflection edit + delete controls', () => {
  const reflection = {
    id: 'r1',
    decisionId: null,
    title: 'Weekly review',
    answers: [{ question: 'What happened?', answer: 'Shipped the fix' }],
    note: 'a note',
    createdAt: '2026-11-10T12:00:00.000Z',
  };

  beforeEach(() => {
    lensRunMock.mockImplementation(async (_lens: string, action: string) => {
      if (action === 'reflectionPrompts') return { data: { ok: true, result: { prompts: [{ id: 'p1', question: 'What happened?' }], count: 1 } } };
      if (action === 'reflectionList') return { data: { ok: true, result: { reflections: [reflection], total: 1 } } };
      if (action === 'reflectionDelete') return { data: { ok: true, result: { removed: 'r1', remaining: 0 } } };
      if (action === 'reflectionSave') return { data: { ok: true, result: { reflection, updated: true } } };
      return { data: { ok: true, result: {} } };
    });
  });

  const expandRow = async () => {
    render(<ReflectionPrompts />);
    await settle();
    const header = Array.from(document.querySelectorAll('[role="button"]')).find((b) => (b.textContent || '').includes('Weekly review'));
    expect(header).toBeTruthy();
    await act(async () => { fireEvent.click(header!); });
    await settle();
  };

  it('a past reflection exposes Edit and Delete once expanded', async () => {
    await expandRow();
    expect(document.querySelector('button[aria-label="Edit reflection Weekly review"]')).toBeTruthy();
    expect(document.querySelector('button[aria-label="Delete reflection Weekly review"]')).toBeTruthy();
  });

  it('Edit prefills the form from the saved answers and switches the save button', async () => {
    await expandRow();
    const editBtn = document.querySelector('button[aria-label="Edit reflection Weekly review"]')!;
    await act(async () => { fireEvent.click(editBtn); });
    await settle();
    const areas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    expect(areas.some((t) => t.value === 'Shipped the fix')).toBe(true);
    const saveBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Save Changes'));
    expect(saveBtn).toBeTruthy();
  });

  it('Delete is two-step and calls reflectionDelete with the reflection id', async () => {
    await expandRow();
    const delBtn = document.querySelector('button[aria-label="Delete reflection Weekly review"]')!;
    await act(async () => { fireEvent.click(delBtn); });
    await settle();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'reflectionDelete')).toBe(false);
    const confirmBtn = document.querySelector('button[aria-label="Confirm delete reflection Weekly review"]')!;
    expect(confirmBtn).toBeTruthy();
    await act(async () => { fireEvent.click(confirmBtn); });
    await settle();
    const delCall = lensRunMock.mock.calls.find((c) => c[1] === 'reflectionDelete');
    expect(delCall).toBeTruthy();
    expect(delCall![2]).toMatchObject({ id: 'r1' });
  });
});
