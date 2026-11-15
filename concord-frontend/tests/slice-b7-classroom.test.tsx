import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-classroom-007: quizzes, submissions and stream
// announcements gain deletes behind confirmations.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/components/viz', () => ({
  TimelineView: () => <div data-testid="timeline" />,
  ChartKit: () => null,
}));

import { ClassroomWorkspace } from '@/components/classroom/ClassroomWorkspace';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); });

describe('classroom deletes (FIX-classroom-007)', () => {
  it('stream: only announcements carry a delete; the confirm fires stream-delete', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'stream-list') return ok({
        stream: [
          { id: 'e1', kind: 'announcement', text: 'Field trip Friday', cohortId: 1, createdAt: '2026-11-10T00:00:00Z' },
          { id: 'e2', kind: 'assignment', text: 'Assignment posted: Essay 1', cohortId: 1, createdAt: '2026-11-10T01:00:00Z' },
        ],
      });
      return ok({});
    });
    render(<ClassroomWorkspace cohortId={1} />);
    expect(await screen.findByText('Field trip Friday')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Delete announcement' })).toHaveLength(1);
    expect(screen.getByText('Assignment posted: Essay 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }));
    expect(calls('stream-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete announcement' }));
    await waitFor(() => expect(calls('stream-delete')).toHaveLength(1));
    expect(calls('stream-delete')[0][2]).toMatchObject({ entryId: 'e1' });
  });

  it('quizzes: Delete quiz fires quiz-delete behind the confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'stream-list') return ok({ stream: [] });
      if (action === 'quiz-list') return ok({
        quizzes: [{ id: 'q1', cohortId: 1, title: 'Pop quiz', questions: [], questionCount: 1, totalPoints: 1, attemptCount: 0 }],
      });
      return ok({});
    });
    render(<ClassroomWorkspace cohortId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: /Quizzes/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete quiz Pop quiz' }));
    expect(calls('quiz-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete quiz' }));
    await waitFor(() => expect(calls('quiz-delete')).toHaveLength(1));
    expect(calls('quiz-delete')[0][2]).toMatchObject({ quizId: 'q1' });
  });

  it('submissions: Delete fires submission-delete behind the confirm', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'stream-list') return ok({ stream: [] });
      if (action === 'assignment-list') return ok({
        assignments: [{ id: 'a1', cohortId: 1, title: 'Essay 1', instructions: '', points: 100, dueAt: null, topic: null, submissionCount: 1, gradedCount: 0 }],
        other: [],
      });
      if (action === 'submission-list') return ok({
        submissions: [{ id: 's1', assignmentId: 'a1', studentId: 'stu1', content: 'My essay', status: 'submitted', grade: null }],
      });
      return ok({});
    });
    render(<ClassroomWorkspace cohortId={1} />);
    fireEvent.click(await screen.findByRole('button', { name: /Classwork/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete submission by stu1' }));
    expect(calls('submission-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete submission' }));
    await waitFor(() => expect(calls('submission-delete')).toHaveLength(1));
    expect(calls('submission-delete')[0][2]).toMatchObject({ submissionId: 's1' });
  });
});
