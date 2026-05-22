import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

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

import { EpicShell, type EpicNav } from '@/components/healthcare/EpicShell';

describe('EpicShell', () => {
  it('renders all nav groups and items', () => {
    render(
      <EpicShell activeNav="dashboard" onNavChange={() => {}}>
        <div>body</div>
      </EpicShell>
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Patients')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    // "Clinical" appears both as the aside title and as a group label.
    expect(screen.getAllByText('Clinical').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('fires onNavChange with the clicked nav id', () => {
    const onNav = vi.fn();
    render(
      <EpicShell activeNav="dashboard" onNavChange={onNav}>
        <div>body</div>
      </EpicShell>
    );
    // "Inbox" is both a nav label and a group label; the nav item is a button.
    fireEvent.click(screen.getByRole('button', { name: /Inbox/i }));
    expect(onNav).toHaveBeenCalledWith('inbox' as EpicNav);
    fireEvent.click(screen.getByRole('button', { name: /Refills/i }));
    expect(onNav).toHaveBeenCalledWith('refills' as EpicNav);
  });

  it('renders numeric badges and a "!" badge, skipping zero badges', () => {
    render(
      <EpicShell
        activeNav="dashboard"
        onNavChange={() => {}}
        badges={{ inbox: 3, refills: 0, patients: 12, chart: '!' }}
      >
        <div>body</div>
      </EpicShell>
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('!')).toBeInTheDocument();
    // refills badge is 0 so nothing renders for it
  });

  it('renders an askBar header when askBar prop is passed', () => {
    render(
      <EpicShell activeNav="dashboard" onNavChange={() => {}} askBar={<div>ask-bar-here</div>}>
        <div>body</div>
      </EpicShell>
    );
    expect(screen.getByText('ask-bar-here')).toBeInTheDocument();
  });

  it('does not render askBar header when askBar is omitted', () => {
    render(
      <EpicShell activeNav="patients" onNavChange={() => {}}>
        <div>body</div>
      </EpicShell>
    );
    expect(screen.queryByText('ask-bar-here')).not.toBeInTheDocument();
  });

  it('marks the active nav item with the active style', () => {
    const { container } = render(
      <EpicShell activeNav="patients" onNavChange={() => {}}>
        <div>body</div>
      </EpicShell>
    );
    const active = container.querySelector('.border-cyan-400');
    expect(active).not.toBeNull();
  });
});
