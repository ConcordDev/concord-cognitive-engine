/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// CoursesCatalog now renders the shared multi-tenant course catalog
// (server/domains/education.js, migration 363 — every published course
// from every author, plus the caller's own drafts). These tests pin the
// frontend half of that fix: a non-author sees a course but NOT its
// mutation affordances (delete / add lesson), while the real author does —
// matching the backend's ownership gate on courses-delete/lessons-create.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'tester', email: '', role: 'user' }, isLoading: false, isAuthenticated: true }),
}));

import { CoursesCatalog } from './CoursesCatalog';

const ok = <T,>(result: T) => ({ data: { ok: true, result } });

function routeCourses(handlers: Record<string, unknown | ((input: Record<string, unknown>) => unknown)>) {
  lensRun.mockImplementation((spec: { domain: string; action: string; input: Record<string, unknown> }) => {
    const action = spec.action;
    if (action in handlers) {
      const h = handlers[action];
      return Promise.resolve(typeof h === 'function' ? (h as (i: Record<string, unknown>) => unknown)(spec.input) : h);
    }
    return Promise.reject(new Error(`unexpected action ${action}`));
  });
}

const otherAuthorCourse = {
  id: 'course_other', authorId: 'someone-else', title: 'Someone Else\'s Course',
  description: 'Not mine', category: 'general', level: 'beginner', durationHours: 3,
  instructor: 'Dr. Other', institution: '', kind: 'course', status: 'published',
  lessons: [], enrollmentCount: 5, rating: 0,
};
const myCourse = {
  id: 'course_mine', authorId: 'me', title: 'My Own Course',
  description: 'Mine', category: 'general', level: 'beginner', durationHours: 2,
  instructor: 'Me', institution: '', kind: 'course', status: 'published',
  lessons: [], enrollmentCount: 0, rating: 0,
};

describe('CoursesCatalog — multi-tenant catalog ownership gating', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows another author\'s course but hides delete + add-lesson affordances for a non-owner', async () => {
    routeCourses({
      'courses-list': ok({ courses: [otherAuthorCourse], total: 1 }),
      'enrollments-list': ok({ enrollments: [] }),
      'courses-get': ok({ course: { ...otherAuthorCourse, lessons: [] } }),
    });

    render(<CoursesCatalog />);
    await waitFor(() => expect(screen.getByText('Someone Else\'s Course')).toBeInTheDocument());

    // No delete button for a course this user doesn't own.
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
    // No "Yours" badge either.
    expect(screen.queryByText('Yours')).not.toBeInTheDocument();

    // Expand the course — the lesson-authoring affordance should read
    // "only X can add lessons" instead of offering "+ Add lesson".
    fireEvent.click(screen.getByText('Someone Else\'s Course'));
    await waitFor(() => expect(screen.getByText(/can add lessons/i)).toBeInTheDocument());
    expect(screen.queryByText('+ Add lesson')).not.toBeInTheDocument();
  });

  it('shows delete + add-lesson affordances and a "Yours" badge for the real author', async () => {
    routeCourses({
      'courses-list': ok({ courses: [myCourse], total: 1 }),
      'enrollments-list': ok({ enrollments: [] }),
      'courses-get': ok({ course: { ...myCourse, lessons: [] } }),
    });

    render(<CoursesCatalog />);
    await waitFor(() => expect(screen.getByText('My Own Course')).toBeInTheDocument());

    expect(screen.getByText('Yours')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete')).toBeInTheDocument();

    fireEvent.click(screen.getByText('My Own Course'));
    await waitFor(() => expect(screen.getByText('+ Add lesson')).toBeInTheDocument());
  });

  it('the "Mine" toggle re-queries courses-list with mine:true', async () => {
    routeCourses({
      'courses-list': ok({ courses: [myCourse, otherAuthorCourse], total: 2 }),
      'enrollments-list': ok({ enrollments: [] }),
    });

    render(<CoursesCatalog />);
    await waitFor(() => expect(screen.getByText('My Own Course')).toBeInTheDocument());

    lensRun.mockClear();
    routeCourses({
      'courses-list': ok({ courses: [myCourse], total: 1 }),
      'enrollments-list': ok({ enrollments: [] }),
    });
    fireEvent.click(screen.getByTitle('Show only courses you authored'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'education', action: 'courses-list', input: expect.objectContaining({ mine: true }),
    })));
  });
});
