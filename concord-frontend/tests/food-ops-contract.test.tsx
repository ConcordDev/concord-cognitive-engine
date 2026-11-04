/**
 * food-ops-contract.test.tsx — Food S3 (lens-reviews/food.md F4/F5,
 * priced from cross-check #64's registrations).
 *
 * The Ops bench (FoodActionPanel) called scaleRecipe and costPlate
 * with shapes neither contract reads: Scale sent flat ingredients +
 * targetServings while the macro reads artifact.data.recipe +
 * params.targetYield — and answers a missing targetYield as ok +
 * result.error, which the panel toasted as "Scaled to 4 servings."
 * with no scaled output (generation-as-execution). Cost sent flat
 * ingredients while costPlate requires artifact.data.menuItems with
 * costPerUnit per ingredient and a menuPrice — inputs the bench never
 * collected — so it could only refuse invalid_input.
 *
 * Pins: the envelopes now match the registered contracts; the scaled
 * quantities render; an ok-wrapped error is shown as an error, never
 * as success; Cost's priced inputs exist and its real costed item
 * (foodCostPct, ingredientCost, margin, per-ingredient costs) renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockRunDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => mockRunDomain(...args) } },
  lensRun: vi.fn(async () => ({ data: { result: {} } })),
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

import { FoodActionPanel } from '@/components/food/FoodActionPanel';

function envelope(result: unknown) {
  // /api/lens/run body { ok, result: <handler return> }; the handler
  // returns { ok, result } — callMacro unwraps the nested ok layer.
  return { data: { ok: true, result: { ok: true, result } } };
}

function fillBench() {
  fireEvent.change(screen.getByPlaceholderText('Recipe name'), { target: { value: 'Soup' } });
  fireEvent.change(screen.getByPlaceholderText('Servings'), { target: { value: '2' } });
  fireEvent.change(screen.getByPlaceholderText('Scale to'), { target: { value: '4' } });
  const ing = document.querySelectorAll('textarea')[0];
  fireEvent.change(ing, { target: { value: 'flour 200 g 0.01\nsugar 100 g 0.02' } });
  return ing;
}

describe('FoodActionPanel ops contracts (S3)', () => {
  beforeEach(() => { mockRunDomain.mockReset(); });

  it('Scale sends the registered envelope and renders the scaled quantities', async () => {
    mockRunDomain.mockResolvedValue(envelope({
      recipeName: 'Soup', baseYield: 2, targetYield: 4, scaleFactor: 2,
      ingredients: [
        { name: 'flour', originalQuantity: 200, scaledQuantity: 400, unit: 'g' },
        { name: 'sugar', originalQuantity: 100, scaledQuantity: 200, unit: 'g' },
      ],
    }));
    render(<FoodActionPanel />);
    fillBench();
    fireEvent.click(screen.getByRole('button', { name: /Scale/ }));
    await waitFor(() => expect(document.body.textContent).toContain('flour: 200 → 400 g'));
    expect(document.body.textContent).toContain('sugar: 100 → 200 g');
    expect(document.body.textContent).toContain('Scaled to 4 servings (×2).');
    const call = mockRunDomain.mock.calls.find(c => c[1] === 'scaleRecipe');
    expect(call).toBeTruthy();
    expect(call![2]).toEqual({
      input: {
        recipe: { name: 'Soup', baseYield: 2, ingredients: [
          { name: 'flour', quantity: 200, unit: 'g', costPerUnit: 0.01 },
          { name: 'sugar', quantity: 100, unit: 'g', costPerUnit: 0.02 },
        ] },
        targetYield: 4,
      },
    });
  });

  it('Scale never claims success over an ok-wrapped error (F4)', async () => {
    mockRunDomain.mockResolvedValue(envelope({ error: 'targetYield must be a positive number.' }));
    render(<FoodActionPanel />);
    fillBench();
    fireEvent.click(screen.getByRole('button', { name: /Scale/ }));
    await waitFor(() => expect(screen.getByText(/targetYield must be a positive number/)).toBeTruthy());
    expect(screen.queryByText(/Scaled to \d+ servings/)).toBeNull();
  });

  it('Cost sends menuItems with costPerUnit + menuPrice and renders the costed item', async () => {
    mockRunDomain.mockResolvedValue(envelope({
      items: [{
        name: 'Soup', menuPrice: 12, ingredientCost: 4, foodCostPct: 33.33,
        suggestedPriceAtTarget: 13.33, margin: 8, status: 'over-target',
        ingredients: [
          { name: 'flour', quantity: 200, unit: 'g', costPerUnit: 0.01, totalCost: 2 },
          { name: 'sugar', quantity: 100, unit: 'g', costPerUnit: 0.02, totalCost: 2 },
        ],
      }],
      avgFoodCostPct: 33.33,
    }));
    render(<FoodActionPanel />);
    fillBench();
    fireEvent.change(screen.getByPlaceholderText('Menu price $'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /Cost/ }));
    await waitFor(() => expect(document.body.textContent).toContain('33.33%'));
    expect(document.body.textContent).toContain('flour: 200 g × $0.01 = $2.00');
    const call = mockRunDomain.mock.calls.find(c => c[1] === 'costPlate');
    expect(call).toBeTruthy();
    expect(call![2]).toEqual({
      input: {
        menuItems: [{ name: 'Soup', menuPrice: 12, ingredients: [
          { name: 'flour', quantity: 200, unit: 'g', costPerUnit: 0.01 },
          { name: 'sugar', quantity: 100, unit: 'g', costPerUnit: 0.02 },
        ] }],
        itemName: 'Soup',
      },
    });
  });

  it('Cost refuses locally, naming the missing input, when no menu price is set (F5)', async () => {
    render(<FoodActionPanel />);
    fillBench();
    fireEvent.click(screen.getByRole('button', { name: /Cost/ }));
    await waitFor(() => expect(screen.getByText(/Set the menu price/)).toBeTruthy());
    expect(mockRunDomain.mock.calls.filter(c => c[1] === 'costPlate')).toHaveLength(0);
  });
});
