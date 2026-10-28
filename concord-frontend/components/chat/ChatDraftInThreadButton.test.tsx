import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ChatDraftInThreadButton } from './ChatDraftInThreadButton';

describe('ChatDraftInThreadButton (A8: forge -> Draft in Thread)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('is clickable BEFORE forging and explains itself instead of sitting disabled', async () => {
    render(<ChatDraftInThreadButton dtuId="" title="t" content="some answer worth keeping" />);
    const btn = screen.getByRole('button', { name: 'Draft in Thread' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Forge a DTU first'));
    // and it must not have called Thread with nothing to cite
    expect(lensRunMock).not.toHaveBeenCalled();
  });

  it('drafts in Thread once the forged DTU reads back, and says it is not posted', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'dtu' && action === 'get') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_123' } } } };
      }
      if (domain === 'thread' && action === 'thread-draft') {
        return { data: { ok: true, result: { draft: { id: 'draft_9', citedDtuId: 'dtu_123' } } } };
      }
      throw new Error(`unexpected call ${domain}.${action}`);
    });
    render(<ChatDraftInThreadButton dtuId="dtu_123" title="Kept answer" content="some answer worth keeping" />);
    const btn = screen.getByRole('button', { name: 'Draft in Thread' }) as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Drafted in Thread as draft_9'));
    expect(screen.getByRole('status').textContent).toContain('Not posted');
    expect(btn.disabled).toBe(true); // drafted — no double-draft
  });

  it('refuses to draft when the read-back does not return the DTU', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'dtu' && action === 'get') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_OTHER' } } } };
      }
      throw new Error(`unexpected call ${domain}.${action}`);
    });
    render(<ChatDraftInThreadButton dtuId="dtu_123" title="Kept answer" content="some answer worth keeping" />);
    const btn = screen.getByRole('button', { name: 'Draft in Thread' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('read-back did not return it'));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Forge a DTU first'));
    expect(lensRunMock.mock.calls.some((c) => c[0] === 'thread')).toBe(false);
  });
});
