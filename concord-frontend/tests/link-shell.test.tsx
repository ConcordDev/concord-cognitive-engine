// Concord Link Summon shell (B2 P2) — gated off → nothing; enabled → the three
// substrate panes from the real endpoints. Never throws into render.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const flags = { concordLinkSystem: true };
vi.mock('@/hooks/useClientConfig', () => ({ useClientConfig: () => ({ flags }) }));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }));
import { api } from '@/lib/api/client';
import { LinkShell } from '@/components/world/concord-link/LinkShell';

function wireApi() {
  (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.includes('resource-bars')) return Promise.resolve({ data: { ok: true, bars: { hp: 80, max_hp: 100, mana: 50, max_mana: 100, stamina: 90, max_stamina: 100, bio_power: 100, max_bio_power: 100, perception: 70, max_perception: 100 } } });
    if (url.includes('player-inventory')) return Promise.resolve({ data: { ok: true, items: [{ id: 'i1', item_name: 'Iron Ore', quantity: 5, quality: 70, item_type: 'material' }] } });
    if (url.includes('effects/me')) return Promise.resolve({ data: { ok: true, effects: [{ effect_id: 'stamina_regen', kind: 'buff', magnitude: 1.5, expires_at: 9e12 }] } });
    return Promise.resolve({ data: { ok: false } });
  });
}

describe('LinkShell', () => {
  beforeEach(() => { vi.clearAllMocks(); flags.concordLinkSystem = true; });

  it('renders nothing when the kill-switch is off (today HUD untouched)', () => {
    flags.concordLinkSystem = false;
    const { container } = render(<LinkShell worldId="w1" open />);
    expect(container.querySelector('[data-testid="link-shell"]')).toBeNull();
  });

  it('renders nothing when not open', () => {
    const { container } = render(<LinkShell worldId="w1" open={false} />);
    expect(container.querySelector('[data-testid="link-shell"]')).toBeNull();
  });

  it('open + enabled → shows the status pane with real resource bars', async () => {
    wireApi();
    render(<LinkShell worldId="w1" open />);
    await waitFor(() => expect(screen.getByTestId('link-status')).toBeTruthy());
    expect(screen.getByText('Health')).toBeTruthy();
    expect(screen.getByText('80/100')).toBeTruthy(); // hp/max_hp
    expect(api.get).toHaveBeenCalledWith('/api/worlds/w1/resource-bars');
  });

  it('never throws when the endpoints reject', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const { container } = render(<LinkShell worldId="w1" open />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="link-shell"]')).toBeTruthy(); // shell still renders
  });
});
