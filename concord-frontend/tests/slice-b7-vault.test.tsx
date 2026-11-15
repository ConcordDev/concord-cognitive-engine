/**
 * FIX-vault-001 — MySubmissions gains Edit (before review) and Remove
 * (once withdrawn). Pins:
 *  - A `submitted` work offers Edit; the form pre-fills the title and
 *    Save sends the new title through onEdit.
 *  - An `under_review` work offers no Edit control.
 *  - A `withdrawn` work offers Remove; the confirm fires onRemove.
 *  - An `admitted` work offers neither Edit nor Remove.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { MySubmissions, type MySubmission } from '@/components/vault/MySubmissions';

const BASE: MySubmission = {
  id: 'vsub_1',
  title: 'A small study of light',
  status: 'submitted',
  workKind: 'other',
  description: 'A study in one movement.',
  body: 'The light arrives before the sentence does.',
  submittedAt: 1700000000,
};

const onWithdraw = vi.fn(async () => null);
const onEdit = vi.fn(async () => null);
const onRemove = vi.fn(async () => null);

beforeEach(() => {
  onWithdraw.mockClear();
  onEdit.mockClear();
  onRemove.mockClear();
});

function select(sub: MySubmission) {
  render(
    <MySubmissions
      submissions={[sub]}
      onWithdraw={onWithdraw}
      onEdit={onEdit}
      onRemove={onRemove}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /A small study of light/ }));
}

describe('FIX-vault-001 submission edit and remove', () => {
  it('a submitted work can be edited before review', async () => {
    select(BASE);
    fireEvent.click(screen.getByRole('button', { name: 'Edit this work' }));
    const title = screen.getByLabelText('Edit submission title') as HTMLInputElement;
    expect(title.value).toBe('A small study of light');
    fireEvent.change(title, { target: { value: 'A larger study of light' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith(
        'vsub_1',
        expect.objectContaining({ title: 'A larger study of light' }),
      ),
    );
  });

  it('a work under review offers no Edit control', () => {
    select({ ...BASE, status: 'under_review' });
    expect(screen.queryByRole('button', { name: 'Edit this work' })).not.toBeInTheDocument();
  });

  it('a withdrawn work can be removed behind a confirm', async () => {
    select({ ...BASE, status: 'withdrawn' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove this work' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('vsub_1'));
  });

  it('an admitted work offers neither Edit nor Remove', () => {
    select({ ...BASE, status: 'admitted' });
    expect(screen.queryByRole('button', { name: 'Edit this work' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
