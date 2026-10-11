import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ChatDraftInThreadButton } from '@/components/chat/ChatDraftInThreadButton';

const readBack = (id: string) => ({
  data: { ok: true, result: { dtu: { id } } },
});

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('ChatDraftInThreadButton', () => {
  it('stays disabled until a DTU id reads back', () => {
    render(<ChatDraftInThreadButton dtuId="" title="Note" content="hello there" />);
    expect(screen.getByRole('button', { name: 'Draft in Thread' })).toBeDisabled();
    expect(lensRunMock).not.toHaveBeenCalled();
  });

  it('cites the forged DTU once the read-back matches', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string, input: { id?: string; citedDtuId?: string }) => {
      if (domain === 'dtu' && action === 'get') return readBack(String(input.id));
      return {
        data: {
          ok: true,
          result: { draft: { id: 'th_1', status: 'draft', citedDtuId: input.citedDtuId } },
        },
      };
    });
    render(<ChatDraftInThreadButton dtuId="dtu_abc" title="Note" content="hello there" />);
    const button = screen.getByRole('button', { name: 'Draft in Thread' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Drafted in Thread as th_1/));
    const draftCall = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect(draftCall?.[2]).toMatchObject({ citedDtuId: 'dtu_abc', content: 'hello there' });
    expect(screen.getByRole('status').textContent).toMatch(/Not posted/);
  });

  it('does not say Drafted when Thread refuses', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string, input: { id?: string }) => {
      if (domain === 'dtu' && action === 'get') return readBack(String(input.id));
      return { data: { ok: false, result: null, error: 'cited DTU not found: dtu_abc' } };
    });
    render(<ChatDraftInThreadButton dtuId="dtu_abc" title="Note" content="hello there" />);
    const button = screen.getByRole('button', { name: 'Draft in Thread' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByText(/Not drafted/)).toBeInTheDocument();
    expect(screen.queryByText(/^Drafted/)).not.toBeInTheDocument();
  });
});
