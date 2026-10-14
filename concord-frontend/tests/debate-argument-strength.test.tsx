/**
 * F1 — Argument Strength must come from evaluateArgument's server verdict.
 * Unevaluated args show "Not evaluated" with no invented percent.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { ArgumentStrengthMeter } from '@/components/debate/LiveFloorPanel';

describe('ArgumentStrengthMeter — F1 server verdict', () => {
  it('renders weak/20 from a server evaluation (not a local string score)', () => {
    const { getByTestId, queryByText } = render(
      <ArgumentStrengthMeter evaluation={{ overallScore: 20, strength: 'weak' }} />,
    );
    expect(getByTestId('argument-strength-label').textContent).toMatch(/Weak\s*\(20%\)/i);
    expect(queryByText(/Moderate/i)).toBeNull();
    expect(queryByText(/65%/)).toBeNull();
  });

  it('unevaluated argument shows Not evaluated with no percent', () => {
    const { getByTestId, queryByText } = render(
      <ArgumentStrengthMeter evaluation={null} />,
    );
    expect(getByTestId('argument-strength-label').textContent).toMatch(/Not evaluated/i);
    expect(queryByText(/%/)).toBeNull();
  });

  it('missing evaluation prop is honest (Not evaluated, no percent)', () => {
    const { getByTestId, queryByText } = render(<ArgumentStrengthMeter />);
    expect(getByTestId('argument-strength-label').textContent).toMatch(/Not evaluated/i);
    expect(queryByText(/%/)).toBeNull();
  });
});
