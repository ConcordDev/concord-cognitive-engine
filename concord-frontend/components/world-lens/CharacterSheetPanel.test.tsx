/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CharacterSheetPanel } from './CharacterSheetPanel';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const CHARACTER = {
  ok: true,
  characterLevel: 7,
  pendingUpgrades: 2,
  totalUpgradesSpent: 5,
  bars: {
    hp: { current: 80, max: 120 },
    mana: { current: 30, max: 60 },
    stamina: { current: 50, max: 50 },
    bio_power: { current: 10, max: 40 },
    perception: { current: 25, max: 30 },
  },
  skillSummary: [
    { skill_type: 'fire_magic', level: 12, total_xp: 3400 },
    { skill_type: 'cooking', level: 4, total_xp: 600 },
  ],
  recentUpgrades: [],
};

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe('CharacterSheetPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(okJson(CHARACTER));
  });

  it('fetches and renders level, a bar, and a skill', async () => {
    render(<CharacterSheetPanel worldId="concordia-hub" />);

    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());

    // Fetched the real endpoint
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/crafting/character/concordia-hub',
      expect.objectContaining({ credentials: 'include' })
    );

    // A vital bar renders with its values
    const hpBar = screen.getByTestId('bar-hp');
    expect(hpBar).toHaveTextContent('Health');
    expect(hpBar).toHaveTextContent('80');
    expect(hpBar).toHaveTextContent('120');

    // A skill renders (humanized)
    const skill = screen.getByTestId('skill-fire_magic');
    expect(skill).toHaveTextContent('Fire Magic');
    expect(skill).toHaveTextContent('12');
  });

  it('upgrade button POSTs /api/crafting/upgrade-bar and refreshes', async () => {
    render(<CharacterSheetPanel worldId="concordia-hub" />);
    await waitFor(() => expect(screen.getByTestId('bar-hp')).toBeInTheDocument());

    // POST response, then the refresh GET
    mockFetch.mockResolvedValueOnce(okJson({ ok: true }));
    mockFetch.mockResolvedValueOnce(okJson({ ...CHARACTER, pendingUpgrades: 1 }));

    const upgradeBtn = screen.getByLabelText('Upgrade Health');
    fireEvent.click(upgradeBtn);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/crafting/upgrade-bar',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ worldId: 'concordia-hub', barType: 'hp' }),
        })
      )
    );
  });

  it('renders an honest error state when the fetch fails', async () => {
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error('network down'));
    render(<CharacterSheetPanel worldId="concordia-hub" />);
    await waitFor(() =>
      expect(screen.getByText(/Disconnected from character backend/i)).toBeInTheDocument()
    );
  });
});
