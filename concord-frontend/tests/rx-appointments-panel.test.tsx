// RxAppointmentsPanel — doctor/provider appointment tracker (Wave 4 gap
// closure, docs/WAVE4_INVENTORY.md "No doctor-appointment manager/calendar").
// Pins: real fetched render, schedule flow, status-update flow, delete flow,
// the med-link picker, and honest empty/error states — mirrors the
// RxRefillsPanel/RxRemindersPanel testing shape (mock @/lib/api/client's
// lensRun, render the panel directly, assert on real DOM + real call args).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { RxAppointmentsPanel } from '@/components/pharmacy/RxAppointmentsPanel';

const UPCOMING = {
  id: 'appt_1', providerName: 'Dr. Smith', providerType: 'primary_care',
  dateTime: '2099-01-15T09:00:00.000Z', reason: 'Annual physical',
  location: '123 Clinic Ave', phone: '555-0100',
  relatedMedId: null, relatedMedName: null, notes: null, status: 'scheduled', when: 'upcoming',
};
const PAST = {
  id: 'appt_2', providerName: 'Dr. Jones', providerType: 'specialist',
  dateTime: '2000-01-01T09:00:00.000Z', reason: 'Follow-up',
  location: null, phone: null,
  relatedMedId: 'med_1', relatedMedName: 'Lisinopril', notes: 'Went well', status: 'completed', when: 'past',
};
const MEDS = [{ id: 'med_1', name: 'Lisinopril' }, { id: 'med_2', name: 'Atorvastatin' }];

function mockListResponses(appointments: unknown[], meds = MEDS) {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain === 'pharmacy' && action === 'appointment-list') {
      return Promise.resolve({ data: { ok: true, result: { appointments, count: appointments.length } } });
    }
    if (domain === 'pharmacy' && action === 'med-list') {
      return Promise.resolve({ data: { ok: true, result: { medications: meds, count: meds.length } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

const onChange = vi.fn();

beforeEach(() => {
  lensRunMock.mockReset();
  onChange.mockReset();
});

describe('RxAppointmentsPanel', () => {
  it('LOADING: shows a role=status indicator before the fetch resolves', async () => {
    let resolveList: (v: unknown) => void = () => {};
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'appointment-list') return new Promise((res) => { resolveList = res; });
      return Promise.resolve({ data: { ok: true, result: { medications: [] } } });
    });
    const { container } = render(<RxAppointmentsPanel onChange={onChange} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    resolveList({ data: { ok: true, result: { appointments: [] } } });
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeFalsy());
  });

  it('POPULATED: renders real fetched upcoming + past appointments with linked medication', async () => {
    mockListResponses([UPCOMING, PAST]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/Dr\. Smith/)).toBeInTheDocument());
    expect(screen.getByText(/Annual physical/)).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Jones/)).toBeInTheDocument();
    expect(screen.getByText(/Linked medication: Lisinopril/)).toBeInTheDocument();
    expect(screen.getByText(/Went well/)).toBeInTheDocument();
    // both section headers present
    expect(screen.getByText('Upcoming appointments')).toBeInTheDocument();
    expect(screen.getByText('Past appointments')).toBeInTheDocument();
  });

  it('EMPTY: honest empty state in both sections when there are no appointments', async () => {
    mockListResponses([]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument());
    expect(screen.getByText('No past appointments.')).toBeInTheDocument();
  });

  it('ERROR: a failed appointment-list surfaces role=alert with the real error text', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (action === 'appointment-list') return Promise.resolve({ data: { ok: false, result: null, error: 'pharmacy store offline' } });
      return Promise.resolve({ data: { ok: true, result: { medications: [] } } });
    });
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('pharmacy store offline')).toBeInTheDocument();
  });

  it('SCHEDULE FLOW: filling the form and submitting calls appointment-add with the real fields, then refetches', async () => {
    mockListResponses([]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    fireEvent.change(screen.getByPlaceholderText('Provider name (e.g. Dr. Smith)'), { target: { value: 'Dr. New' } });
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2099-05-01T10:00' } });
    fireEvent.change(screen.getByPlaceholderText(/Reason/), { target: { value: 'Checkup' } });

    // After the add succeeds, the component refetches — the add itself is
    // spied on directly so we assert the real call args, and the list/med
    // branches keep the refetch honest (real medication + the newly-added
    // appointment, not a fabricated echo).
    const addSpy = vi.fn().mockResolvedValue({ data: { ok: true, result: { appointment: { ...UPCOMING, id: 'appt_new', providerName: 'Dr. New' } } } });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'appointment-add') return addSpy(domain, action, input);
      if (action === 'appointment-list') return Promise.resolve({ data: { ok: true, result: { appointments: [{ ...UPCOMING, id: 'appt_new', providerName: 'Dr. New' }] } } });
      if (action === 'med-list') return Promise.resolve({ data: { ok: true, result: { medications: MEDS } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    fireEvent.click(screen.getByRole('button', { name: /Schedule appointment/i }));

    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('pharmacy', 'appointment-add', expect.objectContaining({ providerName: 'Dr. New', reason: 'Checkup' })));
    const [, , addInput] = addSpy.mock.calls[0];
    expect(typeof addInput.dateTime).toBe('string');
    await waitFor(() => expect(screen.getByText(/Dr\. New/)).toBeInTheDocument());
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('SCHEDULE FLOW: a blank provider name shows an honest validation error, no macro call', async () => {
    mockListResponses([]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    lensRunMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Schedule appointment/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Provider name is required/i));
    expect(lensRunMock).not.toHaveBeenCalledWith('pharmacy', 'appointment-add', expect.anything());
  });

  it('UPDATE FLOW: "Mark completed" calls appointment-update with status=completed and refetches', async () => {
    mockListResponses([UPCOMING]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/Dr\. Smith/)).toBeInTheDocument());

    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'appointment-update') {
        expect(input).toEqual({ id: 'appt_1', status: 'completed' });
        return Promise.resolve({ data: { ok: true, result: { appointment: { ...UPCOMING, status: 'completed', when: 'past' } } } });
      }
      if (action === 'appointment-list') return Promise.resolve({ data: { ok: true, result: { appointments: [{ ...UPCOMING, status: 'completed', when: 'past' }] } } });
      if (action === 'med-list') return Promise.resolve({ data: { ok: true, result: { medications: MEDS } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    fireEvent.click(screen.getByLabelText('Mark completed'));
    await waitFor(() => expect(screen.getByText('Past appointments')).toBeInTheDocument());
    await waitFor(() => expect(within(screen.getByText('Past appointments').closest('section')!).getByText(/Dr\. Smith/)).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('UPDATE FLOW: a terminal (completed) appointment does not show status-change buttons, only notes + delete', async () => {
    mockListResponses([PAST]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/Dr\. Jones/)).toBeInTheDocument());
    expect(screen.queryByLabelText('Mark completed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cancel appointment')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Add notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete appointment')).toBeInTheDocument();
  });

  it('DELETE FLOW: clicking delete calls appointment-delete with the real id and refetches', async () => {
    mockListResponses([UPCOMING]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText(/Dr\. Smith/)).toBeInTheDocument());

    const deleteSpy = vi.fn().mockResolvedValue({ data: { ok: true, result: { deleted: true, id: 'appt_1' } } });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'appointment-delete') return deleteSpy(domain, action, input);
      if (action === 'appointment-list') return Promise.resolve({ data: { ok: true, result: { appointments: [] } } });
      if (action === 'med-list') return Promise.resolve({ data: { ok: true, result: { medications: MEDS } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    fireEvent.click(screen.getByLabelText('Delete appointment'));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('pharmacy', 'appointment-delete', { id: 'appt_1' }));
    await waitFor(() => expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument());
    expect(onChange).toHaveBeenCalled();
  });

  it('MED-LINK PICKER: the schedule form lists real fetched medications, defaulting to "Not medication-related"', async () => {
    mockListResponses([]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    const select = screen.getByLabelText('Related medication') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getByText('Not medication-related')).toBeInTheDocument();
    expect(within(select).getByText('Lisinopril')).toBeInTheDocument();
    expect(within(select).getByText('Atorvastatin')).toBeInTheDocument();
  });

  it('MED-LINK PICKER: selecting a medication is included as relatedMedId on appointment-add', async () => {
    mockListResponses([]);
    render(<RxAppointmentsPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    fireEvent.change(screen.getByPlaceholderText('Provider name (e.g. Dr. Smith)'), { target: { value: 'Dr. Linked' } });
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2099-05-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Related medication'), { target: { value: 'med_2' } });

    const addSpy = vi.fn().mockResolvedValue({ data: { ok: true, result: { appointment: { ...UPCOMING } } } });
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'appointment-add') return addSpy(domain, action, input);
      if (action === 'appointment-list') return Promise.resolve({ data: { ok: true, result: { appointments: [] } } });
      if (action === 'med-list') return Promise.resolve({ data: { ok: true, result: { medications: MEDS } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Schedule appointment/i }));
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith('pharmacy', 'appointment-add', expect.objectContaining({ relatedMedId: 'med_2' })));
  });
});
