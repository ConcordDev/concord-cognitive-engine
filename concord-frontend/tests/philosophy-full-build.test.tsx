// FE pins for the philosophy full build (S1 receipts/panes, S3
// two-step deletes + create refusal surfacing). The server evaluator
// itself is pinned in server/tests/philosophy-full-build.test.js;
// here the macro layer is mocked and the SURFACE contract is pinned:
// receipts claim only what was computed, unparsed arguments get no
// verdict, framework strings render as themselves, and no delete
// rides a native confirm().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { post: vi.fn(async () => ({ data: { ok: true, result: {} } })) },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
}));

import { DilemmaPanel } from '@/components/philosophy/DilemmaPanel';
import { PhilosophyChannels } from '@/components/philosophy/PhilosophyChannels';

const envelope = (result: unknown) => ({ data: { ok: true, result: { ok: true, result } } });

beforeEach(() => {
  lensRunMock.mockReset();
  runDomainMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('DilemmaPanel — S1 surface contract', () => {
  it('an evaluated VALID argument receipts the form verdict, never a soundness stamp', async () => {
    runDomainMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'argumentMap') return envelope({
        premises: [{ number: 1, text: 'All humans are mortal.' }, { number: 2, text: 'Socrates is a human.' }],
        conclusion: 'Socrates is mortal.', premiseCount: 2,
        evaluated: true, validity: 'valid', form: 'syllogism', countermodel: null,
        note: "Validity is a property of form. Whether the premises are actually true — 'soundness' — cannot be checked by a machine.",
      });
      return envelope({});
    });
    render(<DilemmaPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Socrates is a human/), { target: { value: 'All humans are mortal.\nSocrates is a human.' } });
    fireEvent.change(screen.getByPlaceholderText('Socrates is mortal.'), { target: { value: 'Socrates is mortal.' } });
    fireEvent.click(screen.getByRole('button', { name: /Argument map/ }));
    await waitFor(() => expect(screen.getByText(/Valid — the conclusion follows/)).toBeTruthy());
    expect(screen.getByText(/Argument map — valid \(syllogism\)/i)).toBeTruthy();
    expect(screen.queryByText(/valid \/ sound/i)).toBeNull();
  });

  it('an unparseable argument gets structure and NO verdict', async () => {
    runDomainMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'argumentMap') return envelope({
        premises: [{ number: 1, text: 'zzqq blorp.' }, { number: 2, text: 'snizzle wump.' }],
        conclusion: 'fribble snarp.', premiseCount: 2,
        evaluated: false, reason: 'not-in-checkable-form', unparsed: ['P1', 'P2', 'the conclusion'],
        note: 'Structure only — no evaluation.',
      });
      return envelope({});
    });
    render(<DilemmaPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Socrates is a human/), { target: { value: 'zzqq blorp.\nsnizzle wump.' } });
    fireEvent.change(screen.getByPlaceholderText('Socrates is mortal.'), { target: { value: 'fribble snarp.' } });
    fireEvent.click(screen.getByRole('button', { name: /Argument map/ }));
    await waitFor(() => expect(screen.getByText(/Structure mapped — not evaluated/)).toBeTruthy());
    expect(screen.getByText(/structure only \(not evaluated\)/i)).toBeTruthy();
    expect(screen.getByText(/Not parsed: P1, P2, the conclusion/)).toBeTruthy();
    expect(screen.queryByText(/Argument map — valid/i)).toBeNull();
  });

  it('the thought experiment renders its own content — framework strings as prompts, not "undefined:"', async () => {
    runDomainMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'thoughtExperiment') return envelope({
        scenario: 'The trolley diverts.', variables: [], permutations: 1,
        methodNote: 'Consider each permutation — does your intuition change?',
        frameworks: ['Consequentialism: What outcome is best?', 'Deontology: What rule applies?'],
      });
      return envelope({});
    });
    render(<DilemmaPanel />);
    fireEvent.change(screen.getByPlaceholderText(/The trolley diverts/), { target: { value: 'The trolley diverts.' } });
    fireEvent.click(screen.getByRole('button', { name: /Thought exp\./ }));
    await waitFor(() => expect(screen.getByText(/Consequentialism: What outcome is best\?/)).toBeTruthy());
    expect(screen.getByText(/Deontology: What rule applies\?/)).toBeTruthy();
    expect(screen.queryByText(/Frameworks loaded\./)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});

describe('PhilosophyChannels — S3 surface contract', () => {
  const channel = { id: 'ch_1', title: 'Free will', description: '', blockCount: 0, role: 'owner' as const };

  function mockList() {
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'channel-list') return { data: { ok: true, result: { channels: [channel], count: 1 } } };
      if (action === 'channel-delete') return { data: { ok: true, result: { deleted: 'ch_1' } } };
      return { data: { ok: true, result: {} } };
    });
  }

  it('channel delete is a two-step in-page confirm — the verb does not fire on the first click, and no native confirm is used', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    mockList();
    render(<PhilosophyChannels />);
    await waitFor(() => expect(screen.getByText('Free will')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // First click only arms the confirm — channel-delete not yet called.
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'channel-delete')).toBe(false);
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'channel-delete')).toBe(true));
    await waitFor(() => expect(screen.getByText(/Channel "Free will" deleted\./)).toBeTruthy());
    confirmSpy.mockRestore();
  });

  it('a duplicate-title refusal at create is surfaced, not swallowed', async () => {
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'channel-list') return { data: { ok: true, result: { channels: [], count: 0 } } };
      if (action === 'channel-create') return { data: { ok: false, error: 'a channel titled "Free will" already exists' } };
      return { data: { ok: true, result: {} } };
    });
    render(<PhilosophyChannels />);
    await waitFor(() => expect(screen.getByPlaceholderText(/New channel title/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/New channel title/), { target: { value: 'Free will' } });
    fireEvent.click(screen.getByRole('button', { name: /New channel/ }));
    await waitFor(() => expect(screen.getByText(/a channel titled "Free will" already exists/)).toBeTruthy());
  });
});
