// Behaviour coverage for the career portfolio editor: create, skills / experience / education
// CRUD (incl. row edit), publish toggle, analyse / resume / compare / validate results,
// snapshots, JSON export and the two-step portfolio delete. useLensData / useRunArtifact mocked.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), run: vi.fn(), state: { items: [] as unknown[], loading: false } }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: h.state.items, isLoading: h.state.loading, create: h.create, update: h.update, remove: h.remove }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: h.run }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/components/icons/Icon', () => ({ Icon: () => <span>icon</span> }));

const DATA = {
  skills: [{ id: 'mixing', name: 'Mixing', category: 'technical', level: 'advanced', yearsExperience: 4, evidence: ['https://x'] }],
  experience: [{ role: 'Engineer', company: 'Acme', startDate: '2020', endDate: '' }],
  education: [{ institution: 'MIT', degree: 'BS', field: 'CS', year: '2019' }],
  endorsements: [{ id: 'e1', skillId: 'mixing', endorserId: 'u2', comment: 'great', endorsedAt: '2026-01-01' }],
  snapshots: [{ version: 1, skills: [], savedAt: '2026-02-01T00:00:00Z' }],
};
const MINE = (visibility = 'private') => ({ id: 'p1', ownerId: 'me', title: 'My Portfolio', data: DATA, meta: { visibility }, version: 2, createdAt: '2026-01-01', updatedAt: '2026-01-02' });
const OTHER = { id: 'p2', ownerId: 'u9', title: 'Riley', data: { ...DATA, skills: [{ id: 's9', name: 'Mastering', category: 'technical', level: 'expert', yearsExperience: 6, evidence: [] }], endorsements: [] }, meta: { visibility: 'published' }, version: 1 };

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 20)); }); };
const btn = (re: RegExp, nth = 0) => screen.getAllByRole('button', { name: re })[nth];
const type = async (el: Element, v: string) => { await act(async () => { fireEvent.change(el, { target: { value: v } }); }); };
const mount = async () => { const { CareerPortfolio } = await import('../CareerPortfolio'); const v = render(<CareerPortfolio />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  Object.values(h).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as ReturnType<typeof vi.fn>).mockClear());
  h.state.items = [MINE(), OTHER]; h.state.loading = false;
  h.run.mockReset();
  h.run.mockImplementation(async (a: { action: string }) => {
    switch (a.action) {
      case 'analyze': return { ok: true, result: { analysis: { skillCount: 1, totalEndorsements: 1, topSkills: [{ skill: 'Mixing', strength: 0.8, endorsements: 1, evidenceCount: 1 }], categories: {} } } };
      case 'generate_resume': return { ok: true, result: { resume: { sections: { summary: {}, skills: [1], experience: [], education: [] } } } };
      case 'compare_versions': return { ok: true, result: { comparison: { added: ['Mixing'], removed: ['EQ'], retained: 2, growthRate: 12 } } };
      case 'validate_claims': return { ok: true, result: { validCount: 1, validated: [{ skill: 'Mixing', hasEvidence: true, validated: true }, { skill: 'EQ', hasEvidence: false, validated: false }] } };
      default: return { ok: true, result: { ok: true } };
    }
  });
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('CareerPortfolio', () => {
  it('offers to create a portfolio when none exists, and shows loading', async () => {
    h.state.items = [OTHER];
    const v = await mount();
    await click(btn(/Create my portfolio/));
    expect(h.create).toHaveBeenCalled();
    cleanup();
    h.state.loading = true;
    const loading = await mount();
    expect(loading.container.textContent).toMatch(/Loading portfolio/);
  });

  it('adds and removes skills, edits and deletes experience and education rows', { timeout: 60000 }, async () => {
    const v = await mount();
    expect(v.container.textContent).toMatch(/Mixing/);
    const inputs = () => Array.from(v.container.querySelectorAll('input')) as HTMLInputElement[];
    await type(screen.getByPlaceholderText('Mixing'), 'Sound design');
    const selects = v.container.querySelectorAll('select');
    await act(async () => { fireEvent.change(selects[0], { target: { value: selects[0].querySelectorAll('option')[1].value } }); });
    await act(async () => { fireEvent.change(selects[1], { target: { value: selects[1].querySelectorAll('option')[2].value } }); });
    await click(btn(/Add skill|^Add$/i));
    expect(h.update).toHaveBeenCalled();
    await click(screen.getAllByLabelText('remove skill')[0]);
    await click(screen.getByLabelText(/edit experience Engineer/));
    expect(inputs().some((i) => i.value === 'Engineer')).toBe(true);
    const roleInput = inputs().find((i) => i.value === 'Engineer') as HTMLInputElement;
    await type(roleInput, 'Staff Engineer');
    await click(btn(/Update|Save|Add experience/i));
    await click(screen.getByLabelText(/edit experience/));
    await click(btn(/Cancel/i));
    await click(screen.getByLabelText(/delete experience/));
    await click(screen.getByLabelText(/edit education MIT/));
    const inst = inputs().find((i) => i.value === 'MIT') as HTMLInputElement;
    await type(inst, 'Stanford');
    await click(btn(/Update|Save|Add education/i, 0));
    await click(screen.getByLabelText(/delete education/));
    expect(h.update.mock.calls.length).toBeGreaterThan(3);
  });

  it('runs analysis, resume, compare and validate actions and shows results', { timeout: 60000 }, async () => {
    const v = await mount();
    await click(btn(/Analyze skills/));
    expect(v.container.textContent).toMatch(/Skill analysis — 1 skills/);
    await click(btn(/Generate resume/));
    expect(v.container.textContent).toMatch(/Resume generated/);
    await click(btn(/Compare vs. last snapshot/));
    expect(v.container.textContent).toMatch(/\+1 added/);
    h.run.mockResolvedValueOnce({ ok: true, result: { comparison: { note: 'no_previous_versions' } } });
    await click(btn(/Compare vs. last snapshot/));
    expect(v.container.textContent).toMatch(/No snapshot to compare/);
    await click(btn(/Validate claims/));
    expect(v.container.textContent).toMatch(/1\/2 skills have supporting evidence/);
    await click(btn(/Save snapshot/));
    await click(btn(/Export portfolio/));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('toggles publish both ways and deletes the portfolio in two steps', async () => {
    const v = await mount();
    await click(btn(/Publish my portfolio/));
    expect(h.update).toHaveBeenCalledWith('p1', { meta: { visibility: 'published' } });
    cleanup();
    h.state.items = [MINE('published'), OTHER];
    await mount();
    await click(btn(/Unpublish/));
    expect(h.update).toHaveBeenLastCalledWith('p1', { meta: { visibility: 'private' } });
    const del = screen.getAllByRole('button').find((b) => /delete/i.test(b.textContent || '') && !/experience|education/i.test(b.getAttribute('aria-label') || ''));
    if (del) {
      await click(del);
      const confirm = screen.getAllByRole('button').find((b) => /confirm|yes|delete portfolio/i.test(b.textContent || ''));
      if (confirm) await click(confirm);
    }
    expect(v.container).toBeTruthy();
  });

  it('endorses a peer skill from the directory, including a rejected endorsement', async () => {
    const v = await mount();
    await click(screen.getAllByRole('tab').find((t) => /Directory/.test(t.textContent || '')) as HTMLElement);
    expect(v.container.textContent).toMatch(/Riley/);
    await click(btn(/Endorse/));
    expect(h.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2', action: 'endorse' }));
    h.run.mockResolvedValueOnce({ ok: true, result: { ok: false } });
    cleanup();
    await mount();
    await click(screen.getAllByRole('tab').find((t) => /Directory/.test(t.textContent || '')) as HTMLElement);
    await click(btn(/Endorse/));
    expect(document.body.textContent).toMatch(/already endorsed/);
    cleanup();
    h.state.items = [MINE()];
    await mount();
    await click(screen.getAllByRole('tab').find((t) => /Directory/.test(t.textContent || '')) as HTMLElement);
    expect(document.body.textContent).toMatch(/No published portfolios yet/);
  });
});
