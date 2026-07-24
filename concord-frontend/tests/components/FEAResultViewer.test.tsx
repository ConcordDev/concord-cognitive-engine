/// <reference types="@testing-library/jest-dom/vitest" />
// FEAResultViewer — the honest OVERALL-result ComputedResultBadge (verified/
// failed/no_data), distinct from the pre-existing per-member UtilizationBadge
// bar in the results table. Rendered with `nodes={[]}` throughout so the
// component takes its "No FEA data to display" placeholder branch and never
// mounts the real @react-three/fiber <Canvas> — jsdom has no WebGL context,
// and the badge itself sits outside the 3-D viewport, so this exercises the
// real component (not a mock) without needing to stub react-three/fiber.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FEAResultViewer } from '@/components/engineering/FEAResultViewer';

describe('FEAResultViewer — honest overall-result badge', () => {
  it('renders "FEA Verified" when a real passing solve result is supplied', () => {
    render(
      <FEAResultViewer
        nodes={[]}
        members={[]}
        result={{ ok: true, summary: { maxUtilization: 0.5, allPass: true, memberCount: 2, nodeCount: 3 } }}
      />
    );
    expect(screen.getByText('FEA Verified')).toBeInTheDocument();
    const badge = document.querySelector('[data-computed-result-state]');
    expect(badge?.getAttribute('data-computed-result-state')).toBe('verified');
  });

  it('renders "FEA Failed" when a real solve completed but did not pass', () => {
    render(
      <FEAResultViewer
        nodes={[]}
        members={[]}
        result={{ ok: true, summary: { maxUtilization: 1.4, allPass: false, memberCount: 2, nodeCount: 3 } }}
      />
    );
    expect(screen.getByText('FEA Failed')).toBeInTheDocument();
    const badge = document.querySelector('[data-computed-result-state]');
    expect(badge?.getAttribute('data-computed-result-state')).toBe('failed');
  });

  it('renders "Not run" (no_data) when `result` is null — never a fabricated verified default', () => {
    render(<FEAResultViewer nodes={[]} members={[]} result={null} />);
    expect(screen.getByText('Not run')).toBeInTheDocument();
    const badge = document.querySelector('[data-computed-result-state]');
    expect(badge?.getAttribute('data-computed-result-state')).toBe('no_data');
  });

  it('renders NO badge at all when `result` is omitted — callers with only node/member geometry (ForwardSimPanel, the fea-frame adapter) are unaffected', () => {
    render(<FEAResultViewer nodes={[]} members={[]} />);
    expect(screen.queryByText('Not run')).toBeNull();
    expect(document.querySelector('[data-computed-result-state]')).toBeNull();
  });
});
