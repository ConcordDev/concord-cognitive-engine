import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Coverage for the canonical `components/ui/EmptyState.tsx` primitive
 * (2026-07-23 maturity-audit consolidation, item #10). The two shims —
 * `components/common/EmptyState.tsx` and `components/lens/EmptyStateCTA.tsx`
 * — keep their own existing test files (`tests/components/EmptyState.test.tsx`,
 * `tests/components/EmptyStateCTA.test.tsx`) unchanged; those now exercise
 * this component indirectly through the shim. This file exercises the
 * canonical component's own API directly, including the superset bits
 * (`action.icon` / `action.className`) added specifically so EmptyStateCTA
 * could delegate to it losslessly.
 */
describe('EmptyState (canonical, components/ui/EmptyState)', () => {
  it('renders the title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders a default title when none is given', () => {
    render(<EmptyState />);
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="No items" description="Try adding some items" />);
    expect(screen.getByText('Try adding some items')).toBeInTheDocument();
  });

  it('omits the icon slot by default when no icon is passed and none is forced null', () => {
    // Default behavior: an icon IS shown (generic Inbox glyph) unless the
    // caller explicitly opts out with `icon={null}`.
    const { container } = render(<EmptyState title="No items" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('omits the icon entirely when icon is explicitly null', () => {
    const { container } = render(<EmptyState title="No items" icon={null} />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders a primary action and fires onClick', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No items" action={{ label: 'Add Item', onClick }} />);
    const button = screen.getByRole('button', { name: /add item/i });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a secondary action alongside the primary one', () => {
    render(
      <EmptyState
        title="No items"
        action={{ label: 'Add', onClick: vi.fn() }}
        secondaryAction={{ label: 'Cancel', onClick: vi.fn() }}
      />,
    );
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('disables the action button when action.disabled is true', () => {
    render(<EmptyState title="No items" action={{ label: 'Add', onClick: vi.fn(), disabled: true }} />);
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled();
  });

  it('renders action.icon alongside the label without breaking text lookup (EmptyStateCTA parity)', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No items"
        action={{
          label: 'Create your first document',
          onClick,
          icon: <span data-testid="spinner" />,
        }}
      />,
    );
    // Exactly one match — the icon must not be wrapped in an intermediate
    // element that duplicates the button's own text content (which would
    // break a caller's `getByText(label)` with a "multiple elements" error).
    const button = screen.getByRole('button', { name: /create your first document/i });
    expect(button).toBeInTheDocument();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies action.className as a full override of the default button styling', () => {
    render(
      <EmptyState
        title="No items"
        action={{ label: 'Add', onClick: vi.fn(), className: 'my-accent-button' }}
      />,
    );
    const button = screen.getByRole('button', { name: /add/i });
    expect(button).toHaveClass('my-accent-button');
  });

  it('applies compact padding', () => {
    const { container } = render(<EmptyState title="Compact" compact />);
    expect(container.firstChild).toHaveClass('py-6');
  });

  it('applies custom className on the outer region', () => {
    render(<EmptyState title="Custom" className="custom-class" />);
    expect(document.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('uses a custom aria-label when provided', () => {
    render(<EmptyState title="No items" ariaLabel="Search results" />);
    expect(screen.getByRole('region', { name: 'Search results' })).toBeInTheDocument();
  });
});
