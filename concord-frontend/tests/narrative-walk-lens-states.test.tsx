/**
 * /lenses/narrative-walk — one trail.
 *
 * The catalog is the bundled cinematic registry. Begin opens the first
 * sequence and shows its name only after localStorage holds that id.
 * The next step advances and plays by trigger.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

const ensureCinematicsRegistered = vi.fn();
const listSequences = vi.fn();
const playSequence = vi.fn();

vi.mock('@/lib/world-lens/cinematic-sequences-registry', () => ({
  ensureCinematicsRegistered: () => ensureCinematicsRegistered(),
}));
vi.mock('@/lib/world-lens/cinematic-director', () => ({
  listSequences: () => listSequences(),
  playSequence: (...args: unknown[]) => playSequence(...args),
}));

import NarrativeWalkLens from '@/app/lenses/narrative-walk/page';

const SEQS = [
  {
    id: 'boss_arrival', trigger: 'boss_arrival', name: 'Boss Arrival',
    comment: 'Wide environmental shot + boss silhouette emerge + name-card flash.',
    shots: [{ duration_ms: 1500 }, { duration_ms: 300 }],
  },
  {
    id: 'vela_reveal', trigger: 'vela:reveal', name: 'Vela Reveal',
    comment: 'Bespoke cinematic for the Vela reveal beat.',
    shots: [{ duration_ms: 90000 }],
  },
];

beforeEach(() => {
  ensureCinematicsRegistered.mockReset();
  listSequences.mockReset();
  playSequence.mockReset();
  playSequence.mockResolvedValue(undefined);
  localStorage.clear();
});

describe('narrative trail', () => {
  it('EMPTY: says no walk is open and offers Begin', async () => {
    listSequences.mockReturnValue(SEQS);
    const view = render(<NarrativeWalkLens />);
    expect(await view.findByText('No walk open.')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Begin the walk' })).toBeEnabled();
    expect(view.queryByText('Boss Arrival')).toBeNull();
    expect(view.queryByText(/All chapters/)).toBeNull();
  });

  it('ERROR: a failed library load shows role=alert and Retry reloads', async () => {
    ensureCinematicsRegistered.mockImplementationOnce(() => { throw new Error('content missing'); });
    listSequences.mockReturnValue(SEQS);
    const view = render(<NarrativeWalkLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/Could not load the narrative library/);
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No walk open.')).toBeInTheDocument();
  });

  it('BEGIN: shows the first sequence only after the open id is stored, and plays its trigger', async () => {
    listSequences.mockReturnValue(SEQS);
    const view = render(<NarrativeWalkLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Begin the walk' }));
    expect(await view.findByRole('heading', { name: 'Boss Arrival' })).toBeInTheDocument();
    expect(view.getByText(/Wide environmental shot/)).toBeInTheDocument();
    expect(localStorage.getItem('concordia:narrative-walk:open')).toBe('boss_arrival');
    await waitFor(() => expect(playSequence).toHaveBeenCalledWith(
      'boss_arrival',
      expect.objectContaining({ source: 'narrative-walk-lens' }),
    ));
  });

  it('NEXT: advances to the following sequence and plays that trigger', async () => {
    listSequences.mockReturnValue(SEQS);
    const view = render(<NarrativeWalkLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Begin the walk' }));
    fireEvent.click(await view.findByRole('button', { name: 'The next step' }));
    expect(await view.findByRole('heading', { name: 'Vela Reveal' })).toBeInTheDocument();
    expect(localStorage.getItem('concordia:narrative-walk:open')).toBe('vela_reveal');
    await waitFor(() => expect(playSequence).toHaveBeenCalledWith(
      'vela:reveal',
      expect.objectContaining({ source: 'narrative-walk-lens' }),
    ));
  });

  it('READ-BACK: a stored open id is the step on the next mount', async () => {
    localStorage.setItem('concordia:narrative-walk:open', 'vela_reveal');
    listSequences.mockReturnValue(SEQS);
    const view = render(<NarrativeWalkLens />);
    expect(await view.findByRole('heading', { name: 'Vela Reveal' })).toBeInTheDocument();
    expect(playSequence).not.toHaveBeenCalled();
  });
});
