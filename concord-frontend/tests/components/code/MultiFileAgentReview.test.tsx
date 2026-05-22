import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
        const { initial: _i, animate: _a, exit: _e, transition: _t2, ...rest } = props;
        void _i; void _a; void _e; void _t2;
        return React.createElement(tag, rest, props.children);
      },
    }
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/code/MonacoDiffViewer', () => ({
  default: () => React.createElement('div', { 'data-testid': 'diff' }, 'diff'),
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

import { MultiFileAgentReview, type MultiFileEdit } from '@/components/code/MultiFileAgentReview';

const EDITS: MultiFileEdit[] = [
  {
    filename: 'a.ts',
    scriptId: 's1',
    language: 'typescript',
    before: 'old\ncode',
    after: 'new\ncode\nhere',
    reason: 'cleanup',
  },
  {
    filename: 'b.ts',
    language: 'javascript',
    before: 'x',
    after: 'y',
  },
];

describe('MultiFileAgentReview', () => {
  it('renders nothing when closed', () => {
    render(
      <MultiFileAgentReview
        open={false}
        onClose={vi.fn()}
        prompt="do it"
        edits={EDITS}
        onApply={vi.fn()}
      />
    );
    expect(screen.queryByText('AI Agent · multi-file plan')).not.toBeInTheDocument();
  });

  it('renders the loading state', () => {
    render(
      <MultiFileAgentReview
        open
        loading
        onClose={vi.fn()}
        prompt="do it"
        edits={[]}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText('Planning multi-file edits…')).toBeInTheDocument();
  });

  it('renders the empty-edits state', () => {
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="do it"
        edits={[]}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText("The agent didn't propose any file edits.")).toBeInTheDocument();
  });

  // The accepted-count is split across text nodes ("N file·s · M accepted").
  // Read it back off the live DOM rather than matching a single text node.
  const countSpan = () =>
    Array.from(document.querySelectorAll('span')).find((s) =>
      /\d+ accepted$/.test((s.textContent || '').trim())
    )!;
  const acceptedCount = () => {
    const m = (countSpan().textContent || '').match(/(\d+) accepted/);
    return m ? Number(m[1]) : -1;
  };

  it('renders the edit list and the prompt', async () => {
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="refactor auth"
        edits={EDITS}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText('refactor auth')).toBeInTheDocument();
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
    // first edit expanded by default → its diff + reason show
    expect(screen.getByText('cleanup')).toBeInTheDocument();
    expect(await screen.findAllByTestId('diff')).toHaveLength(1);
  });

  it('accepts and rejects all edits', () => {
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="p"
        edits={EDITS}
        onApply={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Accept all'));
    expect(acceptedCount()).toBe(2);
    fireEvent.click(screen.getByText('Reject all'));
    expect(acceptedCount()).toBe(0);
  });

  it('toggles an individual edit accept status', () => {
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="p"
        edits={EDITS}
        onApply={vi.fn()}
      />
    );
    fireEvent.click(screen.getAllByTitle('Accept')[0]);
    expect(acceptedCount()).toBe(1);
    fireEvent.click(screen.getAllByTitle('Accept')[0]); // toggle back to pending
    expect(acceptedCount()).toBe(0);
  });

  it('toggles an individual edit reject status', () => {
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="p"
        edits={EDITS}
        onApply={vi.fn()}
      />
    );
    const rejectButtons = screen.getAllByTitle('Reject');
    fireEvent.click(rejectButtons[0]);
    fireEvent.click(rejectButtons[0]); // toggle back to pending
    expect(acceptedCount()).toBe(0);
  });

  it('expands and collapses an edit', async () => {
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="p"
        edits={EDITS}
        onApply={vi.fn()}
      />
    );
    // expand the second edit
    fireEvent.click(screen.getByLabelText('Expand'));
    expect(await screen.findAllByTestId('diff')).toHaveLength(2);
    // collapse the first edit
    fireEvent.click(screen.getAllByLabelText('Collapse')[0]);
  });

  it('applies accepted edits and closes', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <MultiFileAgentReview
        open
        onClose={onClose}
        prompt="p"
        edits={EDITS}
        onApply={onApply}
      />
    );
    fireEvent.click(screen.getByText('Accept all'));
    fireEvent.click(screen.getByText('Apply 2'));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0]).toHaveLength(2);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does not apply when nothing is accepted', () => {
    const onApply = vi.fn();
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="p"
        edits={EDITS}
        onApply={onApply}
      />
    );
    expect(screen.getByText('No edits selected to apply')).toBeInTheDocument();
  });

  it('calls onRegenerate when the regenerate button is clicked', () => {
    const onRegenerate = vi.fn();
    render(
      <MultiFileAgentReview
        open
        onClose={vi.fn()}
        prompt="p"
        edits={EDITS}
        onApply={vi.fn()}
        onRegenerate={onRegenerate}
      />
    );
    fireEvent.click(screen.getByTitle('Regenerate plan'));
    expect(onRegenerate).toHaveBeenCalled();
  });

  it('closes via the close and cancel buttons', () => {
    const onClose = vi.fn();
    render(
      <MultiFileAgentReview
        open
        onClose={onClose}
        prompt="p"
        edits={EDITS}
        onApply={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
