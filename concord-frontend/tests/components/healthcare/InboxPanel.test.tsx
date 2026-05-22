import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { InboxPanel } from '@/components/healthcare/InboxPanel';

const patients = [{ id: 'p1', firstName: 'Jane', lastName: 'Roe', mrn: 'MRN-1' }];
const messages = [
  { id: 'm1', number: 'M-1', patientId: 'p1', direction: 'from_patient', subject: 'Question',
    body: 'I have a question', sentAt: '2026-05-01T10:00:00Z', readAt: null, sender: 'patient' },
  { id: 'm2', number: 'M-2', patientId: 'p1', direction: 'to_patient', subject: 'Reply',
    body: 'Here is your answer', sentAt: '2026-05-02T10:00:00Z', readAt: '2026-05-02T11:00:00Z', sender: 'clinician' },
];

describe('InboxPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { messages: [], patients: [] } } });
    render(<InboxPanel />);
    await waitFor(() => expect(screen.getByText(/Inbox empty/)).toBeInTheDocument());
  });

  it('renders unread and all-messages sections', async () => {
    lensRun.mockImplementation((arg: { action: string }) =>
      Promise.resolve({ data: { ok: true, result:
        arg.action === 'messages-list' ? { messages } : { patients } } }),
    );
    render(<InboxPanel />);
    await waitFor(() => expect(screen.getByText('Unread from patients')).toBeInTheDocument());
    expect(screen.getByText('All messages')).toBeInTheDocument();
    expect(screen.getByText('I have a question')).toBeInTheDocument();
    expect(screen.getByText('Here is your answer')).toBeInTheDocument();
    expect(screen.getByText(/1 unread/)).toBeInTheDocument();
  });

  it('marks an unread message as read', async () => {
    lensRun.mockImplementation((arg: { action: string }) =>
      Promise.resolve({ data: { ok: true, result:
        arg.action === 'messages-list' ? { messages } : { patients } } }),
    );
    render(<InboxPanel />);
    await waitFor(() => screen.getByText('I have a question'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Mark read'));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'messages-mark-read')).toBe(true));
  });

  it('toggles the compose form and does not send when fields are blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { messages: [], patients } } });
    render(<InboxPanel />);
    await waitFor(() => screen.getByText(/Inbox empty/));
    fireEvent.click(screen.getByRole('button', { name: /Compose/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Send to patient/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('sends a message when patient and body are provided', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { messages: [], patients } } });
    render(<InboxPanel />);
    await waitFor(() => screen.getByText(/Inbox empty/));
    fireEvent.click(screen.getByRole('button', { name: /Compose/ }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByPlaceholderText('Message body'), { target: { value: 'Hello there' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Send to patient/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'messages-send')).toBe(true));
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<InboxPanel />);
    await waitFor(() => expect(screen.getByText(/Inbox empty/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('falls back to the patientId when the patient is not in the directory', async () => {
    lensRun.mockImplementation((arg: { action: string }) =>
      Promise.resolve({ data: { ok: true, result:
        arg.action === 'messages-list'
          ? { messages: [{ ...messages[1], patientId: 'unknown-id' }] }
          : { patients } } }),
    );
    render(<InboxPanel />);
    await waitFor(() => expect(screen.getByText('unknown-id')).toBeInTheDocument());
  });
});
