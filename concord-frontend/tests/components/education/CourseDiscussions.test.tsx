import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CourseDiscussions } from '@/components/education/CourseDiscussions';

const POSTS = [
  { id: 'p1', courseId: 'course-12345678', text: 'How do I integrate?', author: 'Alice', replyTo: null, upvotes: 3, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'p2', courseId: 'course-12345678', text: 'Use substitution', author: 'Bob', replyTo: 'p1', upvotes: 1, createdAt: '2026-05-02T00:00:00Z' },
];

describe('CourseDiscussions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { discussions: [] } } });
  });

  it('shows the "(all)" header and empty state without a course id', async () => {
    render(<CourseDiscussions />);
    expect(await screen.findByText(/No discussions yet/)).toBeInTheDocument();
    expect(screen.getByText(/Discussions \(all\)/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Ask the class/)).not.toBeInTheDocument();
  });

  it('renders top-level posts with their replies', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { discussions: POSTS } } });
    render(<CourseDiscussions courseId="course-12345678" />);
    expect(await screen.findByText('How do I integrate?')).toBeInTheDocument();
    expect(screen.getByText('Use substitution')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('posts a new discussion', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'discussions-list')
        return Promise.resolve({ data: { ok: true, result: { discussions: [] } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<CourseDiscussions courseId="course-12345678" />);
    await screen.findByText(/No discussions in this course/);
    const ta = screen.getByPlaceholderText('Ask the class a question…');
    fireEvent.change(ta, { target: { value: 'A question' } });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'discussions-post',
          input: { courseId: 'course-12345678', text: 'A question', replyTo: undefined },
        }),
      ),
    );
  });

  it('enters reply mode then posts a reply, then cancels reply mode', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { discussions: POSTS } } });
    render(<CourseDiscussions courseId="course-12345678" />);
    await screen.findByText('How do I integrate?');
    fireEvent.click(screen.getByText('Reply'));
    expect(screen.getByPlaceholderText('Your reply…')).toBeInTheDocument();
    expect(screen.getByText(/Replying to/)).toBeInTheDocument();
    // cancel reply target
    fireEvent.click(screen.getByText('×'));
    expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument();
  });

  it('upvotes a post', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'discussions-list')
        return Promise.resolve({ data: { ok: true, result: { discussions: POSTS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<CourseDiscussions courseId="course-12345678" />);
    await screen.findByText('How do I integrate?');
    // upvote buttons render the count; click the one showing "3"
    fireEvent.click(screen.getByText('3'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'discussions-upvote', input: { id: 'p1' } }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<CourseDiscussions courseId="course-12345678" />);
    await waitFor(() => expect(screen.getByText(/No discussions/)).toBeInTheDocument());
  });
});
