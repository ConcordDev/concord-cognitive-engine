/**
 * chem-bench.test.tsx — the Lab Bench identity + lockout fixes (Chem S4/F8/F10).
 *
 * The mint receipt truncated the DTU id it had in full in state
 * ("Lab DTU dtu_8349…"), so no surface rendered a complete id. And the
 * bench's single busy flag disabled all eight actions behind any one run —
 * the Brief Agent's minute-long wait locked the calculators (F10's lockout
 * shape). These tests pin: the full id on the mint receipt, and the bench
 * staying usable while the agent thinks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiPost = vi.hoisted(() => vi.fn());
const runDomain = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  api: { post: apiPost, get: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain } },
  lensRun: vi.fn(),
}));

vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
  PipingProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: Record<string, unknown>) => input,
}));

import { ChemActionPanel } from '@/components/chem/ChemActionPanel';

const FULL_ID = 'dtu_chem1234567890abcdef_full_id';

beforeEach(() => {
  vi.clearAllMocks();
  runDomain.mockImplementation(async () => ({ data: { ok: true, result: { ok: true } } }));
  apiPost.mockImplementation(async (url: string, body: { domain?: string; name?: string }) => {
    if (url === '/api/lens/run' && body?.domain === 'dtu' && body?.name === 'create') {
      return { data: { result: { dtu: { id: FULL_ID } } } };
    }
    return { data: { ok: true } };
  });
});

describe('Lab bench (S4)', () => {
  it('the mint receipt renders the FULL DTU id', async () => {
    render(<ChemActionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Private lab DTU/ }));
    // The full id renders on the receipt AND in the mint button's own
    // description ("Minted: <id>") — findByText would fail on the multiple
    // match, so collect all of them.
    const hits = await screen.findAllByText(new RegExp(FULL_ID));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/dtu_chem12…/)).toBeNull();
  });

  it('the Brief Agent thinking no longer locks the calculators', async () => {
    apiPost.mockImplementation(async (url: string, body: { domain?: string }) => {
      if (url === '/api/lens/run' && body?.domain === 'chat_agent') {
        return new Promise(() => { /* the agent is still thinking */ });
      }
      return { data: { ok: true } };
    });
    render(<ChemActionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Agent: use \+ safety/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const mwButton = screen.getByRole('button', { name: /molecular-weight/ });
    expect(mwButton).not.toBeDisabled();
  });

  it('the DM section carries a message field', () => {
    render(<ChemActionPanel />);
    expect(screen.getByLabelText('DM message')).toBeTruthy();
  });
});
