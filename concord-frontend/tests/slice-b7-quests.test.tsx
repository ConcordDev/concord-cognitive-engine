/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-quests-001: a web user can see the catalog, accept a
// quest from it, and post a new quest into it.

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null, default: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import QuestsLensPage from '@/app/lenses/quests/page';

function envelope(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

const AVAILABLE_QUEST = {
  id: 'qa1',
  title: 'Ember Herb Run',
  description: 'The apothecary is out of ember herb.',
  status: 'available',
  objectives: [{ id: 'oa1', title: 'gather ember herb', progress: 0, target: 3, complete: false }],
  reward: { cc: 50 },
};

function mockSurface() {
  lensRun.mockImplementation((domain: string, name: string) => {
    if (domain === 'quests' && name === 'mine') return Promise.resolve(envelope({ ok: true, quests: [] }));
    if (domain === 'quests' && name === 'completed') return Promise.resolve(envelope({ ok: true, quests: [] }));
    if (domain === 'quests' && name === 'available') return Promise.resolve(envelope({ ok: true, quests: [AVAILABLE_QUEST] }));
    if (domain === 'quests' && name === 'accept') return Promise.resolve(envelope({ ok: true, already: false, status: 'active' }));
    if (domain === 'quests' && name === 'create') return Promise.resolve(envelope({ ok: true, quest: { ...AVAILABLE_QUEST, id: 'qa2', title: 'Posted Errand' } }));
    return Promise.resolve(envelope({ ok: true }));
  });
}

function calls(name: string) {
  return lensRun.mock.calls.filter((c) => c[0] === 'quests' && c[1] === name);
}

beforeEach(() => {
  lensRun.mockReset();
  global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, party: null }) } as Response)) as unknown as typeof fetch;
});

afterEach(() => { vi.restoreAllMocks(); });

describe('FIX-quests-001 web create + accept', () => {
  it('the Available tab lists the catalog and Accept moves the quest to Active', async () => {
    mockSurface();
    render(<QuestsLensPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^available \(1\)$/i }));
    expect(await screen.findByText('Ember Herb Run')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept Ember Herb Run' }));
    await waitFor(() => expect(calls('accept')).toHaveLength(1));
    expect(calls('accept')[0][2]).toEqual({ questId: 'qa1' });
    expect(await screen.findByText(/Quest accepted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^active \(1\)$/i }));
    expect(await screen.findByText('Ember Herb Run')).toBeInTheDocument();
  });

  it('posting a quest sends title, one objective and the XP reward to quests.create', async () => {
    mockSurface();
    render(<QuestsLensPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^available \(1\)$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /post a quest/i }));
    fireEvent.change(screen.getByLabelText('Quest title'), { target: { value: 'Posted Errand' } });
    fireEvent.change(screen.getByLabelText('Objective target'), { target: { value: 'ember herb' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post quest' }));
    await waitFor(() => expect(calls('create')).toHaveLength(1));
    expect(calls('create')[0][2]).toMatchObject({
      title: 'Posted Errand',
      objectives: [{ type: 'gather', target: 'ember herb', requiredCount: 1 }],
      rewardXp: 50,
    });
    expect(await screen.findByText(/Quest posted/)).toBeInTheDocument();
  });
});
