// Audit fix sweep (PR #2356) — FIX-electrical-003: negative labor hours
// were saved and persisted. The job editor now refuses a negative (or
// non-numeric) labor hours / rate / material cost in the open: an inline
// message names the field, the form stays open with what was typed, and
// nothing is created until the amounts are 0 or more.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const create = vi.fn(() => Promise.resolve({}));
const update = vi.fn(() => Promise.resolve({}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create,
    update,
    remove: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/components/icons/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null }));
vi.mock('@/components/common/StickyDeleteConfirm', () => ({ StickyDeleteConfirm: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>,
  }),
}));

import { ElectricalDeskPanel } from '@/components/electrical/ElectricalDeskPanel';

beforeEach(() => {
  create.mockClear();
  update.mockClear();
});

describe('electrical job editor — negative amounts refused in the open', () => {
  it('rejects Labor Hours -1 with a message and saves once corrected', async () => {
    const view = render(<ElectricalDeskPanel mode="jobs" createOnMount />);
    const editor = view.container.querySelector('.fixed') as HTMLElement;
    expect(editor).toBeTruthy();
    // Name is the first text input in the editor.
    const name = editor.querySelectorAll('input')[0] as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Panel upgrade' } });

    const hours = editor.querySelector('input[type="number"]') as HTMLInputElement;
    expect(hours).toBeTruthy();
    expect(hours.min).toBe('0');
    fireEvent.change(hours, { target: { value: '-1' } });

    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    const alert = await view.findByRole('alert');
    expect(alert.textContent).toContain("Labor hours can't be negative");
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // The form stays open with the typed value.
    expect((editor.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('-1');

    fireEvent.change(hours, { target: { value: '2' } });
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const arg = create.mock.calls[0][0] as { data: { laborHours?: number } };
    expect(arg.data.laborHours).toBe(2);
  });
});
