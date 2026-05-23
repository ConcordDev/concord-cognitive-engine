import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AssignmentsBoard } from '@/components/education/AssignmentsBoard';

const ASSIGNMENTS = [
  {
    id: 'a1', courseId: 'course-12345678', title: 'Problem set 1',
    description: 'Solve five equations', dueAt: '2026-06-01', peerReviewCount: 3, maxPoints: 100,
  },
  {
    id: 'a2', courseId: 'course-12345678', title: 'Essay', description: '',
    dueAt: null, peerReviewCount: 0, maxPoints: 50,
  },
];

describe('AssignmentsBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { assignments: [] } } });
  });

  it('shows the empty state without a course id', async () => {
    render(<AssignmentsBoard />);
    expect(await screen.findByText(/No assignments yet/)).toBeInTheDocument();
  });

  it('shows course-scoped empty state with a course id', async () => {
    render(<AssignmentsBoard courseId="course-12345678" />);
    expect(await screen.findByText(/No assignments for this course/)).toBeInTheDocument();
  });

  it('renders assignments with peer-review and due badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { assignments: ASSIGNMENTS } } });
    render(<AssignmentsBoard courseId="course-12345678" />);
    expect(await screen.findByText('Problem set 1')).toBeInTheDocument();
    expect(screen.getByText('Essay')).toBeInTheDocument();
    expect(screen.getByText(/3×review/)).toBeInTheDocument();
    expect(screen.getByText('due 2026-06-01')).toBeInTheDocument();
    expect(screen.getByText('Solve five equations')).toBeInTheDocument();
  });

  it('opens the create form and creates an assignment', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'assignments-list')
        return Promise.resolve({ data: { ok: true, result: { assignments: [] } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<AssignmentsBoard courseId="course-12345678" />);
    await screen.findByText(/No assignments/);
    // the + button is the only icon button in the header
    const headerBtns = screen.getAllByRole('button');
    fireEvent.click(headerBtns[0]);
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'New HW' } });
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'desc' } });
    fireEvent.change(screen.getByPlaceholderText('Max pts'), { target: { value: '80' } });
    fireEvent.change(screen.getByPlaceholderText('Peer reviews'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'assignments-create',
          input: expect.objectContaining({ title: 'New HW', maxPoints: 80, peerReviewCount: 2 }),
        }),
      ),
    );
  });

  it('does not create with an empty title', async () => {
    render(<AssignmentsBoard courseId="course-12345678" />);
    await screen.findByText(/No assignments/);
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getByText('Create'));
    expect(lensRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignments-create' }),
    );
  });

  it('submits an assignment and cancels the submission form', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'assignments-list')
        return Promise.resolve({ data: { ok: true, result: { assignments: ASSIGNMENTS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<AssignmentsBoard courseId="course-12345678" />);
    await screen.findByText('Problem set 1');
    fireEvent.click(screen.getAllByText('+ Submit')[0]);
    const textarea = screen.getByPlaceholderText('Your submission…');
    fireEvent.change(textarea, { target: { value: 'my answer' } });
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'assignments-submit', input: { assignmentId: 'a1', text: 'my answer' } }),
      ),
    );
  });

  it('cancels the submission form without submitting', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { assignments: ASSIGNMENTS } } });
    render(<AssignmentsBoard courseId="course-12345678" />);
    await screen.findByText('Problem set 1');
    fireEvent.click(screen.getAllByText('+ Submit')[0]);
    expect(screen.getByPlaceholderText('Your submission…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Your submission…')).not.toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<AssignmentsBoard />);
    await waitFor(() => expect(screen.getByText(/No assignments/)).toBeInTheDocument());
  });
});
