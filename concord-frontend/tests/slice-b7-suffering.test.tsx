import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-suffering-004: pain points, themes and interventions
// gain working edit controls (pain-update / theme-update /
// intervention-update incl. the new title field).

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { PainBoard } from '@/components/suffering/PainBoard';
import { ThemeClusters } from '@/components/suffering/ThemeClusters';
import { InterventionTracker } from '@/components/suffering/InterventionTracker';

function ok(result: unknown = {}) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

const PAIN = {
  id: 'pain_1', title: 'Setup hurts', description: 'first run pain', severity: 5, frequency: 5,
  impact: 5, effort: 5, status: 'open', themeId: null, evidence: [], priorityScore: 25,
  createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
};
const THEME = { id: 'theme_1', name: 'Onbording', description: '', color: '#6366f1', painCount: 1, openCount: 1, totalImpact: 3 };
const IV = {
  id: 'iv_1', title: 'Fix it somehow', description: 'vague plan', painId: null, status: 'proposed',
  owner: '', progress: 0, history: [], createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
};

beforeEach(() => { lensRun.mockReset(); lensRun.mockImplementation(() => ok()); });

describe('suffering edit controls (FIX-suffering-004)', () => {
  it('a pain point edits title + scores via pain-update', async () => {
    render(<PainBoard pains={[PAIN]} themes={[]} loading={false} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit pain point Setup hurts' }));
    const title = await screen.findByLabelText('Edit pain title') as HTMLInputElement;
    expect(title.value).toBe('Setup hurts');
    fireEvent.change(title, { target: { value: 'Setup hurts badly' } });
    fireEvent.change(screen.getByLabelText('Edit pain severity'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('pain-update')).toHaveLength(1));
    expect(calls('pain-update')[0][2]).toMatchObject({ id: 'pain_1', title: 'Setup hurts badly', severity: 9 });
  });

  it('a theme edits name + description via theme-update', async () => {
    render(<ThemeClusters themes={[THEME]} unthemedCount={0} loading={false} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit theme Onbording' }));
    const name = await screen.findByLabelText('Edit theme name') as HTMLInputElement;
    expect(name.value).toBe('Onbording');
    fireEvent.change(name, { target: { value: 'Onboarding' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('theme-update')).toHaveLength(1));
    expect(calls('theme-update')[0][2]).toMatchObject({ id: 'theme_1', name: 'Onboarding' });
  });

  it('an intervention edits its title via intervention-update', async () => {
    render(<InterventionTracker interventions={[IV]} pains={[]} byStatus={{}} loading={false} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit intervention Fix it somehow' }));
    const title = await screen.findByLabelText('Edit intervention title') as HTMLInputElement;
    expect(title.value).toBe('Fix it somehow');
    fireEvent.change(title, { target: { value: 'Guided setup wizard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('intervention-update')).toHaveLength(1));
    expect(calls('intervention-update')[0][2]).toMatchObject({ id: 'iv_1', title: 'Guided setup wizard' });
  });
});
