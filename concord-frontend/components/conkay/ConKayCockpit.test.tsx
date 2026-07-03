/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/ConKayCockpit.test.tsx
//
// F1 — pins the cockpit grid host: the transcript (children) still renders
// unchanged, a registered panel id lazy-mounts and shows REAL store data (no
// mocked/fabricated content — it reads the actual conkayHudStore, same as
// ConKayOverlay's socket lifecycle effect would seed it), an unregistered id
// (standing in for the not-yet-built F4/F5/F7 panels) renders nothing rather
// than crashing, and the panel layer doesn't care which backdrop is mounted
// underneath (3D scene vs the 2D ConKaySurface fallback).

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConKayCockpit } from './ConKayCockpit';
import { ConKaySurface } from './ConKaySurface';
import { useConkayHudStore } from './conkayHudStore';

beforeEach(() => { useConkayHudStore.getState().reset(); });

describe('ConKayCockpit grid host', () => {
  it('renders the grid with the transcript content still present', () => {
    render(
      <ConKayCockpit>
        <div data-testid="transcript-probe">hello from the transcript</div>
      </ConKayCockpit>,
    );
    expect(screen.getByTestId('ck-cockpit-grid')).toBeInTheDocument();
    expect(screen.getByTestId('ck-cockpit-center')).toBeInTheDocument();
    expect(screen.getByTestId('transcript-probe')).toHaveTextContent('hello from the transcript');
  });

  it('lazy-mounts the registered conkay.telemetry panel and shows real store data', async () => {
    // Seed the REAL conkayHudStore the same way the honest event spine does
    // (macroStarted → macroCompleted) — no mocked/fabricated panel content.
    useConkayHudStore.getState().macroStarted({ runId: 'r1', domain: 'math', action: 'naturalQuery' });
    useConkayHudStore.getState().macroCompleted({ runId: 'r1', domain: 'math', action: 'naturalQuery', ok: true, ms: 42 });

    render(
      <ConKayCockpit rightPanelIds={['conkay.telemetry']}>
        <div>transcript</div>
      </ConKayCockpit>,
    );

    await waitFor(() => expect(screen.getByTestId('ck-cockpit-panel-conkay.telemetry')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('math.naturalQuery')).toBeInTheDocument());
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
  });

  it('an unregistered panel id renders nothing, not a crash', () => {
    // The four planned ConKay panels (conkay.telemetry / macro-library /
    // provenance / forward-sim) have all landed (F1/F4/F5/F7) and are real
    // registry entries — use a genuinely-nonexistent id as the unregistered
    // stand-in instead.
    const { container } = render(
      <ConKayCockpit leftPanelIds={['conkay.nonexistent-panel']} rightPanelIds={[]}>
        <div>transcript</div>
      </ConKayCockpit>,
    );
    // No lane, no panel slot — the whole left lane collapses (0 resolvable ids).
    expect(screen.queryByTestId('ck-cockpit-lane-left')).toBeNull();
    expect(container.querySelector('[data-testid^="ck-cockpit-panel-"]')).toBeNull();
  });

  it('renders no lanes at all when given no panel ids (transcript-only, still valid)', () => {
    render(
      <ConKayCockpit leftPanelIds={[]} rightPanelIds={[]}>
        <div data-testid="transcript-probe">solo transcript</div>
      </ConKayCockpit>,
    );
    expect(screen.queryByTestId('ck-cockpit-lane-left')).toBeNull();
    expect(screen.queryByTestId('ck-cockpit-lane-right')).toBeNull();
    expect(screen.getByTestId('transcript-probe')).toBeInTheDocument();
  });

  it('REGRESSION — with NO explicit panelIds (the real ConKayOverlay mount site), every registered conkay.* panel actually renders somewhere', async () => {
    // Bug this pins: F1's original defaults were hardcoded to only
    // ['conkay.telemetry'] because that was the only panel that existed yet.
    // F4/F5/F7 each registered a new panel in panel-registry.ts but nothing
    // ever updated these defaults (or passed explicit ids at the real
    // ConKayOverlay.tsx mount site, which calls <ConKayCockpit> with NO
    // panelIds props at all) — so macro-library/provenance/forward-sim were
    // fully built, tested, and registered, yet never actually reachable in
    // the live cockpit. Every individual unit's own test passed because each
    // one explicitly passed its own id — this test is the one that exercises
    // the REAL, prop-free mount shape and would have caught the gap.
    render(
      <ConKayCockpit>
        <div>transcript</div>
      </ConKayCockpit>,
    );
    for (const id of ['conkay.telemetry', 'conkay.macro-library', 'conkay.provenance', 'conkay.forward-sim']) {
      await waitFor(() => expect(screen.getByTestId(`ck-cockpit-panel-${id}`)).toBeInTheDocument());
    }
  });

  it('panel rendering is backdrop-agnostic — same panel output whether the 2D ConKaySurface fallback is mounted alongside it or not', async () => {
    useConkayHudStore.getState().macroStarted({ runId: 'r2', domain: 'reason', action: 'verify' });
    useConkayHudStore.getState().macroCompleted({ runId: 'r2', domain: 'reason', action: 'verify', ok: true, ms: 7 });

    // Mount the 2D canvas fallback backdrop as a sibling, exactly as
    // ConKayBackdrop does when WebGL/reduced-motion selects ConKaySurface —
    // the cockpit grid is a DOM overlay independent of it.
    render(
      <>
        <ConKaySurface state="idle" />
        <ConKayCockpit rightPanelIds={['conkay.telemetry']}>
          <div>transcript</div>
        </ConKayCockpit>
      </>,
    );

    await waitFor(() => expect(screen.getByText('reason.verify')).toBeInTheDocument());
  });
});
