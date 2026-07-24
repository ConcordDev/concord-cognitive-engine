/**
 * Regression test for CraftingWorkbench's GatherPlanPanel (money-txn-hygiene
 * batch, unsafe-chain finding — `frontend-unsafe-chain-detector.js` flagged
 * `r.requirements.length` at CraftingWorkbench.tsx:813 as an unguarded chain).
 *
 * Investigation: `r` in `.filter((r) => r.requirements.length > 0)` is bound
 * to the OUTPUT of the preceding `.map()` (`{ id, title, requirements: reqs }`,
 * where `reqs` is itself always an array from another `.map()` call) — not
 * directly to the raw `/api/crafting/recipes` response, so `r.requirements`
 * was already provably always an array at runtime. The detector's simple
 * block-scoped identifier tracking conflates this `.filter()` callback's `r`
 * with the earlier `.map()` callback's differently-scoped `r` (both named `r`
 * within the same enclosing `try` block). Per the established house idiom
 * (commits db1a0a75, 61122eef — `const payload = j?.result ?? j`, optional
 * chaining before a deep read), the fix applies the same `?.` + `??` pattern
 * here for consistency and defense-in-depth, even though the access was
 * already safe.
 *
 * This test proves the real-world behavior the fix must never break: a
 * recipe with NO resource requirements is excluded from the gather plan, and
 * a recipe WITH requirements is included — across both a "well-formed empty
 * array" recipe and a recipe whose `data` has no `spec` at all (the shape
 * that produces `reqs = []` via the `?? []` fallback, i.e. exactly the
 * "requirements could plausibly be missing" case a guard exists for).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const apiGet = vi.fn();
const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() },
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...(props as object) }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import { CraftingWorkbench } from '@/components/crafting/CraftingWorkbench';

describe('CraftingWorkbench — GatherPlanPanel requirements filter', () => {
  beforeEach(() => {
    apiGet.mockReset();
    lensRun.mockReset();
    // Every other tab's mount-time lensRun call (grid_list, etc.) gets a
    // harmless empty-result default so switching tabs never throws.
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('excludes zero-requirement recipes and includes recipes with real requirements, without throwing', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/crafting/recipes') {
        return Promise.resolve({
          data: {
            recipes: [
              // No `spec` at all → resource_requirements resolves via the
              // `?? []` fallback to an empty array (requirements: []).
              { id: 'r_no_spec', title: 'Empty Husk', data: {} },
              // `spec.resource_requirements` explicitly empty.
              { id: 'r_empty_reqs', title: 'Bare Frame', data: { spec: { resource_requirements: [] } } },
              // Real requirements — must survive the filter.
              {
                id: 'r_real',
                title: 'Iron Dagger',
                data: { spec: { resource_requirements: [{ resource_type: 'iron_ore', quantity: 3 }] } },
              },
            ],
          },
        });
      }
      if (url === '/api/player-inventory') {
        return Promise.resolve({ data: { items: [{ item_name: 'iron_ore', quantity: 1 }] } });
      }
      if (url.includes('/nodes')) {
        return Promise.resolve({ data: { nodes: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    let capturedRecipes: Array<{ id: string; requirements: unknown[] }> | null = null;
    lensRun.mockImplementation((domain: string, action: string, input: unknown) => {
      if (domain === 'crafting' && action === 'gather_plan') {
        capturedRecipes = (input as { recipes: Array<{ id: string; requirements: unknown[] }> }).recipes;
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              lines: [{ material: 'iron_ore', need: 3, have: 1, stillNeed: 2, satisfied: false, nodeHint: null }],
              summary: { materials: 1, outstanding: 1, total: 1, satisfied: false },
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });

    const { getByText } = render(React.createElement(CraftingWorkbench));

    // Switch to the "Gather Plan" tab — this is what mounts GatherPlanPanel
    // and triggers the exact `.filter((r) => r.requirements?.length ?? 0) > 0)`
    // line that was changed.
    fireEvent.click(getByText('Gather Plan'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('crafting', 'gather_plan', expect.anything()));

    // The zero-requirement recipes must never reach the gather-plan macro
    // call — this is the exact filter behavior the fix must preserve.
    expect(capturedRecipes).not.toBeNull();
    const ids = (capturedRecipes as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(['r_real']);
    expect(ids).not.toContain('r_no_spec');
    expect(ids).not.toContain('r_empty_reqs');

    // Real requirements are preserved intact (not silently emptied by the
    // optional-chaining fix).
    const real = (capturedRecipes as unknown as Array<{ id: string; requirements: Array<{ material: string; quantity: number }> }>)
      .find((r) => r.id === 'r_real');
    expect(real?.requirements).toEqual([{ material: 'iron_ore', quantity: 3 }]);

    // Renders the resolved gather-plan output without throwing.
    await waitFor(() => expect(getByText(/iron_ore/i)).toBeInTheDocument());
  });

  it('renders an honest empty state when every recipe has zero requirements (no crash, no gather_plan call)', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/crafting/recipes') {
        return Promise.resolve({
          data: { recipes: [{ id: 'r_no_spec', title: 'Empty Husk', data: {} }] },
        });
      }
      if (url === '/api/player-inventory') return Promise.resolve({ data: { items: [] } });
      if (url.includes('/nodes')) return Promise.resolve({ data: { nodes: [] } });
      return Promise.resolve({ data: {} });
    });

    const { getByText } = render(React.createElement(CraftingWorkbench));
    fireEvent.click(getByText('Gather Plan'));

    await waitFor(() => expect(getByText(/no recipes with resource requirements/i)).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalledWith('crafting', 'gather_plan', expect.anything());
  });
});
