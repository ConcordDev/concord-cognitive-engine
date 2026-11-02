import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: h }));

import MemoryPanel from '@/components/settings/MemoryPanel';

const fact = (over: Record<string, unknown> = {}) => ({
  id: 'f1', project_id: null, kind: 'preference', subject: 'response_length', value: 'I prefer short answers',
  status: 'active', updated_at: 1_700_000_000_000, use_count: 2, user_edited: 0, ...over,
});

function server({ enabled = true, available = true, facts = [fact()] as ReturnType<typeof fact>[] } = {}) {
  h.get.mockImplementation(async (url: string) => {
    if (url.endsWith('/settings')) return { data: { ok: true, enabled, available } };
    if (url.endsWith('/facts')) return { data: { ok: true, facts } };
    if (url.endsWith('/why')) return { data: { ok: true, why: { said: 'Remember that I prefer short answers', saidAt: 1_700_000_000_000, sessionId: 's9', links: [{ target_kind: 'project', target_id: 'orbit' }], userEdited: false } } };
    if (url.endsWith('/history')) return { data: { ok: true, history: [
      { id: 'f1', value: 'I prefer short answers', status: 'active', valid_from: 2, valid_to: null },
      { id: 'f0', value: 'I prefer long answers', status: 'superseded', valid_from: 1, valid_to: 2 },
    ] } };
    if (url.endsWith('/export')) return { data: { ok: true, memory: { facts } } };
    throw new Error(`unexpected GET ${url}`);
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('MemoryPanel', () => {
  it('lists real facts and shows the opt-in state', async () => {
    server();
    render(<MemoryPanel />);
    expect(await screen.findByText(/I prefer short answers/)).toBeTruthy();
    expect((screen.getByRole('switch', { name: /remember things/i }) as HTMLInputElement).checked).toBe(true);
  });

  it('explains an empty memory instead of showing a blank list', async () => {
    server({ enabled: false, facts: [] });
    render(<MemoryPanel />);
    expect(await screen.findByText(/Turn memory on, then tell it/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /delete all memory/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cannot be enabled while the operator flag is off, and says why', async () => {
    server({ enabled: false, available: false, facts: [] });
    render(<MemoryPanel />);
    expect(await screen.findByText(/not turned on for this server/)).toBeTruthy();
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
  });

  it('toggling sends the new value, and rolls back with a visible error when refused', async () => {
    server({ enabled: false, facts: [] });
    h.put.mockRejectedValueOnce(new Error('409'));
    render(<MemoryPanel />);
    const sw = await screen.findByRole('switch');
    fireEvent.click(sw);
    expect(h.put).toHaveBeenCalledWith('/api/user-memory/settings', { enabled: true });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(false);
  });

  it('forget is optimistic and hard-deletes through the API', async () => {
    server();
    h.delete.mockResolvedValue({ data: { ok: true } });
    render(<MemoryPanel />);
    await screen.findByText(/short answers/);
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(screen.queryByText(/I prefer short answers/)).toBeNull());
    expect(h.delete).toHaveBeenCalledWith('/api/user-memory/facts/f1');
  });

  it('a failed delete puts the memory back and says it is still saved', async () => {
    server();
    h.delete.mockRejectedValue(new Error('500'));
    render(<MemoryPanel />);
    await screen.findByText(/short answers/);
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    expect(await screen.findByText(/still saved/)).toBeTruthy();
    expect(screen.getByText(/I prefer short answers/)).toBeTruthy();
  });

  it('edits through PATCH and surfaces a refusal honestly', async () => {
    server();
    h.patch.mockRejectedValueOnce(new Error('400'));
    render(<MemoryPanel />);
    await screen.findByText(/short answers/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Edit memory'), { target: { value: 'my password is hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/edit was refused/)).toBeTruthy();
    expect(h.patch).toHaveBeenCalledWith('/api/user-memory/facts/f1', { value: 'my password is hunter2' });
  });

  it('"Why?" shows the user\'s own words, where, links and the supersede history', async () => {
    server();
    render(<MemoryPanel />);
    await screen.findByText(/short answers/);
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    expect(await screen.findByText(/You said: .*Remember that I prefer short answers/)).toBeTruthy();
    expect(screen.getByText(/project orbit/)).toBeTruthy();
    expect(screen.getByText(/Before: .*I prefer long answers/)).toBeTruthy();
  });

  it('a pending contradiction waits for the user and can be resolved', async () => {
    server({ facts: [fact({ id: 'p1', status: 'pending', value: 'I prefer detailed answers' })] });
    h.post.mockResolvedValue({ data: { ok: true } });
    render(<MemoryPanel />);
    const box = await screen.findByLabelText('Needs your decision');
    fireEvent.click(within(box).getByRole('button', { name: /use the newer one/i }));
    expect(h.post).toHaveBeenCalledWith('/api/user-memory/facts/p1/resolve', {});
  });

  it('delete-all needs a second, explicit confirmation', async () => {
    server();
    h.delete.mockResolvedValue({ data: { ok: true } });
    render(<MemoryPanel />);
    await screen.findByText(/short answers/);
    fireEvent.click(screen.getByRole('button', { name: /delete all memory/i }));
    expect(h.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    await waitFor(() => expect(h.delete).toHaveBeenCalledWith('/api/user-memory/all'));
    expect(await screen.findByText(/Everything was deleted/)).toBeTruthy();
  });

  it('per-project controls appear when filtering by a project and call the project routes', async () => {
    server({ facts: [fact({ project_id: 'orbit' })] });
    h.delete.mockResolvedValue({ data: { ok: true } });
    h.put.mockResolvedValue({ data: { ok: true } });
    render(<MemoryPanel />);
    await screen.findByText(/short answers/);
    fireEvent.change(screen.getByLabelText('Filter by project'), { target: { value: 'orbit' } });
    fireEvent.click(screen.getByRole('button', { name: /pause for this project/i }));
    expect(h.put).toHaveBeenCalledWith('/api/user-memory/projects/orbit/off', { off: true });
    fireEvent.click(screen.getByRole('button', { name: /forget this project/i }));
    await waitFor(() => expect(h.delete).toHaveBeenCalledWith('/api/user-memory/projects/orbit'));
  });

  it('search filters the list client-side without another request', async () => {
    server({ facts: [fact(), fact({ id: 'f2', value: 'Call me Sam', subject: 'name' })] });
    render(<MemoryPanel />);
    await screen.findByText(/short answers/);
    const calls = h.get.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Search memories'), { target: { value: 'sam' } });
    expect(screen.queryByText(/short answers/)).toBeNull();
    expect(screen.getByText(/Call me Sam/)).toBeTruthy();
    expect(h.get.mock.calls.length).toBe(calls);
  });

  it('a load failure says nothing was changed instead of rendering an empty "no memories" state', async () => {
    h.get.mockRejectedValue(new Error('offline'));
    render(<MemoryPanel />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Nothing was changed/)).toBeTruthy();
  });
});
