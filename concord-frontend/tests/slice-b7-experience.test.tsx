import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// Slice B7 — FIX-experience-004: portfolio skills gain an edit control
// (the draft form, saving in place under the same id) and the remove
// goes behind a two-step confirm instead of deleting in one click.

const h = vi.hoisted(() => ({ create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), run: vi.fn(), state: { items: [] as unknown[], loading: false } }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: h.state.items, isLoading: h.state.loading, create: h.create, update: h.update, remove: h.remove }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: h.run }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/components/icons/Icon', () => ({ Icon: () => <span>icon</span> }));

const DATA = {
  skills: [{ id: 'mixing', name: 'Mixing', category: 'technical', level: 'advanced', yearsExperience: 4, evidence: ['https://x'] }],
  experience: [],
  education: [],
  endorsements: [{ id: 'e1', skillId: 'mixing', endorserId: 'u2', comment: 'great', endorsedAt: '2026-01-01' }],
  snapshots: [],
};
const MINE = { id: 'p1', ownerId: 'me', title: 'My Portfolio', data: DATA, meta: { visibility: 'private' }, version: 2, createdAt: '2026-01-01', updatedAt: '2026-01-02' };

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 20)); }); };
const mount = async () => { const { CareerPortfolio } = await import('@/components/experience/CareerPortfolio'); const v = render(<CareerPortfolio />); await settle(); return v; };

afterEach(() => cleanup());
beforeEach(() => {
  [h.create, h.update, h.remove].forEach((f) => f.mockClear());
  h.state.items = [MINE]; h.state.loading = false;
  h.run.mockReset(); h.run.mockImplementation(async () => ({ ok: true, result: { ok: true } }));
});

describe('FIX-experience-004 skill edit + confirmed remove', () => {
  it('Edit loads the skill into the form; Save changes saves in place under the same id', async () => {
    await mount();
    await click(screen.getByLabelText('edit skill Mixing'));
    const nameInput = screen.getByPlaceholderText('Mixing') as HTMLInputElement;
    expect(nameInput.value).toBe('Mixing');
    await act(async () => { fireEvent.change(nameInput, { target: { value: 'Mixing & Mastering' } }); });
    await click(screen.getByRole('button', { name: /Save changes/ }));
    expect(h.update).toHaveBeenCalledTimes(1);
    const patch = (h.update.mock.calls[0] as unknown[])[1] as { data: { skills: Array<{ id: string; name: string }> } };
    expect(patch.data.skills).toHaveLength(1);
    expect(patch.data.skills[0]).toMatchObject({ id: 'mixing', name: 'Mixing & Mastering' });
  });

  it('remove arms first — nothing saves until the confirm', async () => {
    await mount();
    await click(screen.getByLabelText('remove skill'));
    expect(h.update).not.toHaveBeenCalled();
    await click(screen.getByText('Remove skill?'));
    expect(h.update).toHaveBeenCalledTimes(1);
    const patch = (h.update.mock.calls[0] as unknown[])[1] as { data: { skills: unknown[] } };
    expect(patch.data.skills).toHaveLength(0);
  });
});
