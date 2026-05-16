import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const addToast = vi.fn();
const create = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
    dtus: { create: (...args: unknown[]) => create(...args) },
  },
}));
vi.mock('@/store/ui', () => ({ useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }) }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { NutritionExplorer } from '@/components/cooking/NutritionExplorer';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('NutritionExplorer', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
  });

  it('renders empty state until a search is run', () => {
    renderWithQuery(<NutritionExplorer />);
    expect(screen.getByPlaceholderText(/apple/i)).toBeInTheDocument();
    expect(screen.getByText(/600,000\+ foods/i)).toBeInTheDocument();
  });

  it('debounces typeahead + shows generic/branded grouped suggestions', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: {
      foods: [
        { fdcId: 1, description: 'Apple, raw', dataType: 'Foundation', score: 95 },
        { fdcId: 2, description: 'Apple juice, raw', dataType: 'SR Legacy', score: 90 },
        { fdcId: 3, description: 'Honeycrisp Apple', dataType: 'Branded', brandOwner: 'Stemilt' },
      ],
      totalHits: 3,
    } } } });
    renderWithQuery(<NutritionExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/apple/i), { target: { value: 'apple' } });
    // 300ms debounce — wait through it
    await waitFor(() => expect(runDomain).toHaveBeenCalled(), { timeout: 1000 });
    await waitFor(() => expect(screen.getByText(/Generic foods/i)).toBeInTheDocument());
    // Description is highlighted (split into <strong> + <span>), so use text-matcher fn
    expect(screen.getAllByText((_t, el) => (el?.textContent || '') === 'Apple, raw').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Branded').length).toBeGreaterThan(0);
    expect(screen.getByText(/Stemilt/)).toBeInTheDocument();
  });

  it('clicking a suggestion fetches usda-nutrition with the fdcId', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'usda-search') {
        return { data: { ok: true, result: { ok: true, result: { foods: [{ fdcId: 1102702, description: 'Apple, raw', dataType: 'Foundation', score: 95 }], totalHits: 1 } } } };
      }
      if (action === 'usda-nutrition') {
        return { data: { ok: true, result: { ok: true, result: {
          fdcId: 1102702,
          description: 'Apple, raw',
          dataType: 'Foundation',
          servingSize: 100,
          servingSizeUnit: 'g',
          headline: {
            caloriesKcal: 52, proteinG: 0.3, totalFatG: 0.2, saturatedFatG: 0.03,
            carbsG: 14, fiberG: 2.4, sugarG: 10.4, sodiumMg: 1,
            calciumMg: 6, ironMg: 0.12, potassiumMg: 107, vitaminCMg: 4.6,
          },
          nutrients: { 'Vitamin A': { amount: 3, unit: 'µg' } },
          source: 'usda-fooddata-central',
        } } } };
      }
      return { data: { ok: false } };
    });
    renderWithQuery(<NutritionExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/apple/i), { target: { value: 'apple' } });
    await waitFor(() => {
      const matches = screen.getAllByText((_t, el) => (el?.textContent || '') === 'Apple, raw');
      expect(matches.length).toBeGreaterThan(0);
    }, { timeout: 1000 });
    const target = screen.getAllByText((_t, el) => (el?.textContent || '') === 'Apple, raw')[0];
    fireEvent.mouseDown(target);
    await waitFor(() => {
      const c = runDomain.mock.calls.find((x) => x[1] === 'usda-nutrition');
      expect((c?.[2] as { input?: { fdcId?: number } })?.input?.fdcId).toBe(1102702);
    });
    // Headline kcal renders
    await waitFor(() => expect(screen.getByText('52')).toBeInTheDocument());
    // Protein/Carbs/Fat appear in both the Tier 1 macro card AND the Tier 2 %DV list
    expect(screen.getAllByText('Protein').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Carbs').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Fat').length).toBeGreaterThanOrEqual(1);
  });

  it('shows %DV bars in the Tier 2 expansion', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'usda-search') return { data: { ok: true, result: { ok: true, result: { foods: [{ fdcId: 1, description: 'Salt', dataType: 'Foundation' }], totalHits: 1 } } } };
      if (action === 'usda-nutrition') return { data: { ok: true, result: { ok: true, result: {
        fdcId: 1, description: 'Salt', dataType: 'Foundation',
        headline: {
          caloriesKcal: 0, proteinG: 0, totalFatG: 0, saturatedFatG: 0,
          carbsG: 0, fiberG: 0, sugarG: 0, sodiumMg: 38758,
          calciumMg: null, ironMg: null, potassiumMg: null, vitaminCMg: null,
        },
        nutrients: {},
        source: 'usda-fooddata-central',
      } } } };
      return { data: { ok: false } };
    });
    renderWithQuery(<NutritionExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/apple/i), { target: { value: 'salt' } });
    await waitFor(() => {
      const matches = screen.queryAllByText((_t, el) => (el?.textContent || '') === 'Salt');
      expect(matches.length).toBeGreaterThan(0);
    }, { timeout: 1000 });
    const saltTarget = screen.getAllByText((_t, el) => (el?.textContent || '') === 'Salt')[0];
    fireEvent.mouseDown(saltTarget);
    await waitFor(() => expect(screen.getByText('Sodium')).toBeInTheDocument());
    // 38758/2300 → ~1685% — display caps at 200% but the % DV indicator is still over-ceiling
    expect(screen.getAllByText((_t, el) => /200% DV/.test(el?.textContent || '')).length).toBeGreaterThan(0);
  });

  it('surfaces empty-result error', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'fdc rate limit exceeded — set FDC_API_KEY env' } } });
    renderWithQuery(<NutritionExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/apple/i), { target: { value: 'zz' } });
    await waitFor(() => expect(screen.getByText(/rate limit/i)).toBeInTheDocument(), { timeout: 1000 });
  });
});
