import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { KPIStrip, type KPI } from '@/components/accounting/KPIStrip';

const kpis: KPI[] = [
  { id: 'rev', label: 'Revenue', value: 12500, unit: '$', deltaPct: 12.5, caption: 'vs last month' },
  { id: 'exp', label: 'Expenses', value: 8200, unit: '$', deltaPct: -3.1 },
  { id: 'net', label: 'Net income', value: 4300, unit: '$', deltaPct: 0 },
];

describe('KPIStrip', () => {
  it('renders each kpi label', () => {
    render(<KPIStrip kpis={kpis} />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
    expect(screen.getByText('Net income')).toBeInTheDocument();
  });

  it('renders the period label when supplied', () => {
    render(<KPIStrip kpis={kpis} periodLabel="Q1 2026" />);
    expect(screen.getByText('Q1 2026')).toBeInTheDocument();
  });

  it('renders the caption text when supplied', () => {
    render(<KPIStrip kpis={kpis} />);
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('makes drill-downs clickable', () => {
    const onClick = vi.fn();
    const drillKpis: KPI[] = [{ ...kpis[0], onClick }];
    render(<KPIStrip kpis={drillKpis} />);
    const tile = screen.getByText('Revenue').closest('button, div')!;
    // Buttons are preferred when onClick is set
    const button = tile.tagName === 'BUTTON' ? tile : tile.querySelector('button');
    if (button) fireEvent.click(button);
    else fireEvent.click(tile);
    expect(onClick).toHaveBeenCalled();
  });
});
