/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * CalcPanel — a side whose macro returns { ok: false } must show that
 * side's error text. callMacro used to turn the envelope into null, so
 * the result card stayed on its empty prompt and the failure was invisible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
  },
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => null,
}));

import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CalcPanel<{ level?: string }, { sds?: number }>
        title="Seismic hazard"
        domain="geology"
        icon={<span>icon</span>}
        macroBadge="geology.seismicRisk + usgs-seismic-hazard"
        left={{
          macro: 'seismicRisk',
          buildArtifact: () => ({ data: { latitude: 37.77 } }),
          render: <div>left inputs</div>,
        }}
        right={{
          macro: 'usgs-seismic-hazard',
          buildArtifact: () => ({ latitude: 37.77, longitude: -122.42, riskCategory: 2, siteClass: 'D' }),
          render: <div>right inputs</div>,
        }}
        renderResults={(left, right, errors) => (
          <>
            <div>{left ? left.level : errors?.left ? '' : 'Analyze to compute.'}</div>
            <div>{right ? String(right.sds) : errors?.right ? '' : 'Analyze to look up (US locations only).'}</div>
          </>
        )}
        dtu={{
          apiSource: 'test',
          title: () => 't',
          content: () => 'c',
          tags: () => [],
        }}
      />
    </QueryClientProvider>,
  );
}

describe('CalcPanel ok:false', () => {
  beforeEach(() => {
    runDomain.mockReset();
  });

  it('renders the macro error text when one side returns ok:false', async () => {
    runDomain.mockImplementation((_domain: string, action: string) => {
      if (action === 'usgs-seismic-hazard') {
        return Promise.resolve({
          data: { ok: false, error: 'latitude + longitude required' },
        });
      }
      return Promise.resolve({
        data: { ok: true, result: { level: 'high' } },
      });
    });
    renderPanel();
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('latitude + longitude required'));
    expect(screen.getByText('high')).toBeInTheDocument();
    // The failed side must not keep the idle prompt as if Analyze never ran.
    expect(screen.queryByText('Analyze to look up (US locations only).')).not.toBeInTheDocument();
    expect(screen.queryByText('Analyze to compute.')).not.toBeInTheDocument();
  });
});
