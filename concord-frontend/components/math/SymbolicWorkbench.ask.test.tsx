/// <reference types="@testing-library/jest-dom/vitest" />
// Renderer contract for the CAS Ask card. math.naturalQuery returns a
// different payload per kind; the card must show each one as text and must
// never fall through to String(object) or a bare em-dash on success.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { SymbolicWorkbench } from './SymbolicWorkbench';

const EM_DASH = '\u2014';

function expectHonest(text: string) {
  expect(text).not.toContain('[object Object]');
  expect(text).not.toContain(EM_DASH);
  expect(text).not.toMatch(/\bundefined\b/);
  expect(text).not.toMatch(/\bNaN\b/);
  expect(text.trim()).not.toBe('');
}

function mockQuery(result: unknown) {
  lensRun.mockImplementation(async (domain: string, action: string) => {
    if (domain !== 'math') return { data: { ok: false, result: null, error: 'unexpected domain' } };
    if (action === 'casHistory') return { data: { ok: true, result: { recorded: true }, error: null } };
    if (action === 'naturalQuery') return { data: { ok: true, result, error: null } };
    return { data: { ok: false, result: null, error: `unexpected action ${action}` } };
  });
}

async function ask(query: string, expected?: string) {
  const input = screen.getByPlaceholderText(/integral of x\^2 from 0 to 5/i);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByTestId('cas-ask-submit'));
  await screen.findByTestId('ask-result');
  if (expected) {
    await waitFor(() => expect(screen.getByTestId('ask-result')).toHaveTextContent(expected));
  }
  const shown = screen.getByTestId('ask-result');
  expectHonest(shown.textContent || '');
  return shown;
}

const SOLVE_TWO_REAL = {
  kind: 'solve',
  answer: {
    kind: 'quadratic',
    variable: 'x',
    coefficients: { a: 1, b: -5, c: 6 },
    rootKind: 'two-real',
    roots: [3, 2],
    steps: [
      'Equation: x^2 - 5x + 6 = 0',
      'x₁ = 3',
      'x₂ = 2',
    ],
  },
};

describe('SymbolicWorkbench Ask result card', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders two real roots and keeps the working collapsed', async () => {
    mockQuery(SOLVE_TWO_REAL);
    render(<SymbolicWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'solve x^2 - 5x + 6 = 0' }));
    const card = await ask('solve x^2 - 5x + 6 = 0');
    expect(card).toHaveTextContent('x = 3, x = 2');
    expect(card).not.toHaveTextContent('[object Object]');
    const steps = screen.getByTestId('ask-steps');
    expect(steps).not.toHaveAttribute('open');
    expect(steps).toHaveTextContent('Steps (3)');
    expect(steps).toHaveTextContent('Equation: x^2 - 5x + 6 = 0');
    fireEvent.click(screen.getByText('Steps (3)'));
    expect(steps).toHaveAttribute('open');
    const queryCall = lensRun.mock.calls.find((call) => call[1] === 'naturalQuery');
    expect(queryCall?.[0]).toBe('math');
    expect(queryCall?.[2]).toEqual({ query: 'solve x^2 - 5x + 6 = 0' });
  });

  it('renders a repeated root, one real root, complex roots, no solution, and a linear root', async () => {
    const cases: { result: unknown; text: string }[] = [
      {
        result: {
          kind: 'solve',
          answer: { kind: 'quadratic', variable: 'x', rootKind: 'repeated', roots: [2], steps: ['one repeated root'] },
        },
        text: 'x = 2 (repeated root)',
      },
      {
        result: {
          kind: 'solve',
          answer: { kind: 'quadratic', variable: 'x', rootKind: 'one-real', roots: [4], steps: ['one real root'] },
        },
        text: 'x = 4',
      },
      {
        result: {
          kind: 'solve',
          answer: {
            kind: 'quadratic',
            variable: 'x',
            rootKind: 'complex',
            roots: [{ real: 0, imag: 1 }, { real: 0, imag: -1 }],
            steps: ['discriminant < 0'],
          },
        },
        text: 'x = i, x = \u2212i',
      },
      {
        result: {
          kind: 'solve',
          answer: { kind: 'no-solution', variable: 'x', rootKind: 'none', roots: [], steps: ['constant ≠ 0'] },
        },
        text: 'no solution',
      },
      {
        result: {
          kind: 'solve',
          answer: { kind: 'linear', variable: 'x', roots: [-2], steps: ['divide by 2'] },
        },
        text: 'x = -2',
      },
      {
        result: {
          kind: 'solve',
          answer: { kind: 'identity', variable: 'x', roots: 'infinite', steps: ['both sides reduce to an identity'] },
        },
        text: 'infinitely many solutions',
      },
    ];

    render(<SymbolicWorkbench />);
    for (const entry of cases) {
      mockQuery(entry.result);
      const card = await ask('solve', entry.text);
      expect(card).toHaveTextContent(entry.text);
      expectHonest(card.textContent || '');
    }
  });

  it("renders '7919 is prime' and 'is not prime'", async () => {
    render(<SymbolicWorkbench />);
    mockQuery({ kind: 'isprime', number: 7919, isPrime: true });
    expect(await ask('is 7919 prime', '7919 is prime')).toHaveTextContent('7919 is prime');
    mockQuery({ kind: 'isprime', number: 7919, isPrime: false });
    const composite = await ask('is 7919 prime', '7919 is not prime');
    expect(composite).toHaveTextContent('7919 is not prime');
    expect(composite.textContent || '').not.toContain(EM_DASH);
  });

  it('renders prime factors in exponent form without a placeholder dash', async () => {
    mockQuery({ kind: 'factorize', number: 5040, primeFactors: [2, 2, 2, 2, 3, 3, 5, 7] });
    render(<SymbolicWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: 'factor 5040' }));
    const card = await ask('factor 5040');
    expect(card).toHaveTextContent('5040 = 2^4 \u00d7 3^2 \u00d7 5 \u00d7 7');
    expect(card.textContent || '').not.toContain(EM_DASH);
    expect(card.querySelectorAll('div').length).toBeGreaterThan(0);
    const lines = (card.textContent || '').split('\n').map((line) => line.trim()).filter(Boolean);
    expect(lines.some((line) => line === EM_DASH || line === '—')).toBe(false);
  });

  it('renders a converted value with its unit', async () => {
    mockQuery({ kind: 'convert', answer: 62.13711922, from: 'km', to: 'mi' });
    render(<SymbolicWorkbench />);
    const card = await ask('convert 100 km to mi');
    expect(card).toHaveTextContent('62.13711922 mi');
  });

  it('renders a simplified expression exactly as the CAS returned it', async () => {
    mockQuery({ kind: 'simplify', answer: '5 * x' });
    render(<SymbolicWorkbench />);
    const card = await ask('simplify 2x + 3x - 0');
    expect(card).toHaveTextContent('5 * x');
  });

  it('keeps derivative, definite integral, antiderivative, and evaluate readable', async () => {
    render(<SymbolicWorkbench />);

    mockQuery({ kind: 'derivative', answer: 'cos(x) * x + sin(x)' });
    expect(await ask('derivative of sin(x)*x', 'cos(x) * x + sin(x)')).toHaveTextContent('cos(x) * x + sin(x)');

    mockQuery({
      kind: 'definite-integral',
      answer: 41.66666667,
      closedForm: true,
      expression: 'x^2',
      bounds: [0, 5],
    });
    const integral = await ask('integral of x^2 from 0 to 5', '41.66666667');
    expect(integral).toHaveTextContent('41.66666667');
    expect(integral).toHaveTextContent('bounds [0, 5]');
    expect(integral).toHaveTextContent('closed form');

    mockQuery({ kind: 'antiderivative', answer: 'x ^ 3 / 3 + C', closedForm: true });
    expect(await ask('integral of x^2', 'x ^ 3 / 3 + C')).toHaveTextContent('x ^ 3 / 3 + C');

    mockQuery({ kind: 'antiderivative', answer: null, closedForm: false });
    expect(await ask('integral of sin(x^x)', 'no closed form')).toHaveTextContent('no closed form');

    mockQuery({ kind: 'evaluate', answer: 42 });
    expect(await ask('6*7', '42')).toHaveTextContent('42');
  });

  it('renders a numeric solve and an unrecognized kind as readable text', async () => {
    render(<SymbolicWorkbench />);
    mockQuery({
      kind: 'solve',
      answer: { kind: 'numeric', variable: 'x', roots: [1.57079633], steps: ['bisection'], bracket: [0, 3] },
    });
    expect(await ask('solve cos(x) = 0', 'x = 1.57079633')).toHaveTextContent('x = 1.57079633');

    mockQuery({ kind: 'mystery', foo: { bar: 1 } });
    const card = await ask('mystery', '"bar": 1');
    expect(card).toHaveTextContent('"kind": "mystery"');
    expect(card).toHaveTextContent('"bar": 1');
    expectHonest(card.textContent || '');
  });

  it('shows the solver error instead of a dash when solve returns no answer', async () => {
    mockQuery({ kind: 'solve', answer: null, detail: { ok: false, error: 'Parse error: unexpected token' } });
    render(<SymbolicWorkbench />);
    const card = await ask('solve ???');
    expect(card).toHaveTextContent('Parse error: unexpected token');
    expectHonest(card.textContent || '');
  });
});
