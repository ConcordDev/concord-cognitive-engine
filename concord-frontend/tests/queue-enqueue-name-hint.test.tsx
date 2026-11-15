/**
 * FIX-queue-005 — Enqueue stayed disabled on an empty form with no
 * message: the job name is the form's only required field, and nothing
 * said so. The reason now sits beside the button while the name is
 * blank, and clears as soon as a name is typed.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { EnqueueForm } from '@/components/queue/EnqueueForm';

describe('FIX-queue-005 — the disabled Enqueue button states its reason', () => {
  it('shows the hint while the name is blank and enables with a name', () => {
    render(<EnqueueForm queues={['ingest']} busy={false} onEnqueue={vi.fn()} />);
    expect(screen.getByText('Give the job a name to enqueue it.')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /enqueue/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Job name'), { target: { value: 'nightly ingest' } });
    expect(screen.queryByText('Give the job a name to enqueue it.')).toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it('whitespace-only names still count as blank', () => {
    render(<EnqueueForm queues={['ingest']} busy={false} onEnqueue={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Job name'), { target: { value: '   ' } });
    expect(screen.getByText('Give the job a name to enqueue it.')).toBeTruthy();
  });
});
