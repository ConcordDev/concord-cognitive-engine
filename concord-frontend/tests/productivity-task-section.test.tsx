import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const lensRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ lensRun }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/components/productivity/ProductivityTodayPanel', () => ({ ProductivityTodayPanel: () => <div>Today content</div> }));
vi.mock('@/components/productivity/ProductivityTasksPanel', () => ({ ProductivityTasksPanel: () => <div>Tasks content</div> }));
vi.mock('@/components/productivity/ProductivityHabitsPanel', () => ({ ProductivityHabitsPanel: () => <div>Habits content</div> }));
vi.mock('@/components/productivity/ProductivityFocusPanel', () => ({ ProductivityFocusPanel: () => <div>Focus content</div> }));
vi.mock('@/components/productivity/ProductivityQuickAddPanel', () => ({ ProductivityQuickAddPanel: () => <div>QuickAdd content</div> }));
vi.mock('@/components/productivity/ProductivityRemindersPanel', () => ({ ProductivityRemindersPanel: () => <div>Reminders content</div> }));
vi.mock('@/components/productivity/ProductivityFiltersPanel', () => ({ ProductivityFiltersPanel: () => <div>Filters content</div> }));
vi.mock('@/components/productivity/ProductivityCalendarPanel', () => ({ ProductivityCalendarPanel: () => <div>Calendar content</div> }));
vi.mock('@/components/productivity/ProductivityCollabPanel', () => ({ ProductivityCollabPanel: () => <div>Collab content</div> }));

import { ProductivityTaskSection } from '@/components/productivity/ProductivityTaskSection';

describe('ProductivityTaskSection', () => {
  it('loads real dashboard stats and navigates every workspace', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { result: { activeTasks: 3, dueToday: 1, projects: 2, habits: 4, completedToday: 5, focusMinutesToday: 30 } } })
      .mockResolvedValueOnce({ data: { result: { completedWeek: 8, streak: 2 } } });
    const changed = vi.fn();
    render(<ProductivityTaskSection onTabChange={changed} />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    expect(await screen.findByText('2-day streak')).toBeInTheDocument();
    for (const label of ['Quick add', 'Tasks', 'Filters', 'Calendar', 'Reminders', 'Collaborate', 'Habits', 'Focus', 'Today']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
    }
    expect(changed).toHaveBeenCalledTimes(9);
  });
});
