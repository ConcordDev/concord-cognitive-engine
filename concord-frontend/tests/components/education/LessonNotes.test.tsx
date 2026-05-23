import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { LessonNotes } from '@/components/education/LessonNotes';

const NOTES = [
  { id: 'n1', lessonId: 'lesson-12345678', text: 'Important concept', videoTimestampSec: 125, createdAt: '2026-05-01T00:00:00Z' },
  { id: 'n2', lessonId: 'lesson-12345678', text: 'No timestamp note', videoTimestampSec: null, createdAt: '2026-05-02T00:00:00Z' },
];

describe('LessonNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { notes: [] } } });
  });

  it('shows the all-lessons empty state without a lesson id', async () => {
    render(<LessonNotes />);
    expect(await screen.findByText(/Pick a lesson to add notes/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Note about this lesson/)).not.toBeInTheDocument();
  });

  it('shows the lesson-scoped empty state and editor with a lesson id', async () => {
    render(<LessonNotes lessonId="lesson-12345678" />);
    expect(await screen.findByText(/No notes for this lesson/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Note about this lesson/)).toBeInTheDocument();
  });

  it('renders notes and formats the timestamp', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { notes: NOTES } } });
    render(<LessonNotes lessonId="lesson-12345678" />);
    expect(await screen.findByText('Important concept')).toBeInTheDocument();
    expect(screen.getByText('No timestamp note')).toBeInTheDocument();
    // 125 sec -> 2:05
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('saves a note with a timestamp', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'notes-list')
        return Promise.resolve({ data: { ok: true, result: { notes: [] } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<LessonNotes lessonId="lesson-12345678" />);
    await screen.findByText(/No notes/);
    fireEvent.change(screen.getByPlaceholderText(/Note about this lesson/), { target: { value: 'my note' } });
    fireEvent.change(screen.getByPlaceholderText('Video sec'), { target: { value: '90' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'notes-save',
          input: { lessonId: 'lesson-12345678', text: 'my note', timestampSec: 90 },
        }),
      ),
    );
  });

  it('does not save with an empty draft', async () => {
    render(<LessonNotes lessonId="lesson-12345678" />);
    await screen.findByText(/No notes/);
    fireEvent.click(screen.getByText('Save'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'notes-save' }));
  });

  it('deletes a note', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'notes-list')
        return Promise.resolve({ data: { ok: true, result: { notes: NOTES } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<LessonNotes lessonId="lesson-12345678" />);
    await screen.findByText('Important concept');
    const buttons = screen.getAllByRole('button');
    // the delete buttons are the trash buttons on each row
    fireEvent.click(buttons[buttons.length - 2]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'notes-delete' }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<LessonNotes lessonId="lesson-12345678" />);
    await waitFor(() => expect(screen.getByText(/No notes/)).toBeInTheDocument());
  });
});
