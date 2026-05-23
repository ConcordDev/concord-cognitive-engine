import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KPIStrip, PeriodSelector, type KPI, type Period } from '@/components/accounting/KPIStrip';

const kpis: KPI[] = [
  { id: 'rev', label: 'Revenue', value: 1_250_000, unit: '$', deltaPct: 12.5, caption: 'vs last month' },
  { id: 'exp', label: 'Expenses', value: 82_000, unit: '$', deltaPct: -3.1 },
  { id: 'net', label: 'Net income', value: 4300, unit: '$', deltaPct: 0 },
  { id: 'mar', label: 'Margin', value: 34.27, unit: '%', tone: 'positive' },
  { id: 'str', label: 'Note', value: 'fresh', caption: 'string value' },
];

describe('KPIStrip', () => {
  it('returns null for an empty kpi list', () => {
    const { container } = render(<KPIStrip kpis={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders every kpi label and the period label', () => {
    render(<KPIStrip kpis={kpis} periodLabel="Q1 2026" />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
    expect(screen.getByText('Q1 2026')).toBeInTheDocument();
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('formats values across compact-number thresholds', () => {
    render(<KPIStrip kpis={kpis} />);
    expect(screen.getByText('$1.3M')).toBeInTheDocument(); // >= 1M (1.25M rounds to 1.3)
    expect(screen.getByText('$82K')).toBeInTheDocument();   // >= 10K
    expect(screen.getByText('$4.3K')).toBeInTheDocument();  // >= 1K
    expect(screen.getByText('34.3%')).toBeInTheDocument();  // % unit
    expect(screen.getByText('fresh')).toBeInTheDocument();  // string value
  });

  it('renders positive / negative / neutral deltas with sign formatting', () => {
    render(<KPIStrip kpis={kpis} />);
    expect(screen.getByText('+12.5%')).toBeInTheDocument(); // positive sign
    expect(screen.getByText('-3.1%')).toBeInTheDocument();  // negative no extra sign
    expect(screen.getByText('0.0%')).toBeInTheDocument();   // neutral zero
  });

  it('renders a div tile when no onClick, a button tile when onClick present', () => {
    const onClick = vi.fn();
    render(<KPIStrip kpis={[{ id: 'a', label: 'Plain', value: 5 }, { id: 'b', label: 'Click', value: 7, onClick }]} />);
    const plainTile = screen.getByText('Plain').closest('[role="listitem"]')!;
    expect(plainTile.tagName).toBe('DIV');
    const clickTile = screen.getByText('Click').closest('[role="listitem"]')!;
    expect(clickTile.tagName).toBe('BUTTON');
    fireEvent.click(clickTile);
    expect(onClick).toHaveBeenCalled();
  });

  it('formats a string value with a unit appended', () => {
    render(<KPIStrip kpis={[{ id: 's', label: 'Status', value: 'OK', unit: '!' }]} />);
    expect(screen.getByText('OK!')).toBeInTheDocument();
  });
});

describe('PeriodSelector', () => {
  it('marks the active period and fires onChange', () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={'mtd' as Period} onChange={onChange} />);
    const active = screen.getByText('This month');
    expect(active).toHaveAttribute('aria-checked', 'true');
    const ytd = screen.getByText('YTD');
    expect(ytd).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(ytd);
    expect(onChange).toHaveBeenCalledWith('ytd');
  });

  it('renders all six period buttons', () => {
    render(<PeriodSelector value={'qtd' as Period} onChange={vi.fn()} />);
    ['This month', 'This quarter', 'YTD', 'Last month', 'Last quarter', 'Last year']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });
});
