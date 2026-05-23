import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { CoursesCatalog } from '@/components/education/CoursesCatalog';

const COURSES = [
  {
    id: 'c1', title: 'Linear Algebra', description: 'Vectors and matrices', category: 'math',
    level: 'advanced', durationHours: 12, instructor: 'Dr. Lee', institution: 'MIT',
    kind: 'course', lessons: [{ id: 'l1' }, { id: 'l2' }], enrollmentCount: 5, rating: 4.7,
  },
  {
    id: 'c2', title: 'Intro Bio', description: 'Cells', category: 'science',
    level: 'beginner', durationHours: 0, instructor: '', institution: '',
    kind: 'guided_project', lessons: [], enrollmentCount: 0, rating: 0,
  },
];

describe('CoursesCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { courses: [], enrollments: [] } } });
  });

  it('shows empty state when no courses', async () => {
    render(<CoursesCatalog />);
    expect(await screen.findByText(/No courses\. Hit/)).toBeInTheDocument();
  });

  it('renders courses with level badges and ratings', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      return Promise.resolve({ data: { ok: true, result: { enrollments: [] } } });
    });
    render(<CoursesCatalog />);
    expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();
    expect(screen.getByText('advanced')).toBeInTheDocument();
    expect(screen.getByText('beginner')).toBeInTheDocument();
    expect(screen.getByText('4.7')).toBeInTheDocument();
    expect(screen.getByText('guided project')).toBeInTheDocument();
  });

  it('marks already-enrolled courses', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      return Promise.resolve({ data: { ok: true, result: { enrollments: [{ courseId: 'c1' }] } } });
    });
    render(<CoursesCatalog />);
    expect(await screen.findByText('Enrolled')).toBeInTheDocument();
  });

  it('enrolls in a course and calls onEnroll', async () => {
    const onEnroll = vi.fn();
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      if (spec.action === 'enrollments-list') return Promise.resolve({ data: { ok: true, result: { enrollments: [] } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<CoursesCatalog onEnroll={onEnroll} />);
    await screen.findByText('Linear Algebra');
    fireEvent.click(screen.getAllByText('Enroll')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'enrollments-enroll', input: { courseId: 'c1' } }),
      ),
    );
    expect(onEnroll).toHaveBeenCalledWith(COURSES[0]);
  });

  it('fires onSelect when a course body is clicked', async () => {
    const onSelect = vi.fn();
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      return Promise.resolve({ data: { ok: true, result: { enrollments: [] } } });
    });
    render(<CoursesCatalog onSelect={onSelect} />);
    fireEvent.click(await screen.findByText('Linear Algebra'));
    expect(onSelect).toHaveBeenCalledWith(COURSES[0]);
  });

  it('deletes a course optimistically', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: COURSES } } });
      if (spec.action === 'enrollments-list') return Promise.resolve({ data: { ok: true, result: { enrollments: [] } } });
      return Promise.resolve({ data: { ok: true } });
    });
    const { container } = render(<CoursesCatalog />);
    await screen.findByText('Linear Algebra');
    const trashBtns = container.querySelectorAll('button');
    // last button per row is the trash; click first trash by querying svg-bearing buttons
    fireEvent.click(Array.from(trashBtns).find(b => b.className.includes('hover:text-rose-400'))!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'courses-delete', input: { id: 'c1' } }),
      ),
    );
  });

  it('opens the create form and adds a course', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: [] } } });
      if (spec.action === 'enrollments-list') return Promise.resolve({ data: { ok: true, result: { enrollments: [] } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<CoursesCatalog />);
    await screen.findByText(/No courses/);
    fireEvent.click(screen.getByRole('button', { name: '' }) || screen.getAllByRole('button')[0]);
    // header + button is the only icon-only button before form opens
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'New Course' } });
    fireEvent.click(screen.getByText('Add course'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'courses-create' }),
      ),
    );
  });

  it('does not add a course with an empty title', async () => {
    render(<CoursesCatalog />);
    await screen.findByText(/No courses/);
    fireEvent.click(screen.getAllByRole('button')[0]);
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add course'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'courses-create' }));
  });

  it('searches courses on Enter and renders matches', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'courses-search') return Promise.resolve({ data: { ok: true, result: { matches: COURSES } } });
      if (spec.action === 'courses-list') return Promise.resolve({ data: { ok: true, result: { courses: [] } } });
      return Promise.resolve({ data: { ok: true, result: { enrollments: [] } } });
    });
    render(<CoursesCatalog />);
    await screen.findByText(/No courses/);
    const search = screen.getByPlaceholderText('Search courses…');
    fireEvent.change(search, { target: { value: 'algebra' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'courses-search', input: { query: 'algebra' } }),
      ),
    );
    expect(await screen.findByText('Linear Algebra')).toBeInTheDocument();
  });

  it('refetches when the category filter changes', async () => {
    render(<CoursesCatalog />);
    await screen.findByText(/No courses/);
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'math' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'courses-list', input: { category: 'math' } }),
      ),
    );
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<CoursesCatalog />);
    expect(await screen.findByText(/No courses/)).toBeInTheDocument();
  });
});
