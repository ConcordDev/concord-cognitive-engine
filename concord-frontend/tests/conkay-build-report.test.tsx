// The build report shows what the solvers checked, in the person's units,
// and what nothing checked with its reason. Values are rendered as given.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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

describe('BuildReportCard — working on a build', () => {
  const withParams: BuildReport = {
    ...report,
    partStatus: { BOARD: 'fail' },
    checked: report.checked.map((c, i) => (i === 0 ? { ...c, part: 'BOARD' } : c)),
    parameters: [
      { id: 'BOARD:geometry.height', node: 'BOARD', nodeName: 'board', label: 'height', value: '3/4 in', dim: 'length' },
      { id: 'BOARD:material', node: 'BOARD', nodeName: 'board', label: 'material', value: 'white-pine', dim: 'material', options: ['white-pine', 'steel-a36'] },
      { id: 'SHELF:props.frameModel.loadCases.0.udl.0.w.2', node: 'SHELF', nodeName: 'wall shelf', label: 'books: spread load on M1 (z)', value: '-24.3 lbf/ft', dim: 'force_per_length' },
    ],
  };

  it('picking a part shows its status, its checks and its values; an edit is sent in the units typed', async () => {
    const onEdit = vi.fn(async () => ({ ok: true }));
    const onSelect = vi.fn();
    const { rerender } = render(<BuildReportCard report={withParams} onSelect={onSelect} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId('build-part-BOARD'));
    expect(onSelect).toHaveBeenCalledWith('BOARD');
    rerender(<BuildReportCard report={withParams} selected="BOARD" onSelect={onSelect} onEdit={onEdit} />);
    const focus = screen.getByTestId('build-part-focus');
    expect(within(focus).getByTestId('build-part-status').textContent).toBe('fails a check');
    expect(within(focus).getByText(/von Mises/)).toBeTruthy();
    expect(within(focus).queryByText(/runtime/)).toBeNull();
    const h = within(focus).getByLabelText('height') as HTMLInputElement;
    expect(h.value).toBe('3/4 in');
    fireEvent.change(h, { target: { value: '1 1/2 in' } });
    fireEvent.keyDown(h, { key: 'Enter' });
    fireEvent.blur(h);
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ id: 'BOARD:geometry.height', value: '1 1/2 in' }]));
    fireEvent.change(within(focus).getByLabelText('material'), { target: { value: 'steel-a36' } });
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([{ id: 'BOARD:material', value: 'steel-a36' }]));
  });

  it('a refused edit says why and puts the value back', async () => {
    const onEdit = vi.fn(async () => ({ ok: false, errors: ['board height: expected a length, got "5 kg" (a mass)'] }));
    render(<BuildReportCard report={withParams} selected="BOARD" onSelect={vi.fn()} onEdit={onEdit} />);
    const h = screen.getByLabelText('height') as HTMLInputElement;
    fireEvent.change(h, { target: { value: '5 kg' } });
    fireEvent.blur(h);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/expected a length/);
    expect(h.value).toBe('3/4 in');
  });

  it('loads and the safety factor are edited under Loads and settings', async () => {
    const onEdit = vi.fn(async () => ({ ok: true }));
    render(<BuildReportCard report={withParams} onSelect={vi.fn()} onEdit={onEdit} />);
    fireEvent.click(within(screen.getByTestId('build-settings')).getByRole('button', { name: /Loads and settings/ }));
    const load = screen.getByLabelText('books: spread load on M1 (z)') as HTMLInputElement;
    expect(load.value).toBe('-24.3 lbf/ft');
    fireEvent.change(load, { target: { value: '40 lbf/ft' } });
    fireEvent.blur(load);
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([{ id: 'SHELF:props.frameModel.loadCases.0.udl.0.w.2', value: '40 lbf/ft' }]));
  });
});

describe('BuildReportCard — STEP', () => {
  it('offers the solid STEP download when the build is saved', () => {
    render(<BuildReportCard report={report} stepHref="/api/conkay/build/bld_1/step" />);
    const a = screen.getByTestId('build-step');
    expect(a.getAttribute('href')).toBe('/api/conkay/build/bld_1/step');
    expect(a.hasAttribute('download')).toBe(true);
  });
  it('no saved build, no STEP link', () => {
    render(<BuildReportCard report={report} />);
    expect(screen.queryByTestId('build-step')).toBeNull();
  });
});
