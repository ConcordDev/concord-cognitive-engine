/// <reference types="@testing-library/jest-dom/vitest" />
// Pins docs/WAVE4_INVENTORY.md line 188 / healthcare-capability-map.md's
// "vision (photo→LLaVA analysis) has no image-upload UI anywhere" gap-close:
// the new "Photos" tab on PatientChartPanel. Every assertion checks the
// ACTUAL healthcare.photo-notes-add macro call the UI made (patientId +
// a real base64 data: URL read via FileReader, exactly the idiom used by
// TravelDocsPanel.tsx) and that the rendered analysisResult is the REAL
// value the mocked backend returned — never a client-fabricated placeholder.
// A failed/unavailable vision call must surface as an honest error and must
// NOT add a fake "analyzed" entry to the chart.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { PatientChartPanel } from '@/components/healthcare/PatientChartPanel';

const PATIENT = {
  id: 'pat_1', mrn: 'MRN-00001', firstName: 'Grace', lastName: 'Hopper',
  dob: '1906-12-09', sex: 'F', phone: '555-0100', email: 'grace@example.com',
  insurancePlan: 'Concord Health PPO', insuranceMemberId: 'CHP-1', address: '1 Compiler Way',
  emergencyContact: '', preferredPharmacy: '',
};

const EMPTY_CHART = {
  patient: PATIENT, problems: [], allergies: [], vitals: [], labs: [],
  immunizations: [], encounters: [], photoNotes: [] as unknown[],
};

const PHOTO_NOTE = {
  id: 'photo_1', number: 'PH-00001', imageRef: 'data:image/png;base64,xx',
  bodyRegion: 'left forearm', note: 'new rash, 3 days',
  analysisResult: 'The image shows a well-demarcated erythematous patch consistent with contact dermatitis. Not a diagnosis.',
  analysisSource: 'ollama_llava', analysisModel: 'qwen2.5vl:7b', capturedAt: '2026-07-16T10:00:00.000Z',
};

function makeImageFile(name = 'rash.png', type = 'image/png') {
  return new File(['fake-png-bytes'], name, { type });
}

function mockChart(chart: typeof EMPTY_CHART) {
  return { data: { ok: true, result: chart, error: null } };
}

function defaultImpl(chart: typeof EMPTY_CHART) {
  return async (spec: { domain: string; action: string; input?: Record<string, unknown> }) => {
    const { action } = spec;
    if (action === 'patients-detail') return mockChart(chart);
    if (action === 'labs-known-tests') return { data: { ok: true, result: { tests: [] }, error: null } };
    return { data: { ok: true, result: {}, error: null } };
  };
}

describe('PatientChartPanel — Photos tab', () => {
  // NOTE: braces are load-bearing here, not style. `mockReset()` returns the
  // mock instance itself (chainable); an arrow-function implicit return
  // (`() => lensRun.mockReset()`) hands that callable object back to Vitest,
  // which treats a function returned from a `beforeEach` as an implicit
  // per-test cleanup hook and invokes it with ZERO args after the test —
  // which then hits whatever `mockImplementation` the test body set,
  // destructuring a `spec` that's genuinely `undefined`.
  beforeEach(() => { lensRun.mockReset(); });

  it('renders an honest empty state and an upload control', async () => {
    lensRun.mockImplementation(defaultImpl(EMPTY_CHART));
    render(<PatientChartPanel patientId="pat_1" />);
    await screen.findByText('Hopper, Grace');

    fireEvent.click(screen.getByRole('button', { name: /Photos/i }));
    expect(await screen.findByText('No photo notes yet.')).toBeInTheDocument();
    expect(screen.getByText(/Capture \/ upload photo/i)).toBeInTheDocument();
  });

  it('selecting an image reads it as a base64 data: URL and calls healthcare.photo-notes-add; renders the REAL returned analysis, not a placeholder', async () => {
    let detailCalls = 0;
    lensRun.mockImplementation(async (spec: { domain: string; action: string; input?: Record<string, unknown> }) => {
      const { action, input } = spec;
      if (action === 'patients-detail') {
        detailCalls += 1;
        return mockChart(detailCalls === 1 ? EMPTY_CHART : { ...EMPTY_CHART, photoNotes: [PHOTO_NOTE] });
      }
      if (action === 'labs-known-tests') return { data: { ok: true, result: { tests: [] }, error: null } };
      if (action === 'photo-notes-add') {
        expect(input?.patientId).toBe('pat_1');
        expect(input?.bodyRegion).toBe('left forearm');
        expect(String(input?.imageDataUrl)).toMatch(/^data:image\/png;base64,/);
        // Real backend response shape (healthcare.photo-notes-add ok:true → {photoNote}).
        return { data: { ok: true, result: { photoNote: PHOTO_NOTE }, error: null } };
      }
      return { data: { ok: true, result: {}, error: null } };
    });

    const { container } = render(<PatientChartPanel patientId="pat_1" />);
    await screen.findByText('Hopper, Grace');
    fireEvent.click(screen.getByRole('button', { name: /Photos/i }));
    await screen.findByText('No photo notes yet.');

    fireEvent.change(screen.getByPlaceholderText(/Body region/i), { target: { value: 'left forearm' } });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile();
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'healthcare',
          action: 'photo-notes-add',
          input: expect.objectContaining({ patientId: 'pat_1', bodyRegion: 'left forearm' }),
        }),
      ),
    );

    // Renders the REAL analysisResult the mocked macro returned — never a
    // fabricated/hardcoded "analyzed" placeholder.
    expect(await screen.findByText(PHOTO_NOTE.analysisResult)).toBeInTheDocument();
    expect(screen.getByText(/qwen2\.5vl:7b/)).toBeInTheDocument();
  });

  it('an unavailable vision brain surfaces as an honest error — no fabricated success, nothing added to the chart', async () => {
    let detailCalls = 0;
    lensRun.mockImplementation(async (spec: { domain: string; action: string }) => {
      const { action } = spec;
      if (action === 'patients-detail') { detailCalls += 1; return mockChart(EMPTY_CHART); }
      if (action === 'labs-known-tests') return { data: { ok: true, result: { tests: [] }, error: null } };
      if (action === 'photo-notes-add') {
        // Real shape the client's lensRun() helper produces for a handler
        // { ok:false, error } refusal — result collapses to null.
        return { data: { ok: false, result: null, error: 'vision analysis failed' } };
      }
      return { data: { ok: true, result: {}, error: null } };
    });

    const { container } = render(<PatientChartPanel patientId="pat_1" />);
    await screen.findByText('Hopper, Grace');
    fireEvent.click(screen.getByRole('button', { name: /Photos/i }));
    await screen.findByText('No photo notes yet.');
    const callsBeforeUpload = detailCalls;

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [makeImageFile()] });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/vision analysis failed/i)).toBeInTheDocument();
    // Nothing was added: the empty state is unchanged and the chart was not re-fetched
    // as if a real success had landed.
    expect(screen.getByText('No photo notes yet.')).toBeInTheDocument();
    expect(detailCalls).toBe(callsBeforeUpload);
  });

  it('rejects a non-image file client-side without ever calling photo-notes-add', async () => {
    lensRun.mockImplementation(defaultImpl(EMPTY_CHART));
    const { container } = render(<PatientChartPanel patientId="pat_1" />);
    await screen.findByText('Hopper, Grace');
    fireEvent.click(screen.getByRole('button', { name: /Photos/i }));
    await screen.findByText('No photo notes yet.');

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(['not an image'], 'note.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [badFile] });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/Please choose an image file/i)).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'photo-notes-add' }));
  });

  it('deleting a photo note calls healthcare.photo-notes-delete and refreshes', async () => {
    let detailCalls = 0;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    lensRun.mockImplementation(async (spec: { domain: string; action: string; input?: Record<string, unknown> }) => {
      const { action, input } = spec;
      if (action === 'patients-detail') {
        detailCalls += 1;
        return mockChart(detailCalls === 1 ? { ...EMPTY_CHART, photoNotes: [PHOTO_NOTE] } : EMPTY_CHART);
      }
      if (action === 'labs-known-tests') return { data: { ok: true, result: { tests: [] }, error: null } };
      if (action === 'photo-notes-delete') {
        expect(input?.id).toBe('photo_1');
        return { data: { ok: true, result: { deleted: true }, error: null } };
      }
      return { data: { ok: true, result: {}, error: null } };
    });

    render(<PatientChartPanel patientId="pat_1" />);
    await screen.findByText('Hopper, Grace');
    fireEvent.click(screen.getByRole('button', { name: /Photos/i }));
    await screen.findByText(PHOTO_NOTE.analysisResult);

    fireEvent.click(screen.getByLabelText('Delete photo note'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'healthcare', action: 'photo-notes-delete', input: expect.objectContaining({ id: 'photo_1' }) }),
      ),
    );
    expect(await screen.findByText('No photo notes yet.')).toBeInTheDocument();
  });
});
