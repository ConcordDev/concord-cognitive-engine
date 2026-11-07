// Behaviour coverage for the mentor directory (search, register/edit/withdraw, profile, request,
// review) and the goal workspace (create, open, check in, status changes, chart).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf } from '../../../tests/helpers/exercise';

const h = vi.hoisted(() => ({ lensRun: vi.fn(), notify: vi.fn(), user: { id: 'me' } as { id: string } | null }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => h.lensRun(...a) }));
vi.mock('@/lib/mentorship/program-stats', () => ({ notifyMentorshipProgramChanged: () => h.notify() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/components/viz', () => ({ ChartKit: ({ data }: { data: unknown[] }) => <div>chart:{data.length}</div> }));
vi.mock('@/components/mentorship/ReviewHistogram', () => ({ ReviewHistogram: ({ count }: { count: number }) => <div>hist:{count}</div> }));

const MENTOR = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Mentor ${id}`, headline: 'Staff engineer', bio: 'Helps people grow', skills: ['go', 'design'], experienceYears: 8, availability: 'weekly', capacity: 3, hourlyFocus: 'career', rating: 4.4, reviewCount: 5, menteeCount: 1, listed: true, hasAccount: true, ...over });
const GOAL = (id: string, status: string, progress: number, checkIns: unknown[] = []) => ({ id, partnerId: 'p', title: `Goal ${id}`, detail: 'Ship it', targetDate: '2027-01-01', progress, status, checkIns, createdAt: '2026-03-01T00:00:00Z' });
let mentors = [MENTOR('me'), MENTOR('m2', { menteeCount: 3, hasAccount: false })];
function resultFor(action: string): unknown {
  switch (action) {
    case 'mentor-directory': return { mentors, skills: ['go', 'design'] };
    case 'mentor-profile': return { mentor: MENTOR('m2', { hasAccount: false }), reviews: [{ id: 'r1', authorName: 'Ann', rating: 5, comment: 'Superb', tags: ['kind'], createdAt: '2026-03-01' }], openSlots: 2 };
    case 'review-list': return { histogram: [{ star: 5, count: 3 }], avgRating: 4.6, count: 3 };
    case 'goal-list': return { goals: [GOAL('g1', 'active', 45, [{ id: 'c1', note: 'Started', progress: 20, at: '2026-03-02T10:00:00Z' }]), GOAL('g2', 'done', 100), GOAL('g3', 'paused', 85)], count: 3, active: 1, done: 1, avgProgress: 77 };
    case 'goal-checkin': return { goal: GOAL('g1', 'done', 100, [{ id: 'c1', note: 'Started', progress: 20, at: '2026-03-02T10:00:00Z' }]) };
    default: return { ok: true };
  }
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => h.lensRun.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 25)); }); };
const btn = (re: RegExp, nth = 0) => screen.getAllByRole('button', { name: re })[nth];
const ph = (re: RegExp, nth = 0) => screen.getAllByPlaceholderText(re)[nth];
const type = async (el: Element, value: string) => { await act(async () => { fireEvent.change(el, { target: { value } }); }); };
afterEach(() => cleanup());
beforeEach(() => {
  h.user = { id: 'me' }; mentors = [MENTOR('me'), MENTOR('m2', { menteeCount: 3, hasAccount: false })];
  h.notify.mockClear(); h.lensRun.mockReset();
  h.lensRun.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('MentorDirectoryPanel', () => {
  const mount = async () => { const { MentorDirectoryPanel } = await import('../MentorDirectoryPanel'); const v = render(<MentorDirectoryPanel />); await settle(); return v; };

  it('lists mentors and filters by search, skill and sort', async () => {
    const v = await mount();
    expect(v.container.textContent).toMatch(/Mentor me/);
    expect(v.container.textContent).toMatch(/Dataset profile/);
    await type(ph(/Search mentors/), 'eng');
    const selects = v.container.querySelectorAll('select');
    await act(async () => { fireEvent.change(selects[0], { target: { value: 'go' } }); });
    await act(async () => { fireEvent.change(selects[1], { target: { value: 'experience' } }); });
    await settle();
    expect(h.lensRun.mock.calls.some((c) => (c[2] as { sort?: string })?.sort === 'experience')).toBe(true);
  });

  it('opens a profile, sends a request (validated) and posts a review', async () => {
    const v = await mount();
    await click(screen.getByText('Mentor m2'));
    expect(v.container.textContent).toMatch(/Superb/);
    expect(v.container.textContent).toMatch(/Open slots/);
    expect(v.container.textContent).toMatch(/hist:3/);
    expect((btn(/Send request/) as HTMLButtonElement).disabled).toBe(true);
    const names = screen.getAllByPlaceholderText('Your name');
    await type(names[0], 'Zed'); await type(ph(/^Topic/), 'Careers'); await type(ph(/Message to the mentor/), 'Please mentor me');
    await type(ph(/Goals \(comma/), 'ship, learn');
    await click(btn(/Send request/));
    expect(sent()).toContain('request-send');
    expect(window.alert).toHaveBeenCalled();
    await type(names[1], 'Zed');
    const sel = v.container.querySelector('select') as HTMLSelectElement;
    await act(async () => { fireEvent.change(sel, { target: { value: '4' } }); });
    await type(ph(/^Comment/), 'Good'); await type(ph(/Tags \(comma/), 'kind, sharp');
    await click(btn(/Post review/));
    expect(sent()).toContain('review-add');
    h.lensRun.mockImplementation(async (...a: unknown[]) => ['request-send', 'review-add'].includes(actionOf(a)) ? { data: { ok: false, error: 'rejected' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await type(names[0], 'Zed');
    await click(btn(/Post review/));
    expect(v.container.textContent).toMatch(/rejected/);
    await click(btn(/Back to directory/));
    expect(v.container.textContent).toMatch(/Mentor Directory/);
  });

  it('edits an existing profile, saves it, and withdraws with confirmation', async () => {
    const v = await mount();
    await click(btn(/Edit mentor profile/));
    expect((ph(/Display name/) as HTMLInputElement).value).toBe('Mentor me');
    await type(ph(/Headline/), 'Principal engineer');
    await click(btn(/Publish profile/));
    expect(sent()).toContain('mentor-register');
    await click(btn(/Edit mentor profile/));
    await click(btn(/Withdraw mentor profile/));
    await click(btn(/Keep profile/));
    await click(btn(/Withdraw mentor profile/));
    await click(btn(/Confirm withdraw/));
    expect(sent()).toContain('mentor-withdraw');
    expect(v.container.textContent).toMatch(/Mentor profile withdrawn/);
  });

  it('registers a brand-new mentor, validating the name, and handles load failure', async () => {
    mentors = [];
    h.user = { id: 'newbie' };
    h.lensRun.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: actionOf(a) === 'mentor-profile' ? {} : resultFor(actionOf(a)) } }));
    const v = await mount();
    expect(v.container.textContent).toMatch(/No mentors found/);
    await click(btn(/List as mentor/));
    await click(btn(/Publish profile/));
    expect(v.container.textContent).toMatch(/Mentor name is required/);
    await type(ph(/Display name/), 'Newbie');
    await type(ph(/Skills \(comma/), 'rust, c');
    await click(btn(/Publish profile/));
    expect(sent()).toContain('mentor-register');
    await click(btn(/List as mentor/));
    await click(btn(/Cancel/));
    cleanup();
    h.user = null;
    h.lensRun.mockImplementation(async () => ({ data: { ok: false, error: 'directory down' } }));
    const bad = await mount();
    expect(bad.container.textContent).toMatch(/directory down/);
    await click(btn(/List as mentor/));
  });
});

describe('MentorshipGoalsPanel', () => {
  const mount = async () => { const { MentorshipGoalsPanel } = await import('../MentorshipGoalsPanel'); const v = render(<MentorshipGoalsPanel />); await settle(); return v; };

  it('shows the rollup, creates a goal (validated), and handles failures', async () => {
    const v = await mount();
    expect(v.container.textContent).toMatch(/Goal g1/);
    expect(v.container.textContent).toMatch(/77%/);
    await click(btn(/New goal/));
    await click(btn(/Create goal/));
    expect(v.container.textContent).toMatch(/Goal title is required/);
    await type(ph(/Goal title/), 'Learn Rust');
    await type(ph(/^Detail/), 'Ownership first');
    await type(ph(/Partner ID/), 'p7');
    const date = v.container.querySelector('input[type="date"]') as HTMLInputElement;
    await type(date, '2027-06-01');
    await click(btn(/Create goal/));
    expect(sent()).toContain('goal-create');
    expect(h.notify).toHaveBeenCalled();
    h.lensRun.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'goal-create' ? { data: { ok: false, error: 'create refused' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await click(btn(/New goal/));
    await type(ph(/Goal title/), 'Another');
    await click(btn(/Create goal/));
    expect(v.container.textContent).toMatch(/create refused/);
  });

  it('opens a goal, logs a check-in, changes status, and reports failures', async () => {
    const v = await mount();
    await click(screen.getByText('Goal g1'));
    expect(v.container.textContent).toMatch(/Progress trend/);
    expect(v.container.textContent).toMatch(/chart:1/);
    await type(ph(/What progress did you make/), 'Finished chapter 4');
    const range = v.container.querySelector('input[type="range"]') as HTMLInputElement;
    await act(async () => { fireEvent.change(range, { target: { value: '70' } }); });
    await click(btn(/^Log$/));
    expect(h.lensRun.mock.calls.find((c) => actionOf(c) === 'goal-checkin')?.[2]).toEqual(expect.objectContaining({ goalId: 'g1', progress: 70 }));
    await click(btn(/^paused$/));
    await click(btn(/^active$/));
    h.lensRun.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'goal-checkin' ? { data: { ok: false, error: 'checkin refused' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await click(btn(/^Log$/));
    expect(v.container.textContent).toMatch(/checkin refused/);
    await click(btn(/^paused$/));
    await click(btn(/Back to goals/));
    expect(v.container.textContent).toMatch(/Goal Workspace/);
  });

  it('shows the empty state and a load error', async () => {
    h.lensRun.mockImplementation(async () => ({ data: { ok: true, result: {} } }));
    const v = await mount();
    expect(v.container.textContent).toMatch(/No goals yet/);
    cleanup();
    h.lensRun.mockImplementation(async () => ({ data: { ok: false, error: 'goals down' } }));
    const bad = await mount();
    expect(bad.container.textContent).toMatch(/goals down/);
  });
});
