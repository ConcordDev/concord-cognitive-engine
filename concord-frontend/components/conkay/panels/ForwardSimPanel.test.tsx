/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/panels/ForwardSimPanel.test.tsx
//
// F7 — pins the K3 Forward-Sim panel's two honest guarantees:
//   (a) an honest idle/empty state (no inFlight, no stage) — NOT a fake
//       progress bar;
//   (b) progress is a DIRECT render of the real `stage` string — the panel
//       shows the exact reached stage, and changing `stage` changes the output
//       (proving it's a read, not a fabricated animation);
//   (c) a belt-and-suspenders source scan: the component contains no
//       setInterval/setTimeout — progress can ONLY be the real store `stage`;
//   (d) when a real FEA result is present, FEAResultViewer receives it.
// Plus a unit check of `feaResultFromRun` (the pure producer transform that
// ConKayOverlay#executeMacro uses to mirror a real solve into the store).
//
// Seeds the REAL conkayHudStore (same approach as ProvenancePanel.test.tsx)
// rather than mocking zustand — macroStarted/macroStage and setLastFea are the
// real single-writer actions, so seeding through them exercises the actual
// contract. FEAResultViewer is mocked to a marker (its @react-three/fiber
// Canvas would fight jsdom's absent WebGL) — the panel-side wiring is what this
// unit owns; FEAResultViewer has its own coverage.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ForwardSimPanel } from './ForwardSimPanel';
import { useConkayHudStore, feaResultFromRun } from '../conkayHudStore';

vi.mock('@/components/engineering/FEAResultViewer', () => ({
  FEAResultViewer: (props: {
    nodes?: unknown[];
    members?: unknown[];
    displacements?: unknown[];
  }) => (
    <div
      data-testid="mock-fea-viewer"
      data-nodes={props.nodes?.length ?? 0}
      data-members={props.members?.length ?? 0}
      data-displacements={props.displacements?.length ?? 0}
    />
  ),
}));

beforeEach(() => {
  useConkayHudStore.getState().reset();
});

describe('ForwardSimPanel', () => {
  it('(a) renders an honest idle/empty state — not a fake progress bar — when nothing is running', () => {
    render(<ForwardSimPanel />);

    // Honest idle + no-result messaging, both present.
    expect(screen.getByTestId('fs-idle')).toBeInTheDocument();
    expect(screen.getByTestId('fs-no-result')).toBeInTheDocument();

    // Crucially: NO stage tracker / current-stage indicator when idle — the
    // panel never shows progress for work that isn't running.
    expect(screen.queryByTestId('fs-stage-tracker')).toBeNull();
    expect(screen.queryByTestId('fs-current-stage')).toBeNull();
    expect(screen.queryByTestId('mock-fea-viewer')).toBeNull();
  });

  it('(b) renders the exact real `stage` string, and changing it changes the output (direct read, not animation)', () => {
    // A real engineering.runFEA run in flight (macroStarted → activeLabel), then
    // a real macro:stage sub-step arriving.
    act(() => {
      useConkayHudStore.getState().macroStarted({ runId: 'r1', domain: 'engineering', action: 'runFEA' });
      useConkayHudStore.getState().macroStage({ runId: 'r1', stage: 'solving' });
    });

    render(<ForwardSimPanel />);

    // The FEA 3-step tracker is present and the verbatim stage is shown.
    expect(screen.getByTestId('fs-stage-tracker')).toBeInTheDocument();
    expect(screen.getByTestId('fs-current-stage')).toHaveTextContent('solving');
    // The "solving" step is the active one; "assembling" is done; "postprocess" pending.
    expect(screen.getByTestId('fs-stage-solving').getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId('fs-stage-assembling').getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('fs-stage-postprocess').getAttribute('data-state')).toBe('pending');

    // Advance the REAL stage — the rendered output must follow it.
    act(() => {
      useConkayHudStore.getState().macroStage({ runId: 'r1', stage: 'postprocess' });
    });

    expect(screen.getByTestId('fs-current-stage')).toHaveTextContent('postprocess');
    expect(screen.getByTestId('fs-current-stage')).not.toHaveTextContent('solving');
    expect(screen.getByTestId('fs-stage-postprocess').getAttribute('data-state')).toBe('active');
    expect(screen.getByTestId('fs-stage-solving').getAttribute('data-state')).toBe('done');
  });

  it('(b2) a run in flight with no sub-step yet shows an honest "awaiting" state, not a fabricated percentage', () => {
    act(() => {
      useConkayHudStore.getState().macroStarted({ runId: 'r1', domain: 'engineering', action: 'runFEA' });
    });
    render(<ForwardSimPanel />);

    // Tracker present, but nothing highlighted (no real sub-step reached yet).
    expect(screen.getByTestId('fs-stage-tracker')).toBeInTheDocument();
    expect(screen.getByTestId('fs-stage-assembling').getAttribute('data-state')).toBe('pending');
    expect(screen.getByTestId('fs-current-stage')).toHaveTextContent(/awaiting first sub-step/i);
  });

  it('(c) contains NO setInterval / setTimeout — progress can only be the real store `stage`', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'ForwardSimPanel.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/setTimeout/);
  });

  it('(d) embeds FEAResultViewer with the real solve data when a completed FEA result is present', () => {
    useConkayHudStore.getState().setLastFea({
      nodes: [
        { id: 'n1', x: 0, y: 0, z: 0 },
        { id: 'n2', x: 1, y: 0, z: 0 },
      ],
      members: [{ id: 'm1', nodeI: 'n1', nodeJ: 'n2', utilization: 0.5, stress: 100 }],
      displacements: [
        { nodeId: 'n1', dx: 0, dy: 0, dz: 0 },
        { nodeId: 'n2', dx: 0.01, dy: -0.02, dz: 0 },
      ],
      summary: { maxUtilization: 0.5, allPass: true },
    });

    render(<ForwardSimPanel />);

    const viewer = screen.getByTestId('mock-fea-viewer');
    expect(viewer).toBeInTheDocument();
    expect(viewer.getAttribute('data-nodes')).toBe('2');
    expect(viewer.getAttribute('data-members')).toBe('1');
    expect(viewer.getAttribute('data-displacements')).toBe('2');
    // Honest caveat about the nature of the numbers is shown; no result-empty state.
    expect(screen.getByTestId('fs-model-caveat')).toBeInTheDocument();
    expect(screen.queryByTestId('fs-no-result')).toBeNull();
  });

  it('feaResultFromRun maps a real runFEA input model + solver return into FEAResultViewer shape (and is defensive)', () => {
    const input = {
      model: {
        nodes: [
          { id: 'n1', x: 0, y: 0, z: 0 },
          { id: 'n2', x: 3, y: 0, z: 0 },
        ],
        members: [{ id: 'm1', nodeI: 'n1', nodeJ: 'n2', area: 10 }],
      },
    };
    const result = {
      displacements: [
        { nodeId: 'n1', dx: 0, dy: 0, dz: 0 },
        { nodeId: 'n2', dx: 0.5, dy: -0.25, dz: 0 },
      ],
      utilization: [{ id: 'm1', utilization: 0.73, pass: true }],
      stresses: [{ id: 'm1', combinedStress: 15800 }],
      summary: { maxUtilization: 0.73, allPass: true },
    };

    const fea = feaResultFromRun(input, result);
    expect(fea).not.toBeNull();
    expect(fea!.nodes).toHaveLength(2);
    expect(fea!.displacements).toHaveLength(2);
    // Member connectivity from the input, utilization + stress joined from the
    // solver return by member id.
    expect(fea!.members[0]).toMatchObject({ id: 'm1', nodeI: 'n1', nodeJ: 'n2', utilization: 0.73, stress: 15800 });

    // Defensive: no geometry / no solver arrays → null (never a half-real preview).
    expect(feaResultFromRun({}, result)).toBeNull();
    expect(feaResultFromRun(input, {})).toBeNull();
    expect(feaResultFromRun(null, null)).toBeNull();
  });
});
