// Audit fix sweep (PR #2356) — FIX-cognition-003: the question log's title
// and question fields state sensible length bounds (title 3–120 — 120 is
// the server's stored limit; question 10–2,000) with counters, and a
// too-short entry is refused with an inline message instead of a 1-char
// title or question being logged without a word.
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
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: ({ title }: { title: string }) =>
    React.createElement('button', { type: 'button' }, `Save as DTU: ${title}`),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import CognitionLens from '@/app/lenses/cognition/page';

function listed(rows: { id: string; title: string }[]) {
  return { data: { ok: true, result: { exports: rows, count: rows.length }, error: null } };
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
  lensRun.mockResolvedValue(listed([]));
});

describe('cognition question log — length bounds are stated and enforced in the open', () => {
  it('caps both fields, shows counters, and refuses too-short entries with a message', async () => {
    const view = render(<CognitionLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Log a question' }));
    const title = view.getByTestId('cg-title') as HTMLInputElement;
    const question = view.getByTestId('cg-question-input') as HTMLInputElement;
    expect(title.maxLength).toBe(120);
    expect(question.maxLength).toBe(2000);
    expect(view.getByText('3–120 characters.')).toBeTruthy();
    expect(view.getByText('10–2,000 characters — the question in your own words.')).toBeTruthy();

    fireEvent.change(title, { target: { value: 'ab' } });
    fireEvent.change(question, { target: { value: 'a perfectly reasonable question' } });
    fireEvent.keyDown(question, { key: 'Enter' });
    const alert1 = await view.findByRole('alert');
    expect(alert1.textContent).toContain('A title needs at least 3 characters.');
    expect(lensRun.mock.calls.filter(c => c[1] === 'exportTrace').length).toBe(0);

    fireEvent.change(title, { target: { value: 'A real title' } });
    fireEvent.change(question, { target: { value: 'short' } });
    fireEvent.keyDown(question, { key: 'Enter' });
    const alert2 = await view.findByRole('alert');
    expect(alert2.textContent).toContain('A question needs at least 10 characters');
    expect(lensRun.mock.calls.filter(c => c[1] === 'exportTrace').length).toBe(0);
  });
});
