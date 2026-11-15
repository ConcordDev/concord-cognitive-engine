// NarrativeWalkAgain.test.tsx
//
// FIX-narrative-walk-001: at the final step, "Walk it again" cleared
// the journal but landed on "No walk open", needing a second Begin.
// The page's own contract is that it restarts the trail — after the
// fix, clicking it reopens step 1 with a fresh journal.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const STEPS = [
  { id: 's1', trigger: 't1', name: 'First Beat', summary: 'one' },
  { id: 's2', trigger: 't2', name: 'Second Beat', summary: 'two' },
  { id: 's3', trigger: 't3', name: 'Third Beat', summary: 'three' },
];

vi.mock('@/lib/world-lens/cinematic-sequences-registry', () => ({
  ensureCinematicsRegistered: () => {},
}));
vi.mock('@/lib/world-lens/cinematic-director', () => ({
  listSequences: () => STEPS,
  playSequence: async () => {},
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/KeepRecordActions', () => ({ KeepRecordActions: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import NarrativeWalkLensPage from '@/app/lenses/narrative-walk/page';

describe('Narrative walk — Walk it again (FIX-narrative-walk-001)', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => cleanup());

  it('restarts at step 1 instead of returning to "No walk open"', async () => {
    render(React.createElement(NarrativeWalkLensPage));
    fireEvent.click(await screen.findByText('Begin the walk'));
    await screen.findByText('First Beat');
    fireEvent.click(screen.getByText('The next step'));
    await screen.findByText('Second Beat');
    fireEvent.click(screen.getByText('The next step'));
    await screen.findByText('Third Beat');
    expect(screen.getByTestId('narrative-progress').textContent).toContain('Step 3 of 3 · 3 walked');

    fireEvent.click(screen.getByText('Walk it again'));
    await screen.findByText('First Beat');
    expect(screen.queryByTestId('narrative-empty')).toBeNull();
    expect(screen.getByTestId('narrative-progress').textContent).toContain('Step 1 of 3 · 1 walked');
  });
});
