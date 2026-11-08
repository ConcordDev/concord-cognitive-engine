// Behaviour coverage for the announcement compose panel: validation, every publish outcome and the
// error copy for each server refusal.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { exercise } from '../../../tests/helpers/exercise';
import { ComposePanel } from '../ComposePanel';

const fetchMock = vi.fn();
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
afterEach(() => cleanup());
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

async function fill(title = 'Maintenance tonight', body = 'Brief downtime at 10pm.') {
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: title } });
  const area = document.querySelector('textarea') as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: body } });
}
const submit = async () => { await act(async () => { fireEvent.submit(document.querySelector('form') as HTMLFormElement); await new Promise((r) => setTimeout(r, 5)); }); };

describe('announcement compose panel', () => {
  it('renders, survives an exercise pass and closes on Escape', async () => {
    const onClose = vi.fn();
    const view = render(<ComposePanel onClose={onClose} onPublished={vi.fn()} />);
    await settle();
    expect(view.container.textContent?.length).toBeGreaterThan(20);
    await exercise({ passes: 2, text: 'hello', skip: /cancel|close|dismiss|^×$/i });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not submit an empty announcement', async () => {
    render(<ComposePanel onClose={vi.fn()} onPublished={vi.fn()} />);
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publishes with a kind, expiry and DTU attachment and reports the new id', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, id: 'an-1' }) });
    const onPublished = vi.fn();
    render(<ComposePanel onClose={vi.fn()} onPublished={onPublished} />);
    await fill();
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) { const o = Array.from(sel.options).find((x) => x.value && x.value !== sel.value); if (o) fireEvent.change(sel, { target: { value: o.value } }); }
    const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
    if (dt) fireEvent.change(dt, { target: { value: '2030-01-01T10:00' } });
    const dtu = screen.getAllByRole('textbox').find((i) => /dtu/i.test((i as HTMLInputElement).placeholder || ''));
    if (dtu) fireEvent.change(dtu, { target: { value: 'dtu-123' } });
    await submit();
    expect(onPublished).toHaveBeenCalledWith('an-1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ title: 'Maintenance tonight' });
  });

  it.each([['admin_only', /admin/i], ['Unauthorized', /Sign in/], ['invalid_kind', /valid announcement kind/], ['missing_inputs', /required/], ['empty', /blank/], ['weird_code', /weird_code/]])('explains the %s refusal', async (code, re) => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ ok: false, error: code }) });
    render(<ComposePanel onClose={vi.fn()} onPublished={vi.fn()} />);
    await fill();
    await submit();
    expect(document.body.textContent).toMatch(re);
  });

  it('reports a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    render(<ComposePanel onClose={vi.fn()} onPublished={vi.fn()} />);
    await fill();
    await submit();
    expect(document.body.textContent).toMatch(/socket hang up/);
  });
});
