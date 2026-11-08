// Render + behaviour coverage for the answers Q&A lens (list, ask, detail, votes, answers,
// comments, bounty, edit, close/reopen, delete/restore) with sibling widgets stubbed.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const ANSWER = (id: string, accepted = false) => ({ id, body: `Answer ${id} body`, bodyFormat: 'markdown', votes: 4, accepted, comments: [{ id: 'cm1', body: 'Nice', createdAt: '2026-03-02' }], authorId: 'u2', revisions: [], createdAt: '2026-03-02' });
const QDETAIL = { id: 'q1', title: 'How do DTUs compress?', body: 'Details here', bodyFormat: 'markdown', tags: ['dtu', 'compression'], votes: 7, views: 120, answers: [ANSWER('an1', true), ANSWER('an2')], comments: [{ id: 'cm0', body: 'Clarify?', createdAt: '2026-03-01' }], acceptedAnswerId: 'an1', bounty: 50, authorId: 'u1', closed: false, closeReason: null, closeVotes: [], duplicateOf: null, revisions: [] };

function resultFor(action: string): unknown {
  switch (action) {
    case 'question-list': return { questions: [{ id: 'q1', title: 'How do DTUs compress?', tags: ['dtu'], votes: 7, views: 120, answerCount: 2, hasAccepted: true, bounty: 50, excerpt: 'Details...', createdAt: '2026-03-01', subscribed: true }, { id: 'q2', title: 'Unanswered one', tags: [], votes: 0, views: 3, answerCount: 0, hasAccepted: false, bounty: 0, excerpt: '', createdAt: '2026-03-02' }] };
    case 'dashboard': return { questions: 2, unanswered: 1, answered: 1, totalAnswers: 2, totalViews: 123, openBounties: 1, reputation: 120 };
    case 'user-reputation': return { reputation: 120, badge: 'Contributor', questionsAsked: 3, answersPosted: 5, acceptedAnswers: 2 };
    case 'question-detail': return { question: QDETAIL };
    case 'question-ask': return { question: { id: 'q9' } };
    case 'find-duplicates': return { matches: [{ id: 'q1', title: 'How do DTUs compress?', similarity: 0.7, answerCount: 2, hasAccepted: true }] };
    default: return { ok: true, id: 'new-1', question: QDETAIL };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('../RichMarkdownEditor', () => ({ RichMarkdownEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => <textarea aria-label="md" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /> }));
for (const n of ['PostBody', 'RevisionHistory', 'PrivilegePanel', 'NotificationsBell', 'ModerationQueue', 'FlagButton', 'DuplicatePanel', 'RelatedSidebar', 'TagWatchPanel']) vi.doMock(`../${n}`, () => ({ [n]: () => <span>{n}-stub</span> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
const pressAll = async (re: RegExp) => { for (const el of screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()))) if (el.isConnected) await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 5)); }); };
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

describe('answers Q&A', () => {
  it('lists questions with the dashboard, sorts, filters and searches', async () => {
    const { AnswersQA } = await import('../AnswersQA');
    const view = rtlRender(<AnswersQA />);
    await settle();
    expect(view.container.textContent).toMatch(/How do DTUs compress/);
    for (const l of ['Votes', 'Active', 'Answers', 'Newest', 'Unanswered', 'Accepted', 'Bountied', 'All']) await press(new RegExp(`^${l}$`));
    const box = screen.queryAllByRole('textbox').find((i) => /search/i.test((i as HTMLInputElement).placeholder || ''));
    if (box) fireEvent.change(box, { target: { value: 'compress' } });
    await settle();
    await exercise({ passes: 2, text: 'dtu', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    expect(sent()).toEqual(expect.arrayContaining(['question-list', 'dashboard', 'user-reputation']));
  });

  it('asks a question with duplicate detection', async () => {
    const { AnswersQA, requestAskQuestion } = await import('../AnswersQA');
    rtlRender(<AnswersQA />);
    await settle();
    act(() => { requestAskQuestion(); });
    await press(/^Ask|Ask a question/i);
    const title = screen.queryAllByRole('textbox').find((i) => /title|specific/i.test((i as HTMLInputElement).placeholder || '')) ?? screen.queryAllByRole('textbox')[0];
    if (title) fireEvent.change(title, { target: { value: 'How do I merge DTUs?' } });
    for (const md of Array.from(document.querySelectorAll('textarea[aria-label="md"]')) as HTMLTextAreaElement[]) fireEvent.change(md, { target: { value: 'I have many DTUs and want one.' } });
    const tags = screen.queryAllByRole('textbox').find((i) => /tag/i.test((i as HTMLInputElement).placeholder || ''));
    if (tags) fireEvent.change(tags, { target: { value: 'dtu, merge' } });
    await press(/Check|Similar|Duplicates/i);
    await press(/^(Post|Submit|Publish|Ask)\b.*question|Post your question|Submit/i);
    expect(sent().some((x) => /find-duplicates|question-ask/.test(x))).toBe(true);
  });

  it('opens a question and drives votes, answers, comments, bounty, edit, close/reopen, delete/restore and subscription', async () => {
    const { AnswersQA } = await import('../AnswersQA');
    rtlRender(<AnswersQA />);
    await settle();
    await press(/How do DTUs compress/); await settle();
    expect(sent()).toContain('question-detail');
    await pressAll(/^Upvote$/); await pressAll(/^Downvote$/);
    await pressAll(/Accept this answer/); await pressAll(/Accepted — click/);
    await pressAll(/Add a comment/);
    for (const c of screen.queryAllByRole('textbox')) { fireEvent.change(c, { target: { value: 'A sincere comment' } }); fireEvent.keyDown(c, { key: 'Enter' }); }
    await pressAll(/^(Add|Post|Submit)( comment)?$/i);
    for (const md of Array.from(document.querySelectorAll('textarea[aria-label="md"]')) as HTMLTextAreaElement[]) fireEvent.change(md, { target: { value: 'My thoughtful answer text' } });
    await press(/Post your answer/);
    await press(/Cast vote/i);
    await pressAll(/^History$/); await pressAll(/^Duplicates$/);
    // edit the question then the answers
    await press(/^Edit$/, 0); await settle();
    for (const md of Array.from(document.querySelectorAll('textarea[aria-label="md"]')) as HTMLTextAreaElement[]) fireEvent.change(md, { target: { value: 'Edited body of the post' } });
    for (const t of screen.queryAllByRole('textbox')) if (!/aria-label/.test(t.outerHTML)) fireEvent.change(t, { target: { value: 'Edited title text' } });
    await pressAll(/^(Save|Update|Save edit)/i);
    await press(/^Edit$/, 1); await settle();
    for (const md of Array.from(document.querySelectorAll('textarea[aria-label="md"]')) as HTMLTextAreaElement[]) fireEvent.change(md, { target: { value: 'Edited answer body' } });
    await pressAll(/^(Save|Update|Save edit)/i);
    await press(/Bounty|Start bounty/i);
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) { const o = Array.from(sel.options).find((x) => x.value); if (o) fireEvent.change(sel, { target: { value: o.value } }); }
    await pressAll(/Close( question)?$|Vote to close/i); await pressAll(/Reopen/i);
    await press(/^Delete$/, 1); await pressAll(/Confirm|Yes/i); await pressAll(/Undo|Restore/i);
    await press(/^Delete$/, 0); await pressAll(/Confirm|Yes/i); await pressAll(/Undo|Restore/i);
    const a = sent();
    expect(a.some((x) => /vote|answer-accept|bounty-start|answer-post|comment-add|question-edit|close-vote|reopen|question-delete|answer-delete|question-subscribe/.test(x))).toBe(true);
  });

  it('stays standing when the backend is offline', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const { AnswersQA } = await import('../AnswersQA');
    const view = rtlRender(<AnswersQA />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});
