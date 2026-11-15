/**
 * FIX-philosophy-005 — the Curation Studio (Idea Channels) block 'Add'
 * button appeared to do nothing: addBlock never read the lensRun
 * result, so a refused add cleared the draft and reloaded exactly like
 * a success. A refusal now speaks through the panel's notice line and
 * the draft stays put; a success says so and clears.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const H = vi.hoisted(() => ({ blockAddOk: false }));
const lensRunMock = vi.hoisted(() => vi.fn(async (_domain: string, action: string) => {
  switch (action) {
    case 'channel-list':
      return { data: { ok: true, result: { channels: [{ id: 'ch1', title: 'Stoics', description: '', blockCount: 0 }] } } };
    case 'channel-detail':
      return { data: { ok: true, result: { channel: { id: 'ch1', title: 'Stoics', description: '' }, blocks: [] } } };
    case 'block-add':
      return H.blockAddOk
        ? { data: { ok: true, result: {} } }
        : { data: { ok: false, error: 'link blocks need an http(s) URL' } };
    default:
      return { data: { ok: true, result: {} } };
  }
}));
vi.mock('@/lib/api/client', () => ({ lensRun: lensRunMock }));

import { PhilosophyChannels } from '@/components/philosophy/PhilosophyChannels';

describe('FIX-philosophy-005 — block add speaks', () => {
  beforeEach(() => { vi.clearAllMocks(); H.blockAddOk = false; });

  it('a refused add keeps the draft and names the refusal; a good add clears with a notice', async () => {
    render(<PhilosophyChannels />);
    fireEvent.click(await screen.findByText('Stoics'));
    const content = await screen.findByPlaceholderText('Block content…');
    fireEvent.change(content, { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('link blocks need an http(s) URL');
    expect((content as HTMLInputElement).value).toBe('not a url');
    H.blockAddOk = true;
    fireEvent.click(screen.getByRole('button', { name: /Add/ }));
    await waitFor(() => expect((content as HTMLInputElement).value).toBe(''));
    expect(screen.getByRole('status')).toHaveTextContent('Block added.');
  });
});
