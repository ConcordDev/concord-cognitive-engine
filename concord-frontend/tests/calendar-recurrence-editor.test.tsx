/** RecurrenceEditor — weekday toggles, monthly modes, end rules and the plain-English summary. */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

import { RecurrenceEditor, describeRecurrence, type UiRecurrence } from '@/components/calendar/RecurrenceEditor';

// Tuesday 20 October 2026 (the third Tuesday)
const START = new Date(2026, 9, 20, 9, 0);

function Harness({ onValue }: { onValue: (v: UiRecurrence | undefined) => void }) {
  const [v, setV] = useState<UiRecurrence | undefined>(undefined);
  return <RecurrenceEditor value={v} start={START} onChange={(n) => { setV(n); onValue(n); }} />;
}

describe('RecurrenceEditor', () => {
  it('weekly starts on the event weekday and toggles more days', () => {
    const seen = vi.fn();
    render(<Harness onValue={seen} />);
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ frequency: 'weekly', byDay: ['TU'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Thursday' }));
    expect(seen.mock.lastCall?.[0].byDay).toEqual(['TU', 'TH']);
    expect(screen.getByText('Weekly on Tuesday, Thursday')).toBeTruthy();
  });

  it('monthly offers the third Tuesday and ending after N times', () => {
    const seen = vi.fn();
    render(<Harness onValue={seen} />);
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'monthly' } });
    fireEvent.change(screen.getByLabelText('Monthly on'), { target: { value: 'nth' } });
    fireEvent.change(screen.getByLabelText('Repeat ends'), { target: { value: 'after' } });
    expect(seen.mock.lastCall?.[0]).toEqual(expect.objectContaining({ monthlyMode: 'nthWeekday', lastWeek: false, count: 10 }));
    expect(screen.getByText('Monthly on the third Tuesday, 10 times')).toBeTruthy();
  });

  it('describes intervals and end dates', () => {
    expect(describeRecurrence({ frequency: 'daily', interval: 2 }, START)).toBe('Every 2 days');
    expect(describeRecurrence({ frequency: 'monthly', interval: 1, monthlyMode: 'dayOfMonth' }, START)).toBe('Monthly on day 20');
  });
});
