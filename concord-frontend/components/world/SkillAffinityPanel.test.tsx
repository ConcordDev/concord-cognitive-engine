/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SkillAffinityPanel } from './SkillAffinityPanel';
import { ALL_SKILL_KEYS } from '@/lib/concordia/skill-descriptors';

function worldResponse(ruleModulators: Record<string, unknown>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ world: { id: 'w1', rule_modulators: ruleModulators } }),
  } as Response);
}

const ok = <T,>(result: T) => ({ data: { ok: true, result } });

beforeEach(() => {
  lensRun.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SkillAffinityPanel — Foundry config gating', () => {
  it('renders nothing for a world whose worldspec never selected skill-affinity-player', async () => {
    // skill-affinity-player is `always_on` — it never gets a keyed
    // rule_modulators entry of its own, only a foundry.systems membership.
    global.fetch = vi.fn(() => worldResponse({ foundry: { systems: ['size-scaling'] } }));
    const { container } = render(<SkillAffinityPanel worldId="w1" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders nothing for a non-Foundry world with no foundry.systems block', async () => {
    global.fetch = vi.fn(() => worldResponse({}));
    const { container } = render(<SkillAffinityPanel worldId="concordia-hub" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders the real launcher + a genuine per-skill affinity lookup for a world that selected the system', async () => {
    global.fetch = vi.fn(() => worldResponse({ foundry: { systems: ['skill-affinity-player'] } }));
    lensRun.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) => {
      if (action === 'get') {
        return Promise.resolve(ok({ skillId: input.skillId, playerAffinity: 1.24, effective: 1.86 }));
      }
      return Promise.reject(new Error(`unexpected action ${action}`));
    });

    render(<SkillAffinityPanel worldId="w1" />);
    await waitFor(() => expect(screen.getByText('Affinity')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Affinity'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('skill_affinity', 'get', { skillId: ALL_SKILL_KEYS[0], worldId: 'w1' }),
    );

    await waitFor(() => expect(screen.getByText('1.240x')).toBeInTheDocument());
    expect(screen.getByText('1.860x')).toBeInTheDocument();
    expect(screen.getByText(/above baseline from real use/)).toBeInTheDocument();
  });

  it('an unused skill honestly reads back the real 1.0 baseline, not a fabricated value', async () => {
    global.fetch = vi.fn(() => worldResponse({ foundry: { systems: ['skill-affinity-player'] } }));
    lensRun.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) =>
      Promise.resolve(ok({ skillId: input.skillId, playerAffinity: 1.0, effective: 1.0 })),
    );

    render(<SkillAffinityPanel worldId="w1" />);
    fireEvent.click(await screen.findByText('Affinity'));

    await waitFor(() => expect(screen.getByText('Baseline — no recorded use yet')).toBeInTheDocument());
  });
});
