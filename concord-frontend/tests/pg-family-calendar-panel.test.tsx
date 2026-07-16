// PgFamilyCalendarPanel — general shared family calendar (Wave 4 gap
// closure, docs/WAVE4_INVENTORY.md row 262: "No general shared family
// calendar (pediatric appointments only)"). Pins: real fetched render
// (family-wide + child-tagged events), create flow, update flow, delete
// flow, ics-export action, and honest empty/loading/error states — mirrors
// the RxAppointmentsPanel/PgAppointmentsPanel testing shape (mock
// @/lib/api/client's lensRun, render the panel directly, assert on real DOM
// + real call args).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PgFamilyCalendarPanel } from '@/components/parenting/PgFamilyCalendarPanel';

const CHILD = { id: 'kid_1', name: 'Nia', ageDisplay: '3y' };

const FAMILY_EVENT = {
  id: 'evt_1', title: 'School closed — teacher in-service', startAt: '2099-04-01',
  endAt: null, allDay: true, childId: null, category: 'school', location: null, notes: null,
};
const CHILD_EVENT = {
  id: 'evt_2', title: 'Soccer practice', startAt: '2099-04-05T16:00', endAt: null,
  allDay: false, childId: 'kid_1', category: 'activity', location: 'City Park', notes: null,
};

function mockListResponses(events: unknown[], nextUp: unknown = events[0] ?? null, children = [CHILD]) {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain === 'parenting' && action === 'event-list') {
      return Promise.resolve({ data: { ok: true, result: { events, count: events.length, nextUp } } });
    }
    if (domain === 'parenting' && action === 'child-list') {
      return Promise.resolve({ data: { ok: true, result: { children, count: children.length } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('PgFamilyCalendarPanel', () => {
  it('LOADING: shows role=status before the fetch resolves', async () => {
    let resolveList: (v: unknown) => void = () => {};
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'event-list') return new Promise((res) => { resolveList = res; });
      return Promise.resolve({ data: { ok: true, result: { children: [] } } });
    });
    render(<PgFamilyCalendarPanel />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolveList({ data: { ok: true, result: { events: [], count: 0, nextUp: null } } });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('POPULATED: renders real fetched events — family-wide (no child) and child-tagged', async () => {
    mockListResponses([FAMILY_EVENT, CHILD_EVENT], FAMILY_EVENT);
    render(<PgFamilyCalendarPanel />);
    // FAMILY_EVENT's title appears twice — once in the "Next up" banner (it IS
    // the real nextUp from the macro response) and once in the list itself.
    await waitFor(() => expect(screen.getAllByText('School closed — teacher in-service').length).toBe(2));
    expect(screen.getByText('Soccer practice')).toBeInTheDocument();
    // family-wide event has no child badge
    expect(screen.getByText('family-wide')).toBeInTheDocument();
    // child-tagged event shows the real child's name, not a fabricated one
    // (scoped to the <span> badge — "Nia" also appears as a <option> in the
    // child-tagging <select>, which is a separate, legitimate render).
    expect(screen.getByText('Nia', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('City Park', { exact: false })).toBeInTheDocument();
    // "Next up" banner reflects the real nextUp from the macro response
    expect(screen.getByText('Next up')).toBeInTheDocument();
  });

  it('EMPTY: honest empty state when there are no events', async () => {
    mockListResponses([]);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('No upcoming family events.')).toBeInTheDocument());
  });

  it('ERROR: a failed event-list degrades to the honest empty state — no crash, no fabricated events', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'event-list') return Promise.resolve({ data: { ok: false, result: null, error: 'parenting store offline' } });
      return Promise.resolve({ data: { ok: true, result: { children: [] } } });
    });
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('No upcoming family events.')).toBeInTheDocument());
    expect(screen.queryByText('School closed — teacher in-service')).not.toBeInTheDocument();
  });

  it('CREATE FLOW: filling the form and submitting calls event-add with the real fields, then refetches', async () => {
    mockListResponses([], null, [CHILD]);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('No upcoming family events.')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Title \(e\.g\./), { target: { value: 'Family trip' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2099-06-01' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'travel' } });

    const addSpy = vi.fn().mockResolvedValue({ data: { ok: true, result: { event: { ...FAMILY_EVENT, id: 'evt_new', title: 'Family trip', category: 'travel', startAt: '2099-06-01' } } } });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'event-add') return addSpy(domain, action, input);
      if (action === 'event-list') return Promise.resolve({ data: { ok: true, result: { events: [{ ...FAMILY_EVENT, id: 'evt_new', title: 'Family trip', category: 'travel', startAt: '2099-06-01' }], count: 1, nextUp: null } } });
      if (action === 'child-list') return Promise.resolve({ data: { ok: true, result: { children: [CHILD] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    fireEvent.click(screen.getByRole('button', { name: /Add event/i }));

    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('parenting', 'event-add', expect.objectContaining({
      title: 'Family trip', startAt: '2099-06-01', category: 'travel', childId: undefined,
    })));
    await waitFor(() => expect(screen.getByText('Family trip')).toBeInTheDocument());
  });

  it('CREATE FLOW: a blank title shows an honest validation error, no macro call', async () => {
    mockListResponses([]);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('No upcoming family events.')).toBeInTheDocument());
    lensRunMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Add event/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Event title is required/i));
    expect(lensRunMock).not.toHaveBeenCalledWith('parenting', 'event-add', expect.anything());
  });

  it('CREATE FLOW: a child can be tagged via the child picker', async () => {
    mockListResponses([], null, [CHILD]);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('No upcoming family events.')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Title \(e\.g\./), { target: { value: 'Piano lesson' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2099-07-01' } });
    fireEvent.change(screen.getByLabelText('Child'), { target: { value: 'kid_1' } });

    const addSpy = vi.fn().mockResolvedValue({ data: { ok: true, result: { event: { ...CHILD_EVENT, id: 'evt_3', title: 'Piano lesson' } } } });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'event-add') return addSpy(domain, action, input);
      if (action === 'event-list') return Promise.resolve({ data: { ok: true, result: { events: [], count: 0, nextUp: null } } });
      if (action === 'child-list') return Promise.resolve({ data: { ok: true, result: { children: [CHILD] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Add event/i }));
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('parenting', 'event-add', expect.objectContaining({ childId: 'kid_1' })));
  });

  it('UPDATE FLOW: editing an event and saving calls event-update with the real id + changed fields', async () => {
    mockListResponses([FAMILY_EVENT], null);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('School closed — teacher in-service')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Edit event'));
    expect(screen.getByText('Edit event')).toBeInTheDocument();
    const titleInput = screen.getByPlaceholderText(/Title \(e\.g\./) as HTMLInputElement;
    expect(titleInput.value).toBe('School closed — teacher in-service');
    fireEvent.change(titleInput, { target: { value: 'School closed (updated)' } });

    const updateSpy = vi.fn().mockResolvedValue({ data: { ok: true, result: { event: { ...FAMILY_EVENT, title: 'School closed (updated)' } } } });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'event-update') return updateSpy(domain, action, input);
      if (action === 'event-list') return Promise.resolve({ data: { ok: true, result: { events: [{ ...FAMILY_EVENT, title: 'School closed (updated)' }], count: 1, nextUp: null } } });
      if (action === 'child-list') return Promise.resolve({ data: { ok: true, result: { children: [CHILD] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('parenting', 'event-update', expect.objectContaining({
      id: 'evt_1', title: 'School closed (updated)',
    })));
    await waitFor(() => expect(screen.getByText('School closed (updated)')).toBeInTheDocument());
  });

  it('DELETE FLOW: clicking delete calls event-delete with the real id and refetches', async () => {
    mockListResponses([FAMILY_EVENT], null);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('School closed — teacher in-service')).toBeInTheDocument());

    const deleteSpy = vi.fn().mockResolvedValue({ data: { ok: true, result: { deleted: 'evt_1' } } });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'event-delete') return deleteSpy(domain, action, input);
      if (action === 'event-list') return Promise.resolve({ data: { ok: true, result: { events: [], count: 0, nextUp: null } } });
      if (action === 'child-list') return Promise.resolve({ data: { ok: true, result: { children: [CHILD] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getByLabelText('Delete event'));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('parenting', 'event-delete', { id: 'evt_1' }));
    await waitFor(() => expect(screen.getByText('No upcoming family events.')).toBeInTheDocument());
  });

  it('ICS EXPORT: clicking "Export .ics" calls event-ical and triggers a real Blob download', async () => {
    mockListResponses([FAMILY_EVENT], null);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('School closed — teacher in-service')).toBeInTheDocument());

    const icalSpy = vi.fn().mockResolvedValue({
      data: { ok: true, result: { ical: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR', filename: 'parenting-family-events.ics', eventCount: 1 } },
    });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'event-ical') return icalSpy(domain, action, input);
      if (action === 'event-list') return Promise.resolve({ data: { ok: true, result: { events: [FAMILY_EVENT], count: 1, nextUp: FAMILY_EVENT } } });
      if (action === 'child-list') return Promise.resolve({ data: { ok: true, result: { children: [CHILD] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    const createSpy = vi.spyOn(window.URL, 'createObjectURL');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByText('Export .ics'));

    await waitFor(() => expect(icalSpy).toHaveBeenCalledWith('parenting', 'event-ical', {}));
    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(clickSpy).toHaveBeenCalled();
  });

  it('ICS EXPORT: an honest error surfaces via role=alert when nothing to export (no fabricated download)', async () => {
    mockListResponses([FAMILY_EVENT], null);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('School closed — teacher in-service')).toBeInTheDocument());

    const icalFail = vi.fn().mockResolvedValue({ data: { ok: false, result: null, error: 'no upcoming events to export' } });
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'event-ical') return icalFail(domain, action);
      if (action === 'event-list') return Promise.resolve({ data: { ok: true, result: { events: [FAMILY_EVENT], count: 1, nextUp: FAMILY_EVENT } } });
      if (action === 'child-list') return Promise.resolve({ data: { ok: true, result: { children: [CHILD] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    const createSpy = vi.spyOn(window.URL, 'createObjectURL');
    fireEvent.click(screen.getByText('Export .ics'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no upcoming events to export'));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('"Show all events" toggle re-fetches without the upcoming scope filter', async () => {
    mockListResponses([FAMILY_EVENT], null);
    render(<PgFamilyCalendarPanel />);
    await waitFor(() => expect(screen.getByText('School closed — teacher in-service')).toBeInTheDocument());

    lensRunMock.mockClear();
    const PAST_EVENT = { ...FAMILY_EVENT, id: 'evt_past', title: 'Past picnic', startAt: '2000-01-01' };
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'event-list') {
        expect(input).toEqual({});
        return Promise.resolve({ data: { ok: true, result: { events: [FAMILY_EVENT, PAST_EVENT], count: 2, nextUp: FAMILY_EVENT } } });
      }
      if (action === 'child-list') return Promise.resolve({ data: { ok: true, result: { children: [CHILD] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getByText('Show all events'));
    await waitFor(() => expect(screen.getByText('Past picnic')).toBeInTheDocument());
  });
});
