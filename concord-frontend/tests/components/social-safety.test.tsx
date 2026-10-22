import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const calls: Array<{ method: string; url: string; body?: unknown }> = [];

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (lens: string, action: string) => {
    calls.push({ method: 'LENS', url: `${lens}.${action}` });
    if (action === 'registerMedia') {
      return { data: { ok: true, result: { attachment: { kind: 'image', url: '/api/artifact/d1/stream', alt: '' } } } };
    }
    return { data: { ok: true, result: { post: { id: 'p1' } } } };
  }),
  api: {
    get: vi.fn(async (url: string) => {
      calls.push({ method: 'GET', url });
      if (String(url).includes('/api/moderation/queue')) {
        return { status: 403, data: { ok: false, error: 'forbidden' } };
      }
      return { data: { ok: true, groups: [] } };
    }),
    post: vi.fn(async (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      if (String(url).includes('/api/economy/transfer')) {
        return { data: { ok: false, error: 'amount must be a positive finite number' } };
      }
      if (String(url).includes('/api/social/listings/')) {
        return {
          data: {
            ok: true,
            listing: { id: 'list-1', price: 12, currency: 'USD', transferRate: 0.0146, marketplaceRate: 0.04 },
            post: { id: 'p1', content: 'Tape' },
          },
        };
      }
      return { data: { ok: true } };
    }),
  },
}));

import { FeedComposer } from '@/components/social/feed/FeedComposer';
import { TipForm } from '@/components/social/TipForm';
import { AdminModerationQueue } from '@/components/social/AdminModerationQueue';
import { ShareToSocial } from '@/components/social/ShareToSocial';

describe('social safety ui', () => {
  beforeEach(() => { calls.length = 0; });

  it('blocks an image post until alt text is acknowledged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, dtuId: 'd1' }) })));
    render(<FeedComposer username="ana" onPosted={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByLabelText('Alt text');
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText(/Add alt text on images/)).toBeTruthy();
    expect(calls.some((call) => call.url === 'social.createPost')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /Publish without alt text/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(calls.some((call) => call.url === 'social.createPost')).toBe(true));
  });

  it('shows the transfer error and a listing rate returned by the server', async () => {
    render(<TipForm />);
    fireEvent.change(screen.getByLabelText('Tip recipient'), { target: { value: 'bea' } });
    fireEvent.change(screen.getByLabelText('Tip amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send tip' }));
    expect(await screen.findByText('amount must be a positive finite number')).toBeTruthy();

    render(<ShareToSocial />);
    fireEvent.change(screen.getByLabelText('Listing id'), { target: { value: 'list-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share listing' }));
    expect(await screen.findByText(/transfer 0.0146/)).toBeTruthy();
    expect(screen.getByText(/marketplace 0.04/)).toBeTruthy();
  });

  it('says the moderation queue is limited to admins', async () => {
    render(<AdminModerationQueue />);
    expect(await screen.findByText('The queue is limited to admins.')).toBeTruthy();
  });
});
