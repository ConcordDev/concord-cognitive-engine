/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/ConKayOverlay.test.tsx
//
// Unit A2 — pins the pre-execution confirmation gate on the CLIENT-INITIATED
// macro path (executeMacro, reached here via the explicit "run domain.macro
// {json}" command). Real assertions, no fabricated store state:
//   - a macro `isMutatingMacro` flags as a write renders <ConKayActionConfirm>
//     and does NOT call `lensRun` until the user clicks "Run it";
//   - a read macro calls `lensRun` immediately, with no confirm card ever
//     appearing;
//   - clicking Cancel resolves the gate WITHOUT ever calling `lensRun`.
//
// Heavy runtime deps (WebGL backdrop, Web Speech API, the live socket) are
// mocked to keep this hermetic and fast — none of them are what this unit is
// testing. `isMutatingMacro` itself is exercised directly (not re-derived)
// by tests/lib/conkay/mutating-macros.test.ts; this file proves ConKayOverlay
// actually WIRES that classifier into the confirm/cancel flow around the
// real `lensRun` call.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// jsdom doesn't implement scrollIntoView (ConKayOverlay auto-scrolls the
// transcript on every new message) — stub it, irrelevant to this unit's
// assertions.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/lenses/creatures',
}));

// next/dynamic is used for the WebGL world-tree backdrop + the AR exploded-
// view inspector — neither is under test here, and neither has a WebGL
// context available under jsdom. Stub every dynamic() call to a component
// that renders nothing.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('./useConKayVoice', () => ({
  useConKayVoice: () => ({
    supported: false,
    listening: false,
    speaking: false,
    interim: '',
    usingServerStt: false,
    voiceUnavailable: false,
    ttsAmplitudeRef: { current: 0 },
    speak: vi.fn(),
  }),
}));

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
  onConnectionLost: vi.fn(() => () => {}),
  onReconnected: vi.fn(() => () => {}),
}));

// Loosely-typed result shape so per-test `mockImplementation` overrides (which
// return differently-shaped `result` payloads per domain/macro branch) don't
// fight a return type inferred narrowly from the default implementation.
type LensRunTestResult = { data: { ok: boolean; result: unknown; error: string | null } };
const defaultLensRunImpl = async (
  _domain: string, _macro: string, _input: Record<string, unknown>, _runId?: string,
): Promise<LensRunTestResult> => ({
  data: { ok: true, result: { done: true }, error: null },
});
const lensRunMock = vi.fn(defaultLensRunImpl);
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: Parameters<typeof lensRunMock>) => lensRunMock(...args),
}));

import { ConKayOverlay } from './ConKayOverlay';

async function openConKay() {
  render(<ConKayOverlay />);
  fireEvent.click(screen.getByLabelText('Summon ConKay (⌘/Ctrl+J)'));
  await waitFor(() => expect(screen.getByLabelText('Message ConKay')).toBeInTheDocument());
}

function typeAndSubmit(text: string) {
  const input = screen.getByLabelText('Message ConKay') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send'));
}

/** Calls made to a specific domain.macro pair. The F1 cockpit (mounted around
 *  the transcript, see ConKayCockpit.tsx) resolves its default panel lanes
 *  from the live panel registry, which now includes self-contained panels
 *  like `conkay.connector-status` (ConnectorStatusPanel) that make their OWN
 *  real, legitimate read-only `lensRun` calls the moment they mount — proof
 *  the cockpit is genuinely live, not a static shell. Assertions here must
 *  therefore be scoped to the macro under test rather than "lensRun was
 *  never called at all", or they flake/fail depending on whether that
 *  panel's lazy import has resolved yet. Fixed in place (bidirectional: still
 *  fails if the gated macro itself is ever called early — see the tests
 *  below — just no longer fooled by an unrelated panel's own reads). */
function callsFor(domain: string, macro: string) {
  return lensRunMock.mock.calls.filter((c) => c[0] === domain && c[1] === macro);
}

describe('ConKayOverlay — Unit A2 pre-execution confirm (client-initiated macro path)', () => {
  beforeEach(() => {
    lensRunMock.mockClear();
  });
  afterEach(() => cleanup());

  it('a MUTATING macro renders the confirm card and does NOT call lensRun until confirmed', async () => {
    await openConKay();

    typeAndSubmit('run creatures.create {"name":"fenrir"}');

    // The confirm card appears with the REAL proposed call...
    await waitFor(() => expect(screen.getByTestId('conkay-action-confirm')).toBeInTheDocument());
    const confirmCard = screen.getByTestId('conkay-action-confirm');
    expect(confirmCard).toHaveTextContent('creatures.create');
    expect(confirmCard).toHaveTextContent('fenrir'); // the real proposed input, not a paraphrase
    // ...and the gated call specifically is NOT made while it's up.
    expect(callsFor('creatures', 'create')).toHaveLength(0);

    fireEvent.click(screen.getByLabelText('Confirm and run creatures.create'));

    // Only AFTER confirming does the real call fire, with the exact proposed input.
    await waitFor(() => expect(callsFor('creatures', 'create')).toHaveLength(1));
    expect(lensRunMock).toHaveBeenCalledWith('creatures', 'create', { name: 'fenrir' }, expect.any(String));

    // The confirm card is gone once resolved.
    expect(screen.queryByTestId('conkay-action-confirm')).not.toBeInTheDocument();
  });

  it('a READ macro runs immediately — no confirm card ever appears', async () => {
    await openConKay();

    typeAndSubmit('run creatures.list');

    await waitFor(() => expect(callsFor('creatures', 'list')).toHaveLength(1));
    expect(lensRunMock).toHaveBeenCalledWith('creatures', 'list', {}, expect.any(String));
    expect(screen.queryByTestId('conkay-action-confirm')).not.toBeInTheDocument();
  });

  it('Cancel resolves the gate WITHOUT ever calling lensRun', async () => {
    await openConKay();

    typeAndSubmit('run creatures.create {"name":"fenrir"}');
    await waitFor(() => expect(screen.getByTestId('conkay-action-confirm')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Cancel — do not run this action'));

    await waitFor(() => expect(screen.queryByTestId('conkay-action-confirm')).not.toBeInTheDocument());
    expect(callsFor('creatures', 'create')).toHaveLength(0);
    // The transcript honestly reports the cancellation instead of pretending
    // nothing happened.
    expect(await screen.findByText(/Cancelled — I didn't run creatures\.create/)).toBeInTheDocument();
  });
});

// ── Grounded research mode (V1.1 R3) ────────────────────────────────────────
// A reply's own answer text — not just its citations — now also runs through
// the real `reason.evaluate_answer` macro (verifyMessage in ConKayOverlay.tsx),
// alongside (never replacing) the existing citation-only `reason.verify` call.
// Uses the "math" ConKay skill (a deterministic path that doesn't need the
// chat-agent SSE stream mocked) to reach a reply whose text is proof-amenable,
// which is what triggers verifyMessage in the first place.
//
// Note: `reason.verify`'s verdict ("Grounded" / "Citations resolve") also gets
// mirrored into the ConKayCockpit's lazy-loaded ProvenancePanel (K3), which
// renders the SAME label text as its own headline — a real, pre-existing
// second surface, not a duplicate render bug. Assertions on THOSE two labels
// filter it out so they target the message's own TrustBadge specifically;
// "Proven ✓"/"Unverified" (CapabilityBadge, this unit's new surface) aren't
// mirrored anywhere else, so those stay plain queries.
function messageBadgeMatches(pattern: RegExp) {
  return screen.getAllByText(pattern).filter((el) => !el.closest('[data-testid="ck-provenance-panel"]'));
}

describe('ConKayOverlay — grounded research mode (reason.evaluate_answer)', () => {
  beforeEach(() => {
    lensRunMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    lensRunMock.mockImplementation(defaultLensRunImpl);
  });

  it('a verified reply also calls reason.evaluate_answer with the real answer/question/context, and renders CapabilityBadge from a genuine verdict', async () => {
    lensRunMock.mockImplementation(async (domain: string, macro: string, input: Record<string, unknown>): Promise<LensRunTestResult> => {
      if (domain === 'math' && macro === 'naturalQuery') {
        return { data: { ok: true, result: { kind: 'evaluate', answer: 4 }, error: null } };
      }
      if (domain === 'reason' && macro === 'verify') {
        return { data: { ok: true, result: { verdict: 'grounded', mode: 'deterministic', confidence: null }, error: null } };
      }
      if (domain === 'reason' && macro === 'evaluate_answer') {
        return {
          data: {
            ok: true,
            result: {
              ok: true,
              verdict: 'grounded',
              mode: 'deterministic',
              faithfulness: 0.95,
              citation: null,
              question: input.question,
              answer: input.answer,
            },
            error: null,
          },
        };
      }
      return defaultLensRunImpl(domain, macro, input);
    });

    await openConKay();
    typeAndSubmit('calculate 2+2');

    // The real macro call — the exact answer text and the user's original
    // question, not a paraphrase or a placeholder.
    await waitFor(() => expect(callsFor('reason', 'evaluate_answer')).toHaveLength(1));
    const [, , evalInput] = callsFor('reason', 'evaluate_answer')[0];
    expect(evalInput).toMatchObject({ answer: '2+2 = 4', question: 'calculate 2+2', retrievedDtus: [], citations: [] });

    // Both badges render: the existing TrustBadge (citation-only reason.verify)
    // is untouched, and the new CapabilityBadge appears alongside it, driven
    // by the real evaluate_answer verdict — dual-render, not a swap.
    await waitFor(() => expect(messageBadgeMatches(/Grounded/).length).toBeGreaterThan(0));
    expect(await screen.findByText(/Proven ✓/)).toBeInTheDocument();
  });

  it('a failed/unreachable reason.evaluate_answer renders the honest "Unverified" tier — never a fabricated grounded state', async () => {
    lensRunMock.mockImplementation(async (domain: string, macro: string, input: Record<string, unknown>): Promise<LensRunTestResult> => {
      if (domain === 'math' && macro === 'naturalQuery') {
        return { data: { ok: true, result: { kind: 'evaluate', answer: 4 }, error: null } };
      }
      if (domain === 'reason' && macro === 'verify') {
        return { data: { ok: true, result: { verdict: 'citations_resolve', mode: 'deterministic', confidence: null }, error: null } };
      }
      if (domain === 'reason' && macro === 'evaluate_answer') {
        throw new Error('brains unreachable');
      }
      return defaultLensRunImpl(domain, macro, input);
    });

    await openConKay();
    typeAndSubmit('calculate 2+2');

    await waitFor(() => expect(callsFor('reason', 'evaluate_answer')).toHaveLength(1));

    // The citation-only badge (from reason.verify, which succeeded) still
    // renders normally...
    await waitFor(() => expect(messageBadgeMatches(/Citations resolve/).length).toBeGreaterThan(0));
    // ...while the capability badge honestly reports "Unverified" — the
    // failure never gets silently upgraded into a fabricated "Grounded"/
    // "Proven ✓" state.
    expect(await screen.findByText(/^Unverified$/)).toBeInTheDocument();
    expect(screen.queryByText(/Proven ✓/)).toBeNull();
  });
});
