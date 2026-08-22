/**
 * GardenStudio — Identify Plant tab (feature-build follow-up pass, #12 of 25
 * per docs/FEATURE_BUILD_WALK_STATUS.md).
 *
 * The "Identify Plant" sub-tab already called a real vision-brain macro
 * (landscaping.identify-plant) and rendered a photo preview, but the result
 * was a raw whitespace-pre-wrap text dump of the LLM's free-form reply — a
 * generic, undesigned presentation the doc's T1 note flagged as the
 * remaining visual gap. The backend macro was changed in the same pass to
 * request strict JSON (commonName/scientificName/plantType/healthStatus/
 * healthNotes) and always still return the raw text as a fallback; this
 * file pins the frontend's designed card (species name, scientific name,
 * plant-type badge, health-status badge) rendering from that real
 * structured payload, AND the honest raw-text fallback when the backend
 * reports `structured: null` (model didn't comply with the JSON shape).
 *
 * Hermetic: lensRun + next/image are mocked, same pattern as the sibling
 * GardenStudio test files. No network, no server boot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
  ChartKit: () => null,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

import { GardenStudio } from '@/components/landscaping/GardenStudio';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, error, result: null } });
}

// GardenStudio fires several macro calls on mount (job list, bed list, etc.
// from OTHER tabs' initial loads) before the user ever opens Identify Plant
// — a plain FIFO mockResolvedValueOnce queue would hand an unrelated call
// the response meant for identify-plant. Route by action name instead,
// same pattern as the sibling GardenStudioInspectionsCerts.test.tsx.
function mockIdentifyPlant(behavior: () => Promise<unknown>) {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'identify-plant') return behavior();
    return ok({});
  });
}

// FileReader isn't implemented in jsdom by default for readAsDataURL —
// stub it so the component's upload handler can run synchronously enough
// for the test to drive it.
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  readAsDataURL() {
    this.result = 'data:image/png;base64,ZmFrZQ==';
    this.onload?.();
  }
}

async function openIdentifyTabAndUpload() {
  render(<GardenStudio />);
  fireEvent.click(screen.getByRole('button', { name: /Identify Plant/i }));
  const file = new File(['fake'], 'plant.png', { type: 'image/png' });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('GardenStudio — Identify Plant (structured result card)', () => {
  const originalFileReader = globalThis.FileReader;

  beforeEach(() => {
    lensRun.mockReset();
    // @ts-expect-error — test stub, not the real browser FileReader
    globalThis.FileReader = FakeFileReader;
  });

  afterEach(() => {
    globalThis.FileReader = originalFileReader;
  });

  it('renders a real designed card (name, scientific name, type badge, health badge) from a structured backend response', async () => {
    mockIdentifyPlant(() =>
      ok({
        identification: '{"commonName":"Lavender","scientificName":"Lavandula angustifolia","plantType":"perennial","healthStatus":"healthy","healthNotes":""}',
        structured: {
          commonName: 'Lavender',
          scientificName: 'Lavandula angustifolia',
          plantType: 'perennial',
          healthStatus: 'healthy',
          healthNotes: null,
        },
      }),
    );

    await openIdentifyTabAndUpload();

    await waitFor(() => expect(screen.getByText('Lavender')).toBeInTheDocument());
    expect(screen.getByText('Lavandula angustifolia')).toBeInTheDocument();
    expect(screen.getByText('Perennial')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    // The raw-text fallback card must NOT also render alongside a real structured result.
    expect(screen.queryByText(/wasn't structured/i)).not.toBeInTheDocument();
  });

  it('surfaces real health notes on a diseased plant with the disease badge, not the healthy one', async () => {
    mockIdentifyPlant(() =>
      ok({
        identification: 'raw text',
        structured: {
          commonName: 'Rose',
          scientificName: 'Rosa',
          plantType: 'shrub',
          healthStatus: 'disease',
          healthNotes: 'Black spot visible on lower leaves.',
        },
      }),
    );

    await openIdentifyTabAndUpload();

    await waitFor(() => expect(screen.getByText('Rose')).toBeInTheDocument());
    expect(screen.getByText('Disease')).toBeInTheDocument();
    expect(screen.getByText('Black spot visible on lower leaves.')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).not.toBeInTheDocument();
  });

  it('falls back to the honest raw-text card when the backend could not parse structured JSON — never fabricates fields', async () => {
    mockIdentifyPlant(() =>
      ok({
        identification: 'This looks like some kind of fern, hard to tell exactly which one.',
        structured: null,
      }),
    );

    await openIdentifyTabAndUpload();

    await waitFor(() =>
      expect(screen.getByText(/This looks like some kind of fern/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/wasn't structured/i)).toBeInTheDocument();
  });

  it('shows an honest error state on a failed vision call — no card, no fabricated identification', async () => {
    mockIdentifyPlant(() => fail('vision unavailable'));

    await openIdentifyTabAndUpload();

    await waitFor(() => expect(screen.getByText('vision unavailable')).toBeInTheDocument());
    expect(screen.queryByText(/wasn't structured/i)).not.toBeInTheDocument();
  });
});
