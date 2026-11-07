/**
 * chem-chamber.test.tsx — the Reaction Chamber shows its work (Chem S1).
 *
 * The chamber consumed { equation, products[] } while the solver that
 * actually serves /api/lens/run for chem.balanceReaction returns
 * { balanced: "<equation string>", productCoeffs: {…} } — so runs were
 * receipted (the string read truthy into the Success chip) but no equation
 * ever rendered and the mint loop iterated an absent array. These tests
 * drive the panel against the SERVING shape: the balanced equation must
 * render in the chamber, the run must be recorded with it, and each product
 * must mint into the library with a real molecular weight. A solver refusal
 * must surface its own reason and record nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const createReaction = vi.hoisted(() => vi.fn(async (_input: unknown) => ({})));
const createCompound = vi.hoisted(() => vi.fn(async (_input: unknown) => ({})));
const runDomain = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', async () => {
  const React = await import('react');
  return {
    useMutation: (opts: {
      mutationFn: (arg: never) => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
      onError?: (err: Error) => void;
    }) => {
      const [state, setState] = React.useState({ isPending: false, isError: false, error: null as Error | null });
      const mutate = async (arg: never) => {
        setState({ isPending: true, isError: false, error: null });
        try {
          const data = await opts.mutationFn(arg);
          opts.onSuccess?.(data);
          setState({ isPending: false, isError: false, error: null });
        } catch (e) {
          opts.onError?.(e as Error);
          setState({ isPending: false, isError: true, error: e as Error });
        }
      };
      return { mutate, ...state };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) =>
    type === 'compound'
      ? { items: [], refetch: vi.fn(), create: createCompound }
      : { items: [], refetch: vi.fn(), create: createReaction },
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain } },
  api: { post: vi.fn(), get: vi.fn() },
  lensRun: vi.fn(),
}));

import { ReactionsPanel } from '@/components/chem/ReactionsPanel';

const COMPUTE_SHAPE = {
  data: {
    ok: true,
    result: {
      ok: true,
      balanced: 'CH4 + 2O2 → CO2 + 2H2O',
      coefficients: { CH4: 1, O2: 2, CO2: 1, H2O: 2 },
      reactantCoeffs: { CH4: 1, O2: 2 },
      productCoeffs: { CO2: 1, H2O: 2 },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  runDomain.mockImplementation(async (_d: string, action: string, payload: { input?: { formula?: string } }) => {
    if (action === 'balanceReaction') return COMPUTE_SHAPE;
    if (action === 'molecular-weight') {
      return { data: { ok: true, result: { ok: true, molecularWeight: payload.input?.formula === 'CO2' ? 44.009 : 18.015 } } };
    }
    throw new Error(`unexpected action ${action}`);
  });
});

describe('Reaction Chamber (S1)', () => {
  it('renders the balanced equation in the chamber and mints each product with its MW', async () => {
    render(<ReactionsPanel />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\., H2 \+ O2/), { target: { value: 'CH4 + O2 -> CO2 + H2O' } });
    fireEvent.click(screen.getByRole('button', { name: /React/ }));

    const result = await screen.findByTestId('chem-chamber-result');
    expect(result).toHaveTextContent('CH4 + 2O2 → CO2 + 2H2O');

    await waitFor(() => expect(createReaction).toHaveBeenCalledTimes(1));
    const recArg = (createReaction.mock.calls[0] as unknown as [{ title: string; data: { formula: string; success: boolean } }])[0];
    expect(recArg.title).toBe('CH4 + 2O2 → CO2 + 2H2O');
    expect(recArg.data.formula).toBe('CH4 + 2O2 → CO2 + 2H2O');
    expect(recArg.data.success).toBe(true);

    await waitFor(() => expect(createCompound).toHaveBeenCalledTimes(2));
    const minted = (createCompound.mock.calls as unknown as [{ data: { formula: string; molecularWeight: number } }][])
      .map(([arg]) => [arg.data.formula, arg.data.molecularWeight])
      .sort();
    expect(minted).toEqual([['CO2', 44.009], ['H2O', 18.015]]);
  });

  it('surfaces the solver refusal reason and records nothing', async () => {
    runDomain.mockImplementation(async (_d: string, action: string) => {
      if (action === 'balanceReaction') {
        throw { response: { data: { error: 'could not parse "banana" as a chemical formula (no element symbols found)' } } };
      }
      throw new Error(`unexpected action ${action}`);
    });
    render(<ReactionsPanel />);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\., H2 \+ O2/), { target: { value: 'banana -> split' } });
    fireEvent.click(screen.getByRole('button', { name: /React/ }));

    expect(await screen.findByText(/could not parse "banana"/)).toBeTruthy();
    expect(createReaction).not.toHaveBeenCalled();
    expect(createCompound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chem-chamber-result')).toBeNull();
  });
});
