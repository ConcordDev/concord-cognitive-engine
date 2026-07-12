// Behavior test for RfEntryDetailModal — the reflection lens's entry
// detail/edit/AI-reflection surface, wired to 4 previously-unsurfaced
// `reflection` domain macros: entry-detail, entry-update, entry-summarize,
// reflect-deepen. Pins that the component calls the real macros with the
// real payload shapes (`{ id }` for reads, `{ id, title, text, mood, tags }`
// for the update) and renders the real response shape, plus the honest
// encrypted-entry lockout (no plaintext is ever available client-side).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { RfEntryDetailModal } from '@/components/reflection/RfEntryDetailModal';

const baseEntry = {
  id: 'ent_1', journalId: null, text: 'Today was a good day.', title: 'Good day',
  mood: 'good', tags: ['gratitude'], location: null, weather: null,
  photoCount: 0, date: '2026-07-10', at: '2026-07-10T10:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z', wordCount: 5,
};

function mockResult(macro: string, ok: boolean, result: unknown, error: string | null = null) {
  lensRun.mockImplementation((domain: string, name: string) => {
    if (name === macro) return Promise.resolve({ data: { ok, result, error } });
    return Promise.resolve({ data: { ok: true, result: null, error: null } });
  });
}

describe('RfEntryDetailModal', () => {
  beforeEach(() => lensRun.mockReset());

  it('fetches entry-detail with the entry id on open', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { entry: baseEntry }, error: null } });
    render(<RfEntryDetailModal entryId="ent_1" onClose={vi.fn()} onChange={vi.fn()} />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('reflection', 'entry-detail', { id: 'ent_1' }));
    expect(await screen.findByDisplayValue('Good day')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Today was a good day.')).toBeInTheDocument();
  });

  it('shows an honest error when entry-detail fails', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'entry not found' } });
    render(<RfEntryDetailModal entryId="missing" onClose={vi.fn()} onChange={vi.fn()} />);
    expect(await screen.findByText(/entry not found/i)).toBeInTheDocument();
  });

  it('locks encrypted entries — no plaintext, no edit form', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { entry: { ...baseEntry, encrypted: true, text: '[encrypted]', title: '[encrypted]' } }, error: null },
    });
    render(<RfEntryDetailModal entryId="ent_1" onClose={vi.fn()} onChange={vi.fn()} />);
    expect(await screen.findByText(/encrypted at rest/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('[encrypted]')).not.toBeInTheDocument();
  });

  it('saves edits via entry-update with the edited fields', async () => {
    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'entry-detail') return Promise.resolve({ data: { ok: true, result: { entry: baseEntry }, error: null } });
      if (name === 'entry-update') return Promise.resolve({ data: { ok: true, result: { entry: { ...baseEntry, title: 'Great day' } }, error: null } });
      return Promise.resolve({ data: { ok: true, result: null, error: null } });
    });
    const onChange = vi.fn();
    render(<RfEntryDetailModal entryId="ent_1" onClose={vi.fn()} onChange={onChange} />);
    const titleInput = await screen.findByDisplayValue('Good day');
    fireEvent.change(titleInput, { target: { value: 'Great day' } });

    const saveBtn = await screen.findByRole('button', { name: /save changes/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('reflection', 'entry-update', expect.objectContaining({
      id: 'ent_1', title: 'Great day', text: 'Today was a good day.', mood: 'good', tags: ['gratitude'],
    })));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('save button is disabled until the entry is actually edited', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { entry: baseEntry }, error: null } });
    render(<RfEntryDetailModal entryId="ent_1" onClose={vi.fn()} onChange={vi.fn()} />);
    const saveBtn = await screen.findByRole('button', { name: /save changes/i });
    expect(saveBtn).toBeDisabled();
  });

  it('runs entry-summarize and renders the real response shape', async () => {
    mockResult('entry-detail', true, { entry: baseEntry });
    render(<RfEntryDetailModal entryId="ent_1" onClose={vi.fn()} onChange={vi.fn()} />);
    await screen.findByDisplayValue('Good day');

    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'entry-summarize') {
        return Promise.resolve({ data: { ok: true, result: { entryId: 'ent_1', summary: 'A good day overall.', composer: 'deterministic' }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: { entry: baseEntry }, error: null } });
    });
    fireEvent.click(screen.getByRole('button', { name: /summarize entry/i }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('reflection', 'entry-summarize', { id: 'ent_1' }));
    expect(await screen.findByText(/A good day overall\./)).toBeInTheDocument();
    expect(screen.getByText(/deterministic/)).toBeInTheDocument();
  });

  it('runs reflect-deepen and renders the three follow-up questions', async () => {
    mockResult('entry-detail', true, { entry: baseEntry });
    render(<RfEntryDetailModal entryId="ent_1" onClose={vi.fn()} onChange={vi.fn()} />);
    await screen.findByDisplayValue('Good day');

    lensRun.mockImplementation((_domain: string, name: string) => {
      if (name === 'reflect-deepen') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              entryId: 'ent_1',
              questions: ['What made it good?', 'What would make tomorrow better?', 'Who shared it with you?'],
              composer: 'deterministic',
            },
            error: null,
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: { entry: baseEntry }, error: null } });
    });
    fireEvent.click(screen.getByRole('button', { name: /ask follow-ups/i }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('reflection', 'reflect-deepen', { id: 'ent_1' }));
    expect(await screen.findByText(/What made it good\?/)).toBeInTheDocument();
    expect(screen.getByText(/Who shared it with you\?/)).toBeInTheDocument();
  });

  it('closes when the backdrop is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { entry: baseEntry }, error: null } });
    const onClose = vi.fn();
    render(<RfEntryDetailModal entryId="ent_1" onClose={onClose} onChange={vi.fn()} />);
    await screen.findByDisplayValue('Good day');
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });
});
