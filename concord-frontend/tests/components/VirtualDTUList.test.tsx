import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ totalCount, itemContent }: { totalCount: number; itemContent: (index: number) => React.ReactNode }) => (
    <div>
      {Array.from({ length: totalCount }, (_, i) => (
        <div key={i}>{itemContent(i)}</div>
      ))}
    </div>
  ),
}));

import { VirtualDTUList } from '@/components/lists/VirtualDTUList';

const created = new Date('2020-01-02T03:04:05.000Z');
const updated = new Date();

function row(over: Partial<{ id: string; title: string; tier: 'regular' | 'mega'; tags: string[]; createdAt: Date; updatedAt: Date; resonance: number }> = {}) {
  return {
    id: 'a',
    title: 'Old thought',
    excerpt: 'excerpt',
    tier: 'regular' as const,
    tags: ['one', 'two', 'three'],
    createdAt: created,
    updatedAt: updated,
    resonance: 0.5,
    connectionCount: 2,
    isFavorite: false,
    ...over,
  };
}

describe('VirtualDTUList', () => {
  it('shows creation time, not the updated clock', () => {
    render(<VirtualDTUList dtus={[row()]} showFilters={false} />);
    const label = screen.getByText(/ago|just now/);
    expect(label.textContent).not.toBe('just now');
    expect(screen.getByText('Old thought')).toBeTruthy();
  });

  it('filters, sorts, and opens the row menu', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onFavorite = vi.fn();
    const onDuplicate = vi.fn();
    const onSelect = vi.fn();
    render(
      <VirtualDTUList
        dtus={[
          row(),
          row({ id: 'b', title: 'Mega thought', tier: 'mega', tags: [], resonance: 0.1, createdAt: new Date('2021-01-01T00:00:00.000Z') }),
        ]}
        onEdit={onEdit}
        onDelete={onDelete}
        onFavorite={onFavorite}
        onDuplicate={onDuplicate}
        onSelect={onSelect}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search DTUs...'), { target: { value: 'Mega' } });
    expect(screen.queryByText('Old thought')).toBeNull();
    fireEvent.click(screen.getByText('×'));
    fireEvent.click(screen.getByRole('button', { name: 'mega' }));
    fireEvent.click(screen.getByRole('button', { name: 'all' }));
    fireEvent.click(screen.getByRole('button', { name: /Created/ }));
    fireEvent.click(screen.getByRole('button', { name: /Title/ }));
    fireEvent.click(screen.getByRole('button', { name: /Resonance/ }));
    fireEvent.click(screen.getByRole('button', { name: /Updated/ }));
    fireEvent.click(screen.getByText('Old thought'));
    expect(onSelect).toHaveBeenCalled();
    fireEvent.click(screen.getAllByLabelText('More options')[0]);
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getAllByLabelText('More options')[0]);
    fireEvent.click(screen.getByText('Duplicate'));
    fireEvent.click(screen.getAllByLabelText('More options')[0]);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalled();
    fireEvent.click(screen.getAllByLabelText('Favorite')[0]);
    expect(onFavorite).toHaveBeenCalled();
  });

  it('renders the empty state', () => {
    render(<VirtualDTUList dtus={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});
