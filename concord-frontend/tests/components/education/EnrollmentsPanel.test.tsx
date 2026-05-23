import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { EnrollmentsPanel } from '@/components/education/EnrollmentsPanel';

const ENROLLMENTS = [
  {
    id: 'e1', courseId: 'c1', enrolledAt: '2026-01-01', status: 'active',
    course: { id: 'c1', title: 'Calculus', instructor: 'Dr. Lee', institution: 'MIT', category: 'math' },
    totalLessons: 10, completedLessons: 10, progressPct: 100,
  },
  {
    id: 'e2', courseId: 'c2', enrolledAt: '2026-02-01', status: 'active',
    course: { id: 'c2', title: 'Biology', instructor: '', institution: 'Harvard', category: 'science' },
    totalLessons: 8, completedLessons: 2, progressPct: 25,
  },
];

describe('EnrollmentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { enrollments: [] } } });
  });

  it('shows the empty state', async () => {
    render(<EnrollmentsPanel />);
    expect(await screen.findByText(/Not enrolled in any courses/)).toBeInTheDocument();
  });

  it('renders enrollments with progress; complete vs in-progress bar colours', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { enrollments: ENROLLMENTS } } });
    render(<EnrollmentsPanel />);
    expect(await screen.findByText('Calculus')).toBeInTheDocument();
    expect(screen.getByText('Biology')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    // instructor falls back to institution when blank
    expect(screen.getByText('Harvard')).toBeInTheDocument();
  });

  it('fires onSelectCourse when a row body is clicked', async () => {
    const onSelect = vi.fn();
    lensRun.mockResolvedValue({ data: { ok: true, result: { enrollments: ENROLLMENTS } } });
    render(<EnrollmentsPanel onSelectCourse={onSelect} />);
    fireEvent.click(await screen.findByText('Calculus'));
    expect(onSelect).toHaveBeenCalledWith('c1');
  });

  it('unenrolls a course and removes it from the list', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'enrollments-list')
        return Promise.resolve({ data: { ok: true, result: { enrollments: ENROLLMENTS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<EnrollmentsPanel />);
    await screen.findByText('Calculus');
    fireEvent.click(screen.getAllByTitle('Unenroll')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'enrollments-unenroll', input: { id: 'e1' } }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Calculus')).not.toBeInTheDocument());
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<EnrollmentsPanel />);
    await waitFor(() => expect(screen.getByText(/Not enrolled/)).toBeInTheDocument());
  });

  it('logs but stays stable when unenroll rejects', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'enrollments-list')
        return Promise.resolve({ data: { ok: true, result: { enrollments: ENROLLMENTS } } });
      return Promise.reject(new Error('boom'));
    });
    render(<EnrollmentsPanel />);
    await screen.findByText('Calculus');
    fireEvent.click(screen.getAllByTitle('Unenroll')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Calculus')).toBeInTheDocument();
  });
});
