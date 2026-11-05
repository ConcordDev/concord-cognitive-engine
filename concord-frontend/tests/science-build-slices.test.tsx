// Science full build (GB-1021) — S3 shipped values + verdict receipt +
// custody count, S5 draft persistence, S4 stats labelling, S6 arXiv
// categories. The API client is mocked; the lens-state store is real, so
// the remount legs exercise the actual draft path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { runDomain, lensRunMock } = vi.hoisted(() => ({
  runDomain: vi.fn(),
  lensRunMock: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: { lens: { runDomain } },
  lensRun: lensRunMock,
}));

vi.mock('@/hooks/useArxivFeed', () => ({
  useArxivFeed: () => ({ data: [], isPending: false, isError: false }),
}));

import { ExperimentActionPanel } from '@/components/science/ExperimentActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ScienceFieldLog } from '@/components/science/ScienceFieldLog';
import { ScienceStats } from '@/components/science/ScienceStats';
import { ScienceArxiv } from '@/components/science/ScienceArxiv';
import { useLensStateStore } from '@/store/lens-state';

function renderBench() {
  return render(
    <PipingProvider>
      <ExperimentActionPanel />
    </PipingProvider>,
  );
}

function textareas(container: HTMLElement) {
  return [...container.querySelectorAll('textarea')] as HTMLTextAreaElement[];
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLensStateStore.setState({ lensStates: {} });
});

describe('S3 — the bench sees its own shipped content', () => {
  it('the shipped protocol/samples/instruments stand as VALUES and Validate is enabled on first load', () => {
    const { container } = renderBench();
    const areas = textareas(container);
    const protocol = areas.find((t) => t.value.includes('inoculate'));
    expect(protocol, 'protocol textarea carries the shipped protocol as its value').toBeTruthy();
    expect(protocol!.value).toContain('4. Cleanup: autoclave waste');
    expect(areas.some((t) => t.value === 'S-001\nS-002')).toBe(true);
    expect(areas.some((t) => t.value === 'NanoDrop spectrophotometer')).toBe(true);
    const validate = screen.getByRole('button', { name: /Validate/ });
    expect((validate as HTMLButtonElement).disabled).toBe(false);
  });

  it('the validate receipt echoes the verdict — needs_revision is not trailed by "Protocol validated."', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          status: 'needs_revision', totalSteps: 4,
          safetyChecksVerified: 0, safetyChecksTotal: 0, equipmentCount: 0,
          issues: [{ type: 'safety', detail: 'No safety checks defined' }],
        },
      },
    });
    renderBench();
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }));
    await waitFor(() => expect(screen.getByText(/needs revision \(see the issues below\)/)).toBeTruthy());
    expect(screen.queryByText('Protocol validated.')).toBeNull();
  });

  it('an approved verdict receipts as validated', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          status: 'approved', totalSteps: 4,
          safetyChecksVerified: 1, safetyChecksTotal: 1, equipmentCount: 0, issues: [],
        },
      },
    });
    renderBench();
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }));
    await waitFor(() => expect(screen.getByText('Protocol validated.')).toBeTruthy());
  });

  it('the custody count matches the rendered rows — a one-sided row still counts', async () => {
    runDomain.mockImplementation(async (_d: string, action: string, payload: { input?: { chainOfCustody?: unknown[] } }) => {
      if (action === 'chainOfCustody') {
        const rows = payload.input?.chainOfCustody ?? [];
        return { data: { ok: true, result: { intact: true, transfers: rows.length, gaps: [] } } };
      }
      return { data: { ok: false, error: 'unused' } };
    });
    const { container } = renderBench();
    const toInputs = screen.getAllByPlaceholderText('Transferred to');
    const byInputs = screen.getAllByPlaceholderText('Received by (next row)');
    fireEvent.change(toInputs[0], { target: { value: 'Tech A' } });
    // second row: click the custody section's add button, then fill both sides
    const addButtons = [...container.querySelectorAll('button')].filter((b) => /Add transfer/.test(b.textContent || ''));
    fireEvent.click(addButtons[0]);
    const to2 = screen.getAllByPlaceholderText('Transferred to');
    const by2 = screen.getAllByPlaceholderText('Received by (next row)');
    fireEvent.change(to2[1], { target: { value: 'Tech B' } });
    fireEvent.change(by2[1], { target: { value: 'Tech A' } });
    expect(byInputs.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Chain custody/ }));
    await waitFor(() => expect(screen.getByText(/2 transfer\(s\)/)).toBeTruthy());
    const call = runDomain.mock.calls.find((c) => c[1] === 'chainOfCustody');
    expect((call?.[2] as { input: { chainOfCustody: unknown[] } }).input.chainOfCustody).toHaveLength(2);
  });
});

describe('S5 — state lifetimes', () => {
  it('bench edits survive a remount through the lens-state draft', () => {
    const first = renderBench();
    const protocol = textareas(first.container).find((t) => t.value.includes('inoculate'))!;
    fireEvent.change(protocol, { target: { value: 'CUSTOM PROTOCOL LINE' } });
    first.unmount();
    const second = renderBench();
    const restored = textareas(second.container).find((t) => t.value === 'CUSTOM PROTOCOL LINE');
    expect(restored, 'the edited protocol is restored on remount').toBeTruthy();
  });

  it('field-log rows survive a remount through the lens-state draft', () => {
    const first = render(<ScienceFieldLog />);
    fireEvent.change(screen.getByPlaceholderText('Notes'), { target: { value: 'PR2SCI field row' } });
    first.unmount();
    render(<ScienceFieldLog />);
    expect((screen.getByPlaceholderText('Notes') as HTMLInputElement).value).toBe('PR2SCI field row');
  });
});

describe('S4 — statistics labelling', () => {
  it('the descriptive result labels the sample SD and renders the mode', async () => {
    lensRunMock.mockResolvedValue({
      data: {
        ok: true,
        result: { n: 8, mean: 5, median: 4.5, mode: 4, sd: 2.1381, variance: 4.5714, min: 2, max: 9, sum: 40 },
      },
    });
    const { container } = render(<ScienceStats />);
    const dataBox = container.querySelector('textarea')!;
    fireEvent.change(dataBox, { target: { value: '2,4,4,4,5,5,7,9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(screen.getByText('SD (sample)')).toBeTruthy());
    expect(screen.getByText('mode')).toBeTruthy();
  });
});

describe('S6 — arXiv categories resolve at the source', () => {
  it('every option is a real arXiv subcategory; the default is physics.gen-ph', () => {
    const { container } = render(<ScienceArxiv />);
    const select = container.querySelector('select') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toEqual(['physics.gen-ph', 'q-bio', 'q-fin.GN', 'stat.AP', 'math-ph']);
    expect(select.value).toBe('physics.gen-ph');
  });
});
