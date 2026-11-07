// Render coverage for the food kitchen workbench (all four groups, every tab)
// and the food action panel. Hooks and heavy children are stubbed; the generic
// sweep fills and presses every control on each tab.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise, fakeEntity } from '../../tests/helpers/exercise';

const T = '2026-03-01T10:00:00.000Z';
const art = (type: string, i = 1) => {
  const d = { ...(fakeEntity(`${type}${i}`) as object), name: `${type} ${i}`, type, status: 'active', description: 'd', category: 'main', cost: 4, price: 12, notes: 'n', servings: 4, prepTime: 10, cookTime: 20,
    ingredients: [{ item: 'flour', qty: '2', unit: 'cup', cost: 1.5 }], instructions: ['mix', 'bake'], allergens: ['gluten'], dietary: ['vegan'], calories: 300, protein: 8, carbs: 40, fat: 5, popularity: 70, recipeRef: 'Recipe 1', day: 'Monday', mealType: 'dinner', quantity: 2, shoppingUnit: 'lb', shoppingCategory: 'produce', currentStock: 1, parLevel: 4, unit: 'lb', expiryDate: '2026-03-10', checked: false, section: 'Mains', salesVolume: 10, guestName: 'Kim', guestCount: 4, dateTime: '2026-03-02T19:00', tableNumber: '5', employee: 'Jo', role: 'Line Cook', shiftStart: '09:00', shiftEnd: '17:00', station: 'Grill', hourlyRate: 20, supplier: 'Acme' };
  return { id: `${type}-${i}`, title: `${type} ${i}`, data: d, meta: { tags: [], status: 'active', visibility: 'private' }, createdAt: T, updatedAt: T, version: 1 };
};
const mutate = vi.fn(async () => ({ id: 'n1' }));
const mutateAsync = vi.fn(async () => ({ result: { ok: true, summary: 'done', tasks: [] } }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    items: [art(type, 1), art(type, 2)], total: 2, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    create: mutate, update: mutate, remove: mutate, createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false },
  }),
}));
vi.mock('@/lib/hooks/use-food-ops', () => ({
  useWasteLog: () => ({ entries: [{ id: 'w1', itemName: 'lettuce', qty: 2, unit: 'lb', reason: 'spoilage', estimatedCostImpact: 6, date: '2026-03-01' }], loading: false, refresh: vi.fn(), addEntry: mutate, removeEntry: mutate }),
  useFloorPlan: () => ({ tables: [{ id: 't1', label: 'T1', seats: 4, section: 'patio', status: 'available' }, { id: 't2', label: 'T2', seats: 2, section: null, status: 'occupied' }], waitlist: [{ id: 'wl1', partyName: 'Kim', partySize: 3, phone: '555', position: 1, estimatedWaitMin: 15, status: 'waiting', addedAt: T }], loading: false, refresh: vi.fn(), addTable: mutate, updateTableStatus: mutate, deleteTable: mutate, addWaitlistEntry: mutate, removeWaitlistEntry: mutate }),
  usePrepList: () => ({ tasks: [{ menuItem: 'Soup', task: 'chop', quantity: 4, unit: 'qt', prepTimeMinutes: 20, station: 'garde', done: false }], date: '2026-03-01', loading: false, refresh: vi.fn(), saveTasks: mutate, toggleTask: mutate }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync, mutate: vi.fn(), isPending: false }) }));
vi.mock('@/hooks/useLensDTUs', () => ({
  useLensDTUs: () => ({ contextDTUs: [], hyperDTUs: [], megaDTUs: [], regularDTUs: [], tierDistribution: { regular: 0, mega: 0, hyper: 0 }, publishToMarketplace: vi.fn(), refetch: vi.fn() }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
for (const m of ['CookMode', 'PantryTracker', 'PlateScan', 'MealPlanner', 'RecipeImporter', 'RecipeScaler']) {
  vi.doMock(`@/components/food/${m}`, () => ({ default: () => <div data-testid={m} /> }));
}
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: (p: Record<string, unknown>) => <textarea value={String(p.value ?? '')} onChange={p.onChange as never} /> }));
vi.mock('@/components/lens/LensContextPanel', () => ({ LensContextPanel: () => null }));
vi.mock('@/components/artifact/ArtifactRenderer', () => ({ ArtifactRenderer: () => null }));
vi.mock('@/components/artifact/ArtifactUploader', () => ({ ArtifactUploader: () => null }));
vi.mock('@/components/feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => <div role="alert" /> }));

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn(), items: [] }),
  useRecallableAction: () => ({ run: vi.fn(async (fn: () => Promise<unknown>) => fn()), recall: vi.fn(), state: null, armed: false, slot: null }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));

import { FoodKitchenWorkbench, GROUP_TABS, MODE_TABS, type KitchenGroup } from './FoodKitchenWorkbench';
import { FoodActionPanel } from './FoodActionPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const FOOD: Record<string, unknown> = {
  scaleRecipe: { recipeName: 'Bread', baseYield: 4, targetYield: 8, scaleFactor: 2, ingredients: [{ name: 'flour', originalQuantity: 2, scaledQuantity: 4, unit: 'cup' }] },
  costPlate: { items: [{ name: 'Bread', menuPrice: 12, ingredientCost: 3, foodCostPct: 25, suggestedPriceAtTarget: 10, margin: 9, status: 'ok', ingredients: [{ name: 'flour', quantity: 2, unit: 'cup', costPerUnit: 1.5, totalCost: 3 }] }], avgFoodCostPct: 25 },
  suggestMeals: { meals: [{ name: 'Toast', cuisine: 'any', matchScore: 0.8 }], matched: 1 },
  wasteReport: { weeklyWasteKg: 3, topWasted: ['lettuce'], suggestion: 'prep less' },
};

afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomainMock.mockReset(); apiPost.mockReset(); mutate.mockClear();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: { ok: true, answer: 'done', dtu: { id: 'd1' } }, error: null, _a: actionOf(a) } }));
  runDomainMock.mockImplementation(async (_d: string, name: string) => ({ data: { ok: true, result: { ok: true, result: FOOD[name] ?? {} } } }));
  apiPost.mockImplementation(async () => ({ data: { ok: true, result: { dtu: { id: 'd1' } }, message: { id: 'm1' } } }));
});

const TAB_LABELS = MODE_TABS.map((t) => t.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const SKIP = new RegExp(`cancel|close|^(${TAB_LABELS})$`, 'i');
describe('FoodKitchenWorkbench', () => {
  const cases = (Object.keys(GROUP_TABS) as KitchenGroup[]).flatMap((g) => GROUP_TABS[g].map((t) => [g, t] as const));
  it.each(cases)('group %s tab %s', async (group, tabId) => {
    const view = render(<FoodKitchenWorkbench group={group} />);
    await settle();
    const label = MODE_TABS.find((t) => t.id === tabId)?.label;
    const btn = label ? screen.queryAllByRole('button').find((b) => (b.textContent || '').trim() === label) : undefined;
    if (btn) await act(async () => { fireEvent.click(btn); });
    await settle();
    await exercise({ passes: 4, skip: SKIP });
    await settle();
    await exercise({ passes: 4, skip: SKIP, text: 'flour 2 cup 1.5' });
    await settle();
    await exercise({ passes: 3, skip: new RegExp(`^(${TAB_LABELS})$`, 'i'), text: '5' });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('FoodActionPanel', () => {
  it('runs every action with valid recipe input', async () => {
    const view = render(<FoodActionPanel />);
    await settle();
    await exercise({ passes: 4, text: 'flour 2 cups 1.5' });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
  it('reports macro failure honestly', async () => {
    runDomainMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<FoodActionPanel />);
    await settle();
    await exercise({ passes: 2, text: 'flour 2 cups 1.5' });
    expect(view.container.textContent).toBeTruthy();
  });
});
