// Close-out A7 — identity-display, FE legs. At the adopted surfaces a
// party renders as the name the server resolved and carried; when no
// name is carried, a neutral label renders. The raw account id — and
// any slice of it — is never the display.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user_me_0001', username: 'tester' } }),
}));

import LfgLensPage from '@/app/lenses/lfg/page';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const NAMED = {
  id: 'lfg_named', userId: 'user_healer_0001', posterName: 'Healer Hua', worldId: 'tunya', role: 'healer',
  partyType: 'normal', note: 'need 2 dps', createdAt: 1001, expiresAt: 9999999999, partyMaxSize: 8, currentSize: 1,
};
const UNNAMED = {
  id: 'lfg_unnamed', userId: 'user_quiet_0002', posterName: null, worldId: 'tunya', role: 'dps',
  partyType: 'normal', note: 'quiet poster', createdAt: 1002, expiresAt: 9999999999, partyMaxSize: 8, currentSize: 1,
};

describe('A7 FE — the LFG board renders names, never raw ids', () => {
  it('a resolved poster renders their name; an unresolved one renders the neutral label', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ok: true, requests: [NAMED, UNNAMED] }),
    })) as unknown as typeof fetch;
    const { container } = render(<LfgLensPage />);
    expect(await screen.findByText('Healer Hua')).toBeTruthy();
    expect(screen.getByText('Member')).toBeTruthy();
    expect(container.textContent).not.toMatch(/user_healer_0001|user_quiet_0002|user_healer/);
  });
});

describe('A7 FE — the slice fallbacks are gone at the adopted surfaces', () => {
  it('garage + the custody console carry no raw-id slice fallback', () => {
    const garage = readFileSync(join(__dirname, '../app/lenses/garage/page.tsx'), 'utf8');
    expect(garage).not.toMatch(/owner_id \? `:\$\{v\.owner_id\.slice/);
    expect(garage).toMatch(/ownerDisplay \|\| 'Member'/);
    const rms = readFileSync(join(__dirname, '../components/law-enforcement/RmsCadConsole.tsx'), 'utf8');
    expect(rms).not.toMatch(/holder \{e\.currentHolder\}/);
    expect(rms).toMatch(/holderText\(e\.currentHolderName, e\.currentHolder\)/);
  });
});
