import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QBShell, type QBNav } from '@/components/accounting/QBShell';

describe('QBShell', () => {
  it('renders nav groups, items and children', () => {
    render(
      <QBShell activeNav={'dashboard'} onNavChange={vi.fn()}>
        <div>Panel body</div>
      </QBShell>,
    );
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
    // "Expenses" is both a group label and a nav item label
    expect(screen.getAllByText('Expenses').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Panel body')).toBeInTheDocument();
  });

  it('fires onNavChange when a nav button is clicked', () => {
    const onNavChange = vi.fn();
    render(
      <QBShell activeNav={'dashboard'} onNavChange={onNavChange}>
        <div>x</div>
      </QBShell>,
    );
    fireEvent.click(screen.getByText('Banking'));
    expect(onNavChange).toHaveBeenCalledWith('banking');
    fireEvent.click(screen.getByText('P&L'));
    expect(onNavChange).toHaveBeenCalledWith('pl');
  });

  it('highlights the active nav item', () => {
    render(
      <QBShell activeNav={'bills' as QBNav} onNavChange={vi.fn()}>
        <div>x</div>
      </QBShell>,
    );
    const activeBtn = screen.getByText('Bills').closest('button')!;
    expect(activeBtn.className).toContain('border-emerald-400');
  });

  it('renders badges only for non-zero / defined counts', () => {
    render(
      <QBShell
        activeNav={'dashboard'}
        onNavChange={vi.fn()}
        badges={{ banking: 5, bills: 0, invoices: 'new' }}
      >
        <div>x</div>
      </QBShell>,
    );
    expect(screen.getByText('5')).toBeInTheDocument();   // banking badge shown
    expect(screen.getByText('new')).toBeInTheDocument(); // string badge shown
    // bills badge of 0 must NOT render
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders the askBar header when provided and omits it otherwise', () => {
    const { rerender } = render(
      <QBShell activeNav={'dashboard'} onNavChange={vi.fn()} askBar={<div>ASK BAR</div>}>
        <div>x</div>
      </QBShell>,
    );
    expect(screen.getByText('ASK BAR')).toBeInTheDocument();
    rerender(
      <QBShell activeNav={'dashboard'} onNavChange={vi.fn()}>
        <div>x</div>
      </QBShell>,
    );
    expect(screen.queryByText('ASK BAR')).toBeNull();
  });
});
