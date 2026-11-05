/**
 * food-workbench-save.test.tsx — Food S1 (lens-reviews/food.md F2/F9 +
 * the shared-draft debit).
 *
 * Pins, at the FoodKitchenWorkbench editor seam:
 *  1. A refused save surfaces the server's field-named validation
 *     errors inside the editor and keeps it open (previously the 422
 *     rejection vanished: dialog left open with no field named, or the
 *     create silently never landed).
 *  2. A successful save closes the editor and posts the payload —
 *     including the Recipe's ingredients, which the dialog never
 *     collected before (the lens's downstream is made of them).
 *  3. The PantryItem Expiry Date is a typeable field (F9: type="date"
 *     refused typing and its picker closed the dialog).
 *  4. The Description draft is keyed per artifact type (the old shared
 *     "recipe-description" draft bled a cancelled Recipe draft into the
 *     PantryItem and MealPlan dialogs).
 * Plus pure pins for the two exported helpers the fix stands on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockCreate = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [], isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: mockCreate, update: vi.fn(), remove: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/use-food-ops', () => ({
  useWasteLog: () => ({ entries: [], loading: false, addEntry: vi.fn(), removeEntry: vi.fn() }),
  useFloorPlan: () => ({ tables: [], waitlist: [], loading: false, addTable: vi.fn(), updateTableStatus: vi.fn(), deleteTable: vi.fn(), addWaitlistEntry: vi.fn(), removeWaitlistEntry: vi.fn() }),
  usePrepList: () => ({ tasks: [], loading: false, saveTasks: vi.fn(), toggleTask: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })) }),
}));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({
    contextDTUs: [], hyperDTUs: [], megaDTUs: [], regularDTUs: [],
    tierDistribution: {}, publishToMarketplace: vi.fn(), refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => vi.fn() }));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (p: { draftKey: string; initial?: string; onValueChange?: (v: string) => void; rows?: number; className?: string; placeholder?: string }) => (
    <textarea data-draftkey={p.draftKey} defaultValue={p.initial} onChange={e => p.onValueChange?.(e.target.value)} rows={p.rows} className={p.className} placeholder={p.placeholder} />
  ),
}));
vi.mock('@/components/food/CookMode', () => ({ default: () => null }));
vi.mock('@/components/food/PantryTracker', () => ({ default: () => null }));
vi.mock('@/components/food/PlateScan', () => ({ default: () => null }));
vi.mock('@/components/food/MealPlanner', () => ({ default: () => null }));
vi.mock('@/components/food/RecipeImporter', () => ({ default: () => null }));
vi.mock('@/components/food/RecipeScaler', () => ({ default: () => null }));
vi.mock('@/components/lens/LensContextPanel', () => ({ LensContextPanel: () => null }));
vi.mock('@/components/artifact/ArtifactRenderer', () => ({ ArtifactRenderer: () => null }));
vi.mock('@/components/artifact/ArtifactUploader', () => ({ ArtifactUploader: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));

import { FoodKitchenWorkbench, parseIngredientLines, saveErrorMessages } from '@/components/food/FoodKitchenWorkbench';

describe('helpers', () => {
  it('parseIngredientLines parses "name qty unit" and keeps name-only lines', () => {
    expect(parseIngredientLines('flour 200 g\nsugar 100 g\n\nvanilla extract')).toEqual([
      { item: 'flour', qty: '200', unit: 'g', cost: 0 },
      { item: 'sugar', qty: '100', unit: 'g', cost: 0 },
      { item: 'vanilla extract', qty: '', unit: '', cost: 0 },
    ]);
  });

  it('saveErrorMessages prefers the field-named errors[] from the 422 body', () => {
    const e = { response: { data: { error: 'validation_failed', errors: ['Invalid status "prep" for domain "food". Valid statuses: draft, prep'] } }, message: 'Request failed with status code 422' };
    expect(saveErrorMessages(e)).toEqual(['Invalid status "prep" for domain "food". Valid statuses: draft, prep']);
  });

  it('saveErrorMessages falls back to the single error, then the message', () => {
    expect(saveErrorMessages({ response: { data: { error: 'scope_denied' } } })).toEqual(['scope_denied']);
    expect(saveErrorMessages(new Error('boom'))).toEqual(['boom']);
  });
});

describe('FoodKitchenWorkbench editor', () => {
  beforeEach(() => { mockCreate.mockReset(); });

  function openRecipeEditor() {
    render(<FoodKitchenWorkbench group="cook" />);
    fireEvent.click(screen.getByRole('button', { name: /New Recipe/ }));
    return screen.getByPlaceholderText('Name...');
  }

  it('a refused save names its fields in the editor and keeps it open', async () => {
    mockCreate.mockRejectedValue({ response: { data: { error: 'validation_failed', errors: ['Invalid status "prep" for domain "food". Valid statuses: draft, tested, published, archived'] } }, message: 'Request failed with status code 422' });
    const name = openRecipeEditor();
    fireEvent.change(name, { target: { value: 'Probe Soup' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByText(/Invalid status "prep" for domain "food"/)).toBeTruthy());
    // Editor still open: the Create button and the typed name remain.
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeTruthy();
    expect((screen.getByPlaceholderText('Name...') as HTMLInputElement).value).toBe('Probe Soup');
  });

  it('a successful save posts the recipe WITH its ingredients and closes', async () => {
    mockCreate.mockResolvedValue({ ok: true, artifact: { id: 'lart_x' } });
    const name = openRecipeEditor();
    fireEvent.change(name, { target: { value: 'Probe Soup' } });
    const ing = screen.getByPlaceholderText(/flour 200 g/);
    fireEvent.change(ing, { target: { value: 'flour 200 g\nsugar 100 g' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.title).toBe('Probe Soup');
    expect(payload.data.ingredients).toEqual([
      { item: 'flour', qty: '200', unit: 'g', cost: 0 },
      { item: 'sugar', qty: '100', unit: 'g', cost: 0 },
    ]);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Create$/ })).toBeNull());
  });

  it('the Description draft key is per artifact type, not one shared recipe key', () => {
    render(<FoodKitchenWorkbench group="cook" />);
    fireEvent.click(screen.getByRole('button', { name: /New Recipe/ }));
    const desc = document.querySelector('textarea[data-draftkey]');
    expect(desc?.getAttribute('data-draftkey')).toBe('food-description-recipe');
  });

  it('the PantryItem Expiry Date is a typeable text field, not a native date control (F9)', () => {
    render(<FoodKitchenWorkbench group="pantry" />);
    fireEvent.click(screen.getByRole('button', { name: /Add Item/ }));
    const expiry = screen.getAllByPlaceholderText('YYYY-MM-DD')[0] as HTMLInputElement;
    expect(expiry.type).toBe('text');
    fireEvent.change(expiry, { target: { value: '2026-12-01' } });
    expect(expiry.value).toBe('2026-12-01');
  });

  it('typing a full sentence into the editor Name field lands every character (F3 seam)', () => {
    const name = openRecipeEditor();
    fireEvent.change(name, { target: { value: 'probe pantry kitchen notes' } });
    expect((name as HTMLInputElement).value).toBe('probe pantry kitchen notes');
  });
});
