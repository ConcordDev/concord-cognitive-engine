// VaultMySubmissionsFilter.test.tsx
//
// FIX-vault-002: 'Your submissions' had no search, filter, or sort —
// the vault header search covers lenses, not this list. The section
// now carries its own text filter, status filter, and sort over the
// caller's rows, with a match count and an honest empty state.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/KeepRecordActions', () => ({ KeepRecordActions: () => null }));
vi.mock('@/components/lens/recordKeep', () => ({ vaultSubmissionKeepRecord: () => null }));

import { MySubmissions, type MySubmission } from '@/components/vault/MySubmissions';

const ROWS: MySubmission[] = [
  { id: 'a', title: 'Bronze Study', status: 'admitted', workKind: 'sculpture', submittedAt: 100 },
  { id: 'b', title: 'River Poems', status: 'submitted', workKind: 'poetry', submittedAt: 300 },
  { id: 'c', title: 'Amber Study', status: 'declined', workKind: 'sculpture', submittedAt: 200, declineReason: 'Not yet.' },
];

const titles = () => within(screen.getByTestId('vault-my-list')).getAllByRole('button')
  .map((b) => b.textContent || '');

describe('Vault MySubmissions filter/sort (FIX-vault-002)', () => {
  afterEach(() => cleanup());

  it('filters by text and status, sorts, and reports the empty case', () => {
    render(React.createElement(MySubmissions, { submissions: ROWS, onWithdraw: async () => null }));

    // Default: newest first.
    expect(titles()[0]).toContain('River Poems');
    expect(screen.getByText('3 of 3')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter your submissions'), { target: { value: 'study' } });
    expect(titles().length).toBe(2);
    expect(screen.getByText('2 of 3')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'declined' } });
    expect(titles().length).toBe(1);
    expect(titles()[0]).toContain('Amber Study');

    fireEvent.change(screen.getByLabelText('Filter your submissions'), { target: { value: 'zzz' } });
    expect(screen.getByText('No submissions match your filter.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter your submissions'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Sort your submissions'), { target: { value: 'oldest' } });
    expect(titles()[0]).toContain('Bronze Study');
    fireEvent.change(screen.getByLabelText('Sort your submissions'), { target: { value: 'title' } });
    expect(titles()[0]).toContain('Amber Study');
  });
});
