import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  motion: {
    div: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...props, ref }, children)),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

import { PathStepCard, type PathStep } from '@/components/education/PathStepCard';

const STEP = (over: Partial<PathStep> = {}): PathStep => ({
  order: 1, title: 'Prove the theorem', ...over,
});

describe('PathStepCard', () => {
  it('renders default study kind when kind is missing', () => {
    render(<PathStepCard step={STEP()} />);
    expect(screen.getByText('Study')).toBeInTheDocument();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    // default estimatedMinutes 15
    expect(screen.getByText('15 min')).toBeInTheDocument();
    // default readiness 0
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it.each([
    ['proof', 'Proof'],
    ['experiment', 'Experiment'],
    ['discuss', 'Discuss'],
    ['build', 'Build'],
    ['explore', 'Explore'],
  ])('resolves kind %s to label %s', (kind, label) => {
    render(<PathStepCard step={STEP({ kind })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('falls back to study for an unknown kind', () => {
    render(<PathStepCard step={STEP({ kind: 'nonsense' })} />);
    expect(screen.getByText('Study')).toBeInTheDocument();
  });

  it('clamps readiness above 1 and below 0', () => {
    const { rerender } = render(<PathStepCard step={STEP({ readiness: 2 })} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    rerender(<PathStepCard step={STEP({ readiness: -1 })} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
    rerender(<PathStepCard step={STEP({ readiness: 0.5 })} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('shows domain and summary when provided', () => {
    render(<PathStepCard step={STEP({ domain: 'math', summary: 'A short summary' })} />);
    expect(screen.getByText('math')).toBeInTheDocument();
    expect(screen.getByText('A short summary')).toBeInTheDocument();
  });

  it('uses provided estimatedMinutes', () => {
    render(<PathStepCard step={STEP({ estimatedMinutes: 42 })} />);
    expect(screen.getByText('42 min')).toBeInTheDocument();
  });

  it('fires onStart when Start clicked and respects starting flag', () => {
    const onStart = vi.fn();
    const { rerender } = render(<PathStepCard step={STEP()} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ order: 1 }));

    rerender(<PathStepCard step={STEP()} onStart={onStart} starting />);
    expect(screen.getByText('Starting...')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not throw when onStart is missing', () => {
    render(<PathStepCard step={STEP()} />);
    fireEvent.click(screen.getByRole('button'));
  });
});
