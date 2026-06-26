import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AbilityCooldownHud } from './AbilityCooldownHud';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const ABILITIES = [
  {
    id: 'fireball',
    name: 'Fireball',
    slot: 1,
    element: 'fire',
    cooldownMs: 8000,
    cooldownRemainingMs: 0,
    ready: true,
  },
  {
    id: 'frostnova',
    name: 'Frost Nova',
    slot: 2,
    element: 'ice',
    cooldownMs: 10000,
    cooldownRemainingMs: 4000,
    ready: false,
  },
];

describe('AbilityCooldownHud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { abilities: ABILITIES }, error: null },
    });
  });

  it('polls combat-prefs-get and renders both abilities', async () => {
    render(<AbilityCooldownHud />);

    await waitFor(() => expect(screen.getByTestId('ability-fireball')).toBeInTheDocument());
    expect(screen.getByTestId('ability-frostnova')).toBeInTheDocument();
    expect(lensRunMock).toHaveBeenCalledWith('world', 'combat-prefs-get', {});
  });

  it('shows a countdown on the cooling ability and none on the ready one', async () => {
    render(<AbilityCooldownHud />);

    await waitFor(() => expect(screen.getByTestId('ability-frostnova')).toBeInTheDocument());

    // On-cooldown ability shows seconds + a sweep overlay
    expect(screen.getByTestId('ability-frostnova-cd')).toHaveTextContent('4');
    expect(screen.getByTestId('ability-frostnova-sweep')).toBeInTheDocument();

    // Ready ability shows no countdown / no sweep
    expect(screen.queryByTestId('ability-fireball-cd')).toBeNull();
    expect(screen.queryByTestId('ability-fireball-sweep')).toBeNull();
  });

  it('renders nothing when there are no bound abilities', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { abilities: [] }, error: null } });
    const { container } = render(<AbilityCooldownHud />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid^="ability-"]')).toBeNull();
  });
});
