import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const R = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = R.forwardRef<HTMLSpanElement, Record<string, unknown>>((props, ref) =>
      R.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
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

import { ActivityBar } from '@/components/code/ActivityBar';

describe('ActivityBar', () => {
  it('renders every activity button + the settings button', () => {
    render(<ActivityBar active="files" onChange={() => {}} />);
    for (const label of ['Explorer', 'Search', 'Source control', 'Run & debug', 'Extensions', 'Snippets', 'Terminal', 'AI agent', 'Settings']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('marks the active item with aria-pressed=true and others false', () => {
    render(<ActivityBar active="search" onChange={() => {}} />);
    expect(screen.getByLabelText('Search')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Explorer')).toHaveAttribute('aria-pressed', 'false');
  });

  it('fires onChange with the item id when an item is clicked', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="files" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Source control'));
    expect(onChange).toHaveBeenCalledWith('sourceControl');
  });

  it('fires onChange("settings") when the settings button is clicked', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="files" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Settings'));
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('renders the settings button as pressed when active is settings', () => {
    render(<ActivityBar active="settings" onChange={() => {}} />);
    expect(screen.getByLabelText('Settings')).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders a numeric badge when badges has a positive count', () => {
    render(<ActivityBar active="files" onChange={() => {}} badges={{ search: 3 }} />);
    expect(screen.getByLabelText('3 items')).toHaveTextContent('3');
  });

  it('clamps badges over 99 to "99+"', () => {
    render(<ActivityBar active="files" onChange={() => {}} badges={{ debug: 150 }} />);
    expect(screen.getByLabelText('150 items')).toHaveTextContent('99+');
  });

  it('omits the badge when count is zero or absent', () => {
    render(<ActivityBar active="files" onChange={() => {}} badges={{ search: 0 }} />);
    expect(screen.queryByLabelText(/items/)).not.toBeInTheDocument();
  });
});
