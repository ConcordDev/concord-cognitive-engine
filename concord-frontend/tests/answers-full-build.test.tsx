/**
 * answers-full-build.test.tsx — build(answers) FE pins:
 * S3 (the Follow button initialises from the server-carried state),
 * S4 (ask-time duplicate steering), S1 (two-step soft delete with a
 * receipt + Undo, and no native dialog anywhere in the flow).
 *
 * lensRun is mocked with a small stateful Q&A workspace.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
const state = { subscribed: true, questionDeleted: false, answerDeleted: false };

const summary = {
  id: 'q1', title: 'How do I center a div?', tags: ['css'], votes: 3, views: 9,
  answerCount: 1, hasAccepted: false, bounty: 0,
  excerpt: 'I have tried flexbox but it is not working.',
  createdAt: '2026-10-30T00:00:00Z', subscribed: true,
};
const detail = {
  id: 'q1', title: 'How do I center a div?', body: 'I have tried flexbox but it is not working as expected.',
  bodyFormat: 'plain', tags: ['css'], votes: 3, views: 9,
  answers: [{
    id: 'a1', body: 'Use display flex on the parent element.', votes: 1, accepted: false,
    comments: [], authorId: 'user_a', createdAt: '2026-10-30T00:00:00Z',
  }],
  comments: [], acceptedAnswerId: null, bounty: 0, authorId: 'user_a',
};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push({ action, input });
    switch (action) {
      case 'question-list':
        return { data: { ok: true, result: { questions: state.questionDeleted ? [] : [{ ...summary, subscribed: state.subscribed }], count: state.questionDeleted ? 0 : 1 } } };
      case 'dashboard':
        return { data: { ok: true, result: { questions: 1, unanswered: 0, answered: 0, totalAnswers: 1, totalViews: 9, openBounties: 0, reputation: 28 } } };
      case 'user-reputation':
        return { data: { ok: true, result: { reputation: 28, badge: 'newcomer', questionsAsked: 1, answersPosted: 1, acceptedAnswers: 0 } } };
      case 'question-detail':
        return { data: { ok: true, result: { question: { ...detail, answers: state.answerDeleted ? [] : detail.answers } } } };
      case 'find-duplicates':
        return { data: { ok: true, result: { matches: [{ id: 'q9', title: 'How can I center a div', similarity: 0.79, answerCount: 2, hasAccepted: true }], count: 1 } } };
      case 'question-ask':
        return { data: { ok: true, result: { question: { id: 'q2' } } } };
      case 'question-delete':
        state.questionDeleted = true;
        return { data: { ok: true, result: { deleted: 'q1', deletedAt: '2026-11-05T00:00:00Z' } } };
      case 'question-restore':
        state.questionDeleted = false;
        return { data: { ok: true, result: { restored: 'q1' } } };
      case 'answer-delete':
        state.answerDeleted = true;
        return { data: { ok: true, result: { deleted: 'a1', deletedAt: '2026-11-05T00:00:00Z' } } };
      case 'answer-restore':
        state.answerDeleted = false;
        return { data: { ok: true, result: { restored: 'a1' } } };
      case 'question-subscribe':
        state.subscribed = !state.subscribed;
        return { data: { ok: true, result: { questionId: input.questionId, subscribed: state.subscribed } } };
      default:
        return { data: { ok: true, result: {} } };
    }
  }),
}));

import { AnswersQA, requestAskQuestion } from '@/components/answers/AnswersQA';

beforeEach(() => {
  calls.length = 0;
  state.subscribed = true;
  state.questionDeleted = false;
  state.answerDeleted = false;
});

describe('build(answers) — S3: Follow state', () => {
  it('the Follow button initialises from the server-carried subscribed flag', async () => {
    render(<AnswersQA />);
    const btn = await screen.findByRole('button', { name: 'Unfollow question' });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'question-subscribe')).toBe(true);
    });
    expect(await screen.findByRole('button', { name: 'Follow question' })).toBeTruthy();
  });
});

describe('build(answers) — S4: ask-time duplicate steering', () => {
  it('a similar existing question surfaces before posting; post-anyway still posts', async () => {
    requestAskQuestion();
    render(<AnswersQA />);
    const title = await screen.findByPlaceholderText(/Be specific/);
    fireEvent.change(title, { target: { value: 'How do I center a div in CSS?' } });
    const body = document.querySelector('textarea');
    expect(body).toBeTruthy();
    fireEvent.change(body as HTMLTextAreaElement, { target: { value: 'centering with flexbox is not working for me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post your question' }));
    const steering = await screen.findByTestId('ask-duplicate-steering');
    expect(steering.textContent).toContain('How can I center a div');
    expect(steering.textContent).toContain('79% similar');
    expect(calls.some((c) => c.action === 'question-ask')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Post anyway' }));
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'question-ask')).toBe(true);
    });
  });
});

describe('build(answers) — S1: two-step soft delete', () => {
  it('question delete confirms in-page (never window.confirm), receipts on the list, and Undo restores', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AnswersQA />);
    fireEvent.click(await screen.findByText('How do I center a div?'));
    fireEvent.click(await screen.findByTestId('q-delete'));
    const confirmRow = await screen.findByTestId('q-delete-confirm');
    expect(confirmRow.textContent).toContain('How do I center a div?');
    fireEvent.click(screen.getByTestId('q-delete-confirm-btn'));
    const notice = await screen.findByTestId('q-deleted-notice');
    expect(notice.textContent).toContain('Question deleted');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(calls.some((c) => c.action === 'question-delete')).toBe(true);
    fireEvent.click(screen.getByTestId('q-delete-undo'));
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'question-restore')).toBe(true);
    });
    confirmSpy.mockRestore();
  });

  it('answer delete is two-step and its receipt carries Undo', async () => {
    render(<AnswersQA />);
    fireEvent.click(await screen.findByText('How do I center a div?'));
    fireEvent.click(await screen.findByTestId('a-delete'));
    expect(await screen.findByTestId('a-delete-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('a-delete-confirm-btn'));
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'answer-delete')).toBe(true);
    });
    expect(await screen.findByText(/Answer deleted\./)).toBeTruthy();
    fireEvent.click(screen.getByTestId('a-delete-undo'));
    await waitFor(() => {
      expect(calls.some((c) => c.action === 'answer-restore')).toBe(true);
    });
  });
});
