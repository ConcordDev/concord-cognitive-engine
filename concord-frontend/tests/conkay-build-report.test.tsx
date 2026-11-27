// The build report shows what the solvers checked, in the person's units,
// and what nothing checked with its reason. Values are rendered as given.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BuildReportCard } from '@/components/conkay/workshop/BuildReportCard';
import { isBuildReport, type BuildReport } from '@/lib/conkay/build-report';

const report: BuildReport = {
  verdict: 'fails', headline: '1 of 2 checks fail', units: { length: 'ft', pressure: 'psi' },
  parts: [{ id: 'SHELF', name: 'wall shelf', kind: 'Assembly', children: [{ id: 'BOARD', name: 'board', kind: 'Part', material: 'white-pine', shape: 'box', children: [] }] }],
  masses: [{ id: 'BOARD', name: 'board', mass: '3.4 lb (1.54 kg)' }],
  checked: [
    { solver: 'structure.frame', target: 'SHELF', targetName: 'wall shelf', status: 'FAIL', check: 'books: M1 von Mises ≤ Fy / 2', pass: false, demand: '2650 psi (18.27 MPa)', capacity: '2393 psi (16.5 MPa)', utilization: 1.11, basis: 'the person' },
    { solver: 'electrical.dc-budget', target: 'PACK', targetName: 'lamp power', status: 'PASS', check: 'runtime ≥ required', pass: true, demand: '3 h', capacity: '3.5 h', utilization: 0.86, basis: 'the person' },
  ],
  computed: [],
  gaps: [{ target: 'BOARD', targetName: 'board', solver: 'cost.part', reason: 'no price per kg for Eastern white pine' }],
  questions: [{ ask: 'What wall is it going on?', blocking: false, default: 'wood studs' }],
  assumptions: ['books spread evenly'],
  sources: [{ for: 'pine density', book: 'University Physics Volume 1', section: '14.1', url: 'https://openstax.org/x' }],
};

describe('BuildReportCard', () => {
  it('recognises a report', () => {
    expect(isBuildReport(report)).toBe(true);
    expect(isBuildReport({ kind: 'mesh' })).toBe(false);
  });
  it('shows checks with their numbers and pass/fail, and the gaps with reasons', () => {
    render(<BuildReportCard report={report} title="wall shelf" />);
    expect(screen.getByTestId('build-headline').textContent).toBe('1 of 2 checks fail');
    const checked = screen.getByTestId('build-checked');
    expect(within(checked).getByText(/2650 psi \(18\.27 MPa\) vs 2393 psi/)).toBeTruthy();
    expect(within(checked).getByLabelText('fails')).toBeTruthy();
    expect(within(checked).getByLabelText('passes')).toBeTruthy();
    expect(screen.getByText('What wall is it going on?', { exact: false })).toBeTruthy();
    // nothing-checked list is collapsed when something was checked; opens on click
    fireEvent.click(within(screen.getByTestId('build-gaps')).getByRole('button'));
    expect(screen.getByText(/no price per kg for Eastern white pine/)).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('build-parts')).getByRole('button'));
    expect(screen.getByText('3.4 lb (1.54 kg)')).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('build-sources')).getByRole('button'));
    expect(screen.getByRole('link', { name: /University Physics Volume 1/ }).getAttribute('href')).toBe('https://openstax.org/x');
  });
});
