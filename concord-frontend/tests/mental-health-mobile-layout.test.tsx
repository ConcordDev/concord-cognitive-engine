/**
 * FIX-mental-health-009 — Mental health at 390px.
 *
 * The floating "Find a coping strategy" CTA covered the lower content
 * (the practice tab's recent sessions). Two changes: the CTA no longer
 * renders on the Analysis view it merely switches to, and the content
 * column carries bottom padding (pb-28) so the last content scrolls
 * fully clear of the floating button — the remedy the ticket names.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/mental-health/CrisisPanel', () => ({ CrisisPanel: () => null }));
vi.mock('@/components/mental-health/MentalHealthSection', () => ({ MentalHealthSection: () => <div>today section</div> }));
vi.mock('@/components/mental-health/MentalHealthActionPanel', () => ({ MentalHealthActionPanel: () => null }));
vi.mock('@/components/health/MedlinePlusPanel', () => ({ MedlinePlusPanel: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ data: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));

import MentalHealthLensPage from '@/app/lenses/mental-health/page';

describe('FIX-mental-health-009 — floating CTA vs lower content', () => {
  it('pads the content column and drops the self-switch CTA on Analysis', () => {
    const { container } = render(<MentalHealthLensPage />);
    const content = container.querySelector('[data-lens-theme="mental-health"].space-y-5');
    expect(content).toBeTruthy();
    expect(content!.className).toContain('pb-28');
    // From Today the CTA is a real action and is present…
    const cta = screen.getByTestId('north-star-cta');
    expect(cta.textContent).toContain('Find a coping strategy');
    // …clicking it lands on Analysis, where the CTA no longer renders.
    fireEvent.click(cta);
    expect(screen.queryByTestId('north-star-cta')).toBeNull();
  });
});
