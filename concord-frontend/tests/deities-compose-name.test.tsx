// Audit fix sweep (PR #2356) — FIX-deities-004 + FIX-deities-005: the Compose
// form's name field carries the 80-char cap (the server's stored limit) with
// a live counter, and a blank name explains itself beside the disabled
// 'Birth Deity' button instead of the button just sitting greyed out.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children, cta }: { children: React.ReactNode; cta?: { label: string; onClick: () => void } }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, [
      cta ? React.createElement('button', { key: 'cta', onClick: cta.onClick }, cta.label) : null,
      children,
    ]),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'tester' } }) }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/deities/PantheonExplorer', () => ({ PantheonExplorer: () => null }));
vi.mock('@/components/deities/MyDevotionPanel', () => ({ MyDevotionPanel: () => null }));
vi.mock('@/components/deities/DeityDetailPanel', () => ({ DeityDetailPanel: () => null }));

import DeitiesPage from '@/app/lenses/deities/page';

function reply(result: Record<string, unknown>) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_d: string, name: string) => {
    if (name === 'list') return reply({ deities: [] });
    return reply({});
  });
});

describe('deities compose — the name field says its rules', () => {
  it('caps the name at 80 with a counter, and explains the disabled Birth button while blank', async () => {
    const { getByText, getByLabelText, getByRole } = render(<DeitiesPage />);
    fireEvent.click(getByText('Compose a deity'));
    const name = await waitFor(() => getByLabelText('Deity name')) as HTMLInputElement;
    expect(name.maxLength).toBe(80);
    expect(getByText('A name is required — up to 80 characters.')).toBeTruthy();
    expect(getByText('0/80')).toBeTruthy();
    const birth = getByRole('button', { name: 'Birth Deity' }) as HTMLButtonElement;
    expect(birth.disabled).toBe(true);
    fireEvent.change(name, { target: { value: '   ' } });
    expect(birth.disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'Veyra' } });
    expect(birth.disabled).toBe(false);
    expect(getByText('5/80')).toBeTruthy();
  });
});
