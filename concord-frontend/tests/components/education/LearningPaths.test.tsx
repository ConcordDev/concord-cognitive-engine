import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { LearningPaths } from '@/components/education/LearningPaths';

const COURSES = [{ id: 'c1', title: 'Algebra' }, { id: 'c2', title: 'Calculus' }];
const PATHS = [
  {
    id: 'p1', title: 'Math Track', description: 'Sequence',
    totalSteps: 2, completedSteps: 1, progressPct: 50, complete: false,
    steps: [
      { courseId: 'c1', courseTitle: 'Algebra', totalLessons: 5, completedLessons: 5, progressPct: 100, courseComplete: true, unlocked: true },
      { courseId: 'c2', courseTitle: 'Calculus', totalLessons: 8, completedLessons: 0, progressPct: 0, courseComplete: false, unlocked: false },
    ],
  },
];

function mockBy(map: Record<string, unknown>) {
  lensRun.mockImplementation((domain: string, action: string) =>
    Promise.resolve({ data: { ok: true, result: map[action] ?? {} } }));
}

describe('LearningPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('shows the empty paths state', async () => {
    render(<LearningPaths />);
    expect(await screen.findByText(/No learning paths yet/)).toBeInTheDocument();
  });

  it('renders paths with locked and complete steps', async () => {
    mockBy({ 'paths-list': { paths: PATHS }, 'courses-list': { courses: COURSES } });
    render(<LearningPaths />);
    expect(await screen.findByText('Math Track')).toBeInTheDocument();
    expect(screen.getByText('1. Algebra')).toBeInTheDocument();
    expect(screen.getByText('2. Calculus')).toBeInTheDocument();
    expect(screen.getByText(/locked until prior step complete/)).toBeInTheDocument();
  });

  it('opens the create form and toggles course picks', async () => {
    mockBy({ 'paths-list': { paths: [] }, 'courses-list': { courses: COURSES } });
    render(<LearningPaths />);
    await screen.findByText(/No learning paths yet/);
    fireEvent.click(screen.getByText('New path'));
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Algebra'));
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
    // deselect
    fireEvent.click(screen.getByText('Algebra'));
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
  });

  it('creates a path with a title and picked courses', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'paths-list') return Promise.resolve({ data: { ok: true, result: { paths: [] } } });
      if (action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<LearningPaths />);
    await screen.findByText(/No learning paths yet/);
    fireEvent.click(screen.getByText('New path'));
    fireEvent.change(screen.getByPlaceholderText(/Path title/), { target: { value: 'Track A' } });
    fireEvent.click(screen.getByText('Algebra'));
    fireEvent.click(screen.getByText('Create path'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('education', 'paths-create',
        expect.objectContaining({ title: 'Track A', courseIds: ['c1'] })),
    );
  });

  it('shows a no-courses message in the create form when none exist', async () => {
    mockBy({ 'paths-list': { paths: [] }, 'courses-list': { courses: [] } });
    render(<LearningPaths />);
    await screen.findByText(/No learning paths yet/);
    fireEvent.click(screen.getByText('New path'));
    expect(screen.getByText(/No courses exist yet/)).toBeInTheDocument();
  });

  it('deletes a path', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'paths-list') return Promise.resolve({ data: { ok: true, result: { paths: PATHS } } });
      if (action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { container } = render(<LearningPaths />);
    await screen.findByText('Math Track');
    const trash = Array.from(container.querySelectorAll('button')).find(b => b.className.includes('hover:text-red-400'))!;
    fireEvent.click(trash);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('education', 'paths-delete', { id: 'p1' }),
    );
  });

  it('reorders a step downward', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'paths-list') return Promise.resolve({ data: { ok: true, result: { paths: PATHS } } });
      if (action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const { container } = render(<LearningPaths />);
    await screen.findByText('Math Track');
    // arrow-down buttons are inside step rows; the first step's down arrow is enabled
    const downBtns = Array.from(container.querySelectorAll('button')).filter(b =>
      b.querySelector('svg') && !b.disabled && b.className.includes('disabled:opacity-20'));
    // first enabled reorder button is step-0 down arrow
    fireEvent.click(downBtns[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('education', 'paths-reorder',
        expect.objectContaining({ id: 'p1', courseIds: ['c2', 'c1'] })),
    );
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<LearningPaths />);
    expect(await screen.findByText(/No learning paths yet/)).toBeInTheDocument();
  });
});
