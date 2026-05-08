import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
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

import { CreatorBadge } from '@/components/dtu/CreatorBadge';

describe('CreatorBadge', () => {
  it('renders the creator display name', () => {
    render(<CreatorBadge creator={{ id: 'u1', displayName: 'Ada' }} />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('falls back to a truncated id when no displayName', () => {
    render(<CreatorBadge creator={{ id: 'u-abcdefghij' }} />);
    expect(screen.getByText('u-abcdef')).toBeInTheDocument();
  });

  it('shows "Anonymous" for missing creator', () => {
    render(<CreatorBadge />);
    expect(screen.getByText('Anonymous')).toBeInTheDocument();
  });

  it('formats royalty rate and earnings together', () => {
    render(
      <CreatorBadge
        creator={{ id: 'u1', displayName: 'Ada' }}
        royaltyRate={0.21}
        royaltyEarnedCc={3400}
      />
    );
    expect(screen.getByText(/21\.0% royalty.*3\.4k CC/)).toBeInTheDocument();
  });

  it('hides royalty chip when both rate and earnings are missing', () => {
    render(<CreatorBadge creator={{ id: 'u1', displayName: 'Ada' }} />);
    expect(screen.queryByText(/CC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/royalty/)).not.toBeInTheDocument();
  });

  it('compact mode renders only the creator chip', () => {
    render(
      <CreatorBadge
        creator={{ id: 'u1', displayName: 'Ada' }}
        royaltyRate={0.5}
        compact
      />
    );
    expect(screen.queryByText(/royalty/)).not.toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });

  it('fires onClickCreator with the creator id', () => {
    const onClick = vi.fn();
    render(
      <CreatorBadge creator={{ id: 'u1', displayName: 'Ada' }} onClickCreator={onClick} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Creator: Ada/ }));
    expect(onClick).toHaveBeenCalledWith('u1');
  });
});
