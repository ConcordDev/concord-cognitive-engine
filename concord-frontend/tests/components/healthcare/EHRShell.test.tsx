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

import { EHRShell, type EHRPatient, type VitalSet, type EHREncounter } from '@/components/healthcare/EHRShell';

const patient: EHRPatient = {
  id: 'p1',
  name: 'Jane Doe',
  age: 47,
  sex: 'F',
  mrn: 'MRN-001',
  allergies: ['Penicillin', 'Latex'],
  alerts: ['Fall risk'],
  pcp: 'Dr. Smith',
  insurance: 'BlueCross PPO',
};

const encounters: EHREncounter[] = [
  { id: 'e1', date: '2026-05-01', reason: 'Annual physical', provider: 'Dr. Smith' },
  { id: 'e2', date: '2026-03-15', reason: 'Flu visit' },
];

describe('EHRShell', () => {
  it('renders patient header with demographics, alerts and allergies', () => {
    render(
      <EHRShell patient={patient} encounters={encounters}>
        <div>main content</div>
      </EHRShell>
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/47 y/)).toBeInTheDocument();
    expect(screen.getByText('Fall risk')).toBeInTheDocument();
    expect(screen.getByText(/Penicillin, Latex/)).toBeInTheDocument();
    // "Dr. Smith" appears both as PCP in the header and as encounter provider
    // in the left rail — assert at least one match rather than a unique one.
    expect(screen.getAllByText(/Dr. Smith/).length).toBeGreaterThan(0);
    expect(screen.getByText('main content')).toBeInTheDocument();
  });

  it('omits age/sex/alerts/allergies/pcp when absent', () => {
    const bare: EHRPatient = { id: 'p2', name: 'No Info', mrn: 'MRN-002' };
    render(
      <EHRShell patient={bare} encounters={[]}>
        <div>x</div>
      </EHRShell>
    );
    // age null -> em-dash
    expect(screen.getByText(/— · — · MRN MRN-002/)).toBeInTheDocument();
    expect(screen.queryByText('Fall risk')).not.toBeInTheDocument();
  });

  it('renders the vitals strip with values and takenAt when vitals provided', () => {
    const vitals: VitalSet = {
      bp: '120/80', hr: 72, tempF: 98.6, spo2: 98, resp: 16,
      takenAt: '2026-05-01T10:00:00Z',
    };
    render(
      <EHRShell patient={patient} vitals={vitals} encounters={encounters}>
        <div>x</div>
      </EHRShell>
    );
    expect(screen.getByText('120/80')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('98.6')).toBeInTheDocument();
    expect(screen.getByText(/taken/)).toBeInTheDocument();
  });

  it('shows em-dashes in vitals strip when vital fields are missing and no takenAt', () => {
    render(
      <EHRShell patient={patient} vitals={{}} encounters={encounters}>
        <div>x</div>
      </EHRShell>
    );
    // multiple em-dashes for the empty vitals
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/taken/)).not.toBeInTheDocument();
  });

  it('does not render the vitals strip when vitals prop is absent', () => {
    render(
      <EHRShell patient={patient} encounters={encounters}>
        <div>x</div>
      </EHRShell>
    );
    expect(screen.queryByText('BP')).not.toBeInTheDocument();
  });

  it('fires onSelectEncounter when an encounter button is clicked', () => {
    const onSelect = vi.fn();
    render(
      <EHRShell
        patient={patient}
        encounters={encounters}
        activeEncounterId="e1"
        onSelectEncounter={onSelect}
      >
        <div>x</div>
      </EHRShell>
    );
    fireEvent.click(screen.getByText('Flu visit'));
    expect(onSelect).toHaveBeenCalledWith(encounters[1]);
  });

  it('does not throw when an encounter is clicked without onSelectEncounter', () => {
    render(
      <EHRShell patient={patient} encounters={encounters}>
        <div>x</div>
      </EHRShell>
    );
    expect(() => fireEvent.click(screen.getByText('Annual physical'))).not.toThrow();
  });
});
