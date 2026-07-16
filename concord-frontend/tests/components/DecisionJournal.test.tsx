// Behavior test for DecisionJournal — the Wave 4 fix closing
// docs/WAVE4_INVENTORY.md line 248 / metacognition-capability-map.md
// ("biasDetection has no real data source — journal schema lacks per-option
// score/evidence fields"). Pins:
//   - a legacy flat-string-options entry still renders correctly (backward
//     compatibility — no crash, options render as plain names)
//   - a rich entry (per-option score/evidence + chosen + anchor/invested
//     cost) renders the chosen star, score, evidence for/against counts,
//     and the anchor/invested-cost lines
//   - the simple fast-path submit (Advanced section left closed) sends no
//     options/chosen/anchor/investedCost fields at all
//   - the Advanced form round-trips a rich option (name, score, evidence,
//     chosen) plus anchor/invested-cost into journalLog's params
//   - a backend validation rejection surfaces as form text instead of
//     silently clearing the form
//   - the Bias Detection panel calls journalBiasDetection and renders both
//     the "no bias found" honest empty state and a real multi-bias result
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
// DecisionJournal pulls in ChartKit for the reliability diagram + Brier
// history charts, which aren't exercised by this test's scenarios (they
// only render once report.n > 0) and drag in canvas/layout rendering jsdom
// can't provide.
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { DecisionJournal } from '@/components/metacognition/DecisionJournal';

const EMPTY_CALIBRATION = { n: 0, reliability: [], history: [] };

type Override = (input?: Record<string, unknown>) => Promise<{ data: { ok: boolean; result: unknown; error?: string } }>;

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

/**
 * Arms the mocked lensRun. journalList + calibrationReport fire on every
 * mount/reload (the component's `load()` effect), so both get a safe
 * default unless overridden — tests that only care about one action don't
 * have to restate the other.
 */
function mockLensRun(overrides: Record<string, Override> = {}, decisions: unknown[] = []) {
  lensRun.mockImplementation((_domain: string, action: string, input?: Record<string, unknown>) => {
    if (overrides[action]) return overrides[action](input);
    switch (action) {
      case 'journalList': return ok({ decisions, total: decisions.length, open: decisions.length, resolved: 0 });
      case 'calibrationReport': return ok(EMPTY_CALIBRATION);
      default: return ok({});
    }
  });
}

async function renderJournal() {
  render(<DecisionJournal />);
  await waitFor(() => expect(lensRun).toHaveBeenCalledWith('metacognition', 'journalList', { status: 'all' }));
}

describe('DecisionJournal — backward compatibility with legacy flat-string options', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('a legacy string[] options entry expands without crashing and renders plain option names', async () => {
    mockLensRun({}, [
      {
        id: 'dec1', title: 'Pick a vendor', context: '', predictedOutcome: '', confidence: 0.6, domain: 'general',
        options: ['Keep the incumbent', 'Switch vendor'], // pre-migration shape: flat strings, no chosen/anchor/investedCost
        biasChecks: [], status: 'open', actualOutcome: null, correct: null, createdAt: '2026-01-01T00:00:00Z', resolvedAt: null,
      },
    ]);
    await renderJournal();
    expect(await screen.findByText('Pick a vendor')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Expand Pick a vendor'));
    expect(await screen.findByText('Keep the incumbent')).toBeInTheDocument();
    expect(screen.getByText('Switch vendor')).toBeInTheDocument();
    // No score/evidence/chosen markers on a legacy entry — nothing fabricated.
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Initial anchor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Invested cost/i)).not.toBeInTheDocument();
  });

  it('an entry with no options at all still expands cleanly (pre-existing fast path)', async () => {
    mockLensRun({}, [
      {
        id: 'dec2', title: 'Order lunch', context: 'hungry', predictedOutcome: '', confidence: 0.9, domain: 'general',
        options: [], biasChecks: [], status: 'open', actualOutcome: null, correct: null, createdAt: '2026-01-01T00:00:00Z', resolvedAt: null,
      },
    ]);
    await renderJournal();
    fireEvent.click(screen.getByLabelText('Expand Order lunch'));
    expect(await screen.findByText('hungry')).toBeInTheDocument();
    expect(screen.queryByText(/Options considered/i)).not.toBeInTheDocument();
  });
});

describe('DecisionJournal — rich entry rendering', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders score, evidence for/against counts, the chosen star, and anchor/invested-cost', async () => {
    mockLensRun({}, [
      {
        id: 'dec3', title: 'Approve the redesign', context: '', predictedOutcome: '', confidence: 0.5, domain: 'work',
        chosen: 'Redesign', initialAnchor: 7, investedCost: 1200,
        options: [
          { name: 'Redesign', score: 8, evidence: [{ supports: true, strength: 6 }, { supports: false, strength: 2 }] },
          { name: 'Keep current', score: 9, evidence: [] },
        ],
        biasChecks: [], status: 'open', actualOutcome: null, correct: null, createdAt: '2026-01-01T00:00:00Z', resolvedAt: null,
      },
    ]);
    await renderJournal();
    fireEvent.click(screen.getByLabelText('Expand Approve the redesign'));
    expect(await screen.findByText(/Redesign/)).toBeInTheDocument();
    expect(screen.getByText(/\(score 8\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 for \/ 1 against/)).toBeInTheDocument();
    // "Initial anchor:"/"Invested cost:" are their own <span> inside a <p>
    // that also holds the raw number as a sibling text node — assert on the
    // parent paragraph's full text so the value is actually checked.
    expect(screen.getByText(/Initial anchor:/).parentElement).toHaveTextContent('Initial anchor: 7');
    expect(screen.getByText(/Invested cost:/).parentElement).toHaveTextContent('Invested cost: 1200');
  });
});

describe('DecisionJournal — log-decision fast path (Advanced closed)', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('submits without any options/chosen/anchor/investedCost fields when Advanced is never opened', async () => {
    mockLensRun();
    await renderJournal();
    fireEvent.click(screen.getByRole('button', { name: /Log Decision/i }));
    fireEvent.change(screen.getByPlaceholderText(/Decision — e\.g\./i), { target: { value: 'Ship the feature' } });

    mockLensRun({ journalLog: (input) => ok({ decision: { id: 'd1', ...input } }) });
    fireEvent.click(screen.getByRole('button', { name: /Record Decision/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'metacognition', 'journalLog',
      expect.objectContaining({ title: 'Ship the feature' }),
    ));
    const call = lensRun.mock.calls.find((c) => c[1] === 'journalLog');
    const payload = call?.[2] as Record<string, unknown>;
    expect(payload.options).toBeUndefined();
    expect(payload.chosen).toBeUndefined();
    expect(payload.initialAnchor).toBeUndefined();
    expect(payload.investedCost).toBeUndefined();
  });
});

describe('DecisionJournal — Advanced form (bias-detection data entry)', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('round-trips rich options, the chosen option, and anchor/invested-cost into journalLog', async () => {
    mockLensRun();
    await renderJournal();
    fireEvent.click(screen.getByRole('button', { name: /Log Decision/i }));
    fireEvent.change(screen.getByPlaceholderText(/Decision — e\.g\./i), { target: { value: 'Renew the contract' } });

    fireEvent.click(screen.getByRole('button', { name: /Advanced: options, evidence/i }));

    fireEvent.change(screen.getByPlaceholderText('Option 1 name'), { target: { value: 'Switch to new vendor' } });
    fireEvent.change(screen.getAllByPlaceholderText('Score')[0], { target: { value: '9' } });
    fireEvent.change(screen.getByPlaceholderText('Option 2 name'), { target: { value: 'Renew legacy vendor' } });
    fireEvent.change(screen.getAllByPlaceholderText('Score')[1], { target: { value: '3' } });

    // Add evidence to option 2, then mark option 2 chosen.
    const optionCards = screen.getAllByPlaceholderText(/Option \d name/i).map((el) => el.closest('div')?.parentElement as HTMLElement);
    fireEvent.click(within(optionCards[1]).getByText('+ Add evidence'));
    fireEvent.change(screen.getByPlaceholderText('Strength (0-10)'), { target: { value: '9' } });
    fireEvent.click(screen.getByLabelText('Mark option 2 as chosen'));

    fireEvent.change(screen.getByPlaceholderText(/first number you saw/i), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText(/time\/money already spent/i), { target: { value: '500' } });

    mockLensRun({ journalLog: (input) => ok({ decision: { id: 'd2', ...input } }) });
    fireEvent.click(screen.getByRole('button', { name: /Record Decision/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'metacognition', 'journalLog',
      expect.objectContaining({
        title: 'Renew the contract',
        chosen: 'Renew legacy vendor',
        initialAnchor: 3,
        investedCost: 500,
        options: [
          { name: 'Switch to new vendor', score: 9 },
          { name: 'Renew legacy vendor', score: 3, evidence: [{ supports: true, strength: 9 }] },
        ],
      }),
    ));
  });

  it('a backend validation rejection surfaces as form text and the title is preserved', async () => {
    mockLensRun();
    await renderJournal();
    fireEvent.click(screen.getByRole('button', { name: /Log Decision/i }));
    fireEvent.change(screen.getByPlaceholderText(/Decision — e\.g\./i), { target: { value: 'Bad entry' } });
    fireEvent.click(screen.getByRole('button', { name: /Advanced: options, evidence/i }));
    fireEvent.change(screen.getByPlaceholderText('Option 1 name'), { target: { value: 'X' } });
    fireEvent.change(screen.getAllByPlaceholderText('Score')[0], { target: { value: 'not-a-number' } });

    mockLensRun({
      journalLog: () => Promise.resolve({ data: { ok: false, result: null, error: 'invalid options: option "X" score must be a finite number' } }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Record Decision/i }));

    expect(await screen.findByText(/score must be a finite number/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bad entry')).toBeInTheDocument();
  });
});

describe('DecisionJournal — Bias Detection panel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('runs journalBiasDetection and renders the honest "no bias found" state', async () => {
    mockLensRun();
    await renderJournal();
    mockLensRun({ journalBiasDetection: () => ok({ decisionsAnalyzed: 2, biasesDetected: 0, biases: [], biasIndex: 0, riskLevel: 'low', recommendations: [] }) });
    fireEvent.click(screen.getByRole('button', { name: /Run Bias Detection/i }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('metacognition', 'journalBiasDetection', {}));
    expect(await screen.findByText(/No systematic bias patterns detected in 2 analyzed decisions/i)).toBeInTheDocument();
  });

  it('renders real bias findings (type, severity, description) from a non-empty result', async () => {
    mockLensRun();
    await renderJournal();
    mockLensRun({
      journalBiasDetection: () => ok({
        decisionsAnalyzed: 2,
        biasesDetected: 3,
        biases: [
          { type: 'anchoring', description: 'Decisions tend to cluster near the initial anchor value', severity: 'high', anchoringRate: 1 },
          { type: 'confirmation_bias', description: 'Contradicting evidence is ignored or underweighted relative to supporting evidence', severity: 'high', biasRate: 0.75 },
          { type: 'sunk_cost', description: 'Suboptimal options chosen when prior investment is high, suggesting sunk cost influence', severity: 'high', sunkCostRate: 1 },
        ],
        biasIndex: 1,
        riskLevel: 'high',
        recommendations: [
          'Consider generating options independently before reviewing anchor values',
          'Actively seek disconfirming evidence and assign equal weight to contradicting data',
          'Evaluate options based on future expected value, not past investments',
        ],
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Bias Detection/i }));
    expect(await screen.findByText('anchoring')).toBeInTheDocument();
    expect(screen.getByText('confirmation bias')).toBeInTheDocument();
    expect(screen.getByText('sunk cost')).toBeInTheDocument();
    expect(screen.getAllByText('high').length).toBeGreaterThan(0);
    expect(screen.getByText(/high risk/i)).toBeInTheDocument();
    expect(screen.getByText(/Evaluate options based on future expected value/i)).toBeInTheDocument();
  });

  it('a completely empty journal shows the macro\'s own no-data message', async () => {
    mockLensRun();
    await renderJournal();
    mockLensRun({ journalBiasDetection: () => ok({ message: 'No decision data to analyze.' }) });
    fireEvent.click(screen.getByRole('button', { name: /Run Bias Detection/i }));
    expect(await screen.findByText('No decision data to analyze.')).toBeInTheDocument();
  });
});
