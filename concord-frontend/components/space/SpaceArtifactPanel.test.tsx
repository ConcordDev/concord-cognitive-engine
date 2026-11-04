/**
 * SpaceArtifactPanel — the six-view CRUD template (R2 space pass build).
 * Pins: S1 create opens a form and creates WITH a name; Edit updates in
 * place; S3 delete is two-step; F9 the search input stays mounted while a
 * search refetch is loading (it used to unmount, dropping focus to <body>
 * where the letter view-shortcuts ate the remaining keystrokes); the copy
 * uses hand-written nouns, never a generated plural.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensDataState: {
  items: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();
const create = vi.fn(() => Promise.resolve({}));
const update = vi.fn(() => Promise.resolve({}));
const remove = vi.fn(() => Promise.resolve({}));
const runMutateAsync = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const addToast = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    error: lensDataState.error,
    refetch,
    create,
    update,
    remove,
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: runMutateAsync, isPending: false }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => () => undefined }));
vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { SpaceArtifactPanel } from './SpaceArtifactPanel';

const MISSION = {
  id: 'art_1',
  title: 'Artemis III',
  data: { status: 'prelaunch', launchVehicle: 'SLS', launchDate: '2027-02-01', objective: 'Crewed lunar landing' },
  meta: {},
  createdAt: '2026-06-27',
  updatedAt: '2026-06-27',
};

beforeEach(() => {
  vi.clearAllMocks();
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
});

describe('SpaceArtifactPanel (space build)', () => {
  it('S1: New Mission opens a form; saving creates the record WITH its name', async () => {
    render(<SpaceArtifactPanel view="missions" />);
    fireEvent.click(screen.getByRole('button', { name: /New Mission/ }));
    const nameInput = screen.getByPlaceholderText(/Artemis III/);
    fireEvent.change(nameInput, { target: { value: 'Europa Clipper II' } });
    fireEvent.click(screen.getByRole('button', { name: /Create mission/ }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].title).toBe('Europa Clipper II');
    expect(create.mock.calls[0][0].data.status).toBe('planning');
  });

  it('S1: a nameless save is refused with a toast, nothing is created', async () => {
    render(<SpaceArtifactPanel view="missions" />);
    fireEvent.click(screen.getByRole('button', { name: /New Mission/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create mission/ }));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
  });

  it('S1: Edit opens the form prefilled and updates the same record', async () => {
    lensDataState.items = [MISSION];
    render(<SpaceArtifactPanel view="missions" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByDisplayValue('Artemis III');
    fireEvent.change(nameInput, { target: { value: 'Artemis III (revised)' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toBe('art_1');
    expect(update.mock.calls[0][1].title).toBe('Artemis III (revised)');
    expect(update.mock.calls[0][1].data.launchVehicle).toBe('SLS');
  });

  it('S3: delete asks for confirmation before removing anything', async () => {
    lensDataState.items = [MISSION];
    render(<SpaceArtifactPanel view="missions" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('art_1'));
  });

  it('F9: the search input stays mounted while a search refetch loads', () => {
    lensDataState.isLoading = true;
    lensDataState.items = [];
    render(<SpaceArtifactPanel view="missions" />);
    const input = screen.getByPlaceholderText('Search missions...');
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'space' } });
    expect((input as HTMLInputElement).value).toBe('space');
    expect(screen.getByPlaceholderText('Search missions...')).toBe(input);
  });

  it('copy: per-view nouns, never a generated plural', () => {
    render(<SpaceArtifactPanel view="debris" />);
    expect(screen.getByPlaceholderText('Search debris objects...')).toBeTruthy();
    expect(screen.getByText('No debris objects found')).toBeTruthy();
  });
});
