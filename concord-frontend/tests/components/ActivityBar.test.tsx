import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { ActivityBar, type Activity } from '@/components/code/ActivityBar';

afterEach(() => cleanup());

describe('ActivityBar', () => {
  it('renders every activity item plus the pinned settings button', () => {
    render(<ActivityBar active="files" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('marks the active item aria-pressed and gives it the active styling', () => {
    render(<ActivityBar active="terminal" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Explorer' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked activity id', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="files" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Source control' }));
    expect(onChange).toHaveBeenCalledWith('sourceControl');
  });

  it('clicking the pinned footer button always changes to settings', () => {
    const onChange = vi.fn();
    render(<ActivityBar active="files" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onChange).toHaveBeenCalledWith('settings');
  });

  it('marks the settings button pressed when active is settings', () => {
    render(<ActivityBar active="settings" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a numeric badge when a count is provided and hides it at zero', () => {
    render(<ActivityBar active="files" onChange={vi.fn()} badges={{ sourceControl: 3, debug: 0 }} />);
    expect(screen.getByLabelText('3 items')).toBeInTheDocument();
    expect(screen.queryByLabelText('0 items')).not.toBeInTheDocument();
  });

  it('caps a badge display at "99+" for counts over 99', () => {
    render(<ActivityBar active="files" onChange={vi.fn()} badges={{ extensions: 150 }} />);
    expect(screen.getByLabelText('150 items')).toHaveTextContent('99+');
  });
});
