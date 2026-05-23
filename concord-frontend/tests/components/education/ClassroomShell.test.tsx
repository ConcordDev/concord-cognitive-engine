import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { ClassroomShell, type ClassroomCourse } from '@/components/education/ClassroomShell';

const COURSE = (over: Partial<ClassroomCourse> = {}): ClassroomCourse => ({
  id: 'c1', title: 'Intro to Calculus', instructor: 'Dr. Liu',
  progressPct: 45, totalLessons: 20, completedLessons: 9, category: 'math', ...over,
});

describe('ClassroomShell', () => {
  it('renders empty enrolled-courses state and zero streak caption', () => {
    render(
      <ClassroomShell
        streak={0} energyPoints={0} level={1} pointsToday={0}
        proficientSkills={0} totalSkills={0} certificates={0}
        enrolledCourses={[]}
      />,
    );
    expect(screen.getByText('Start today!')).toBeInTheDocument();
    expect(screen.getByText(/No courses in progress/)).toBeInTheDocument();
  });

  it('renders streak singular vs plural caption', () => {
    const { rerender } = render(
      <ClassroomShell
        streak={1} energyPoints={100} level={2} pointsToday={50}
        proficientSkills={3} totalSkills={10} certificates={1}
        enrolledCourses={[]}
      />,
    );
    expect(screen.getByText('1 day in a row')).toBeInTheDocument();
    rerender(
      <ClassroomShell
        streak={5} energyPoints={100} level={2} pointsToday={50}
        proficientSkills={3} totalSkills={10} certificates={1}
        enrolledCourses={[]}
      />,
    );
    expect(screen.getByText('5 days in a row')).toBeInTheDocument();
  });

  it('shows goal-hit banner when pointsToday >= dailyGoalPoints', () => {
    render(
      <ClassroomShell
        streak={3} energyPoints={500} level={4} pointsToday={250}
        dailyGoalPoints={200}
        proficientSkills={5} totalSkills={20} certificates={2}
        enrolledCourses={[]}
      />,
    );
    expect(screen.getByText(/Goal hit/)).toBeInTheDocument();
  });

  it('does not show goal-hit banner below the goal', () => {
    render(
      <ClassroomShell
        streak={3} energyPoints={500} level={4} pointsToday={50}
        dailyGoalPoints={200}
        proficientSkills={5} totalSkills={20} certificates={2}
        enrolledCourses={[]}
      />,
    );
    expect(screen.queryByText(/Goal hit/)).not.toBeInTheDocument();
  });

  it('renders enrolled courses and fires onSelectCourse', () => {
    const onSelect = vi.fn();
    render(
      <ClassroomShell
        streak={2} energyPoints={300} level={3} pointsToday={100}
        proficientSkills={4} totalSkills={12} certificates={1}
        enrolledCourses={[COURSE(), COURSE({ id: 'c2', title: 'Linear Algebra', instructor: '' })]}
        onSelectCourse={onSelect}
      />,
    );
    expect(screen.getByText('Intro to Calculus')).toBeInTheDocument();
    // second course has no instructor -> falls back to category
    expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Intro to Calculus'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('renders recommended courses and fires select; handles missing callback', () => {
    render(
      <ClassroomShell
        streak={2} energyPoints={300} level={3} pointsToday={100}
        proficientSkills={4} totalSkills={12} certificates={1}
        enrolledCourses={[COURSE()]}
        recommendedCourses={[COURSE({ id: 'r1', title: 'Statistics', instructor: '' })]}
      />,
    );
    expect(screen.getByText('Recommended for you')).toBeInTheDocument();
    // no onSelectCourse passed -> click should not throw
    fireEvent.click(screen.getByText('Statistics'));
    fireEvent.click(screen.getByText('Intro to Calculus'));
  });

  it('omits recommended section when none provided', () => {
    render(
      <ClassroomShell
        streak={2} energyPoints={300} level={3} pointsToday={100}
        proficientSkills={4} totalSkills={12} certificates={1}
        enrolledCourses={[COURSE()]}
      />,
    );
    expect(screen.queryByText('Recommended for you')).not.toBeInTheDocument();
  });
});
