// MailFilterEmptyState.test.tsx
//
// FIX-mail-006: the inbox empty state must be filter-aware. With mail
// in the folder but none matching the active status filter, the panel
// says "No matches" — "No mail yet" is reserved for a truly empty
// inbox. (The walk recorded 'No mail yet' under unread/read/claimed/
// expired filters; this pin holds the filter-aware behavior.)

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ playerMail: vi.fn() }));
const row = (id: string, status: string) => ({
  id, status, subject: `Subject ${id}`, body: `Body ${id}`, fromName: 'Ada', fromHandle: 'ada',
  toName: 'Bo', toHandle: 'bo', sentAt: 1_770_000_000, expiresAt: 1_780_000_000,
  attachment_dtu_ids: [], attachmentCc: 0, codCc: 0,
});

vi.mock('../playerMail', async () => {
  const actual = await vi.importActual<typeof import('../playerMail')>('../playerMail');
  return { ...actual, playerMail: (...a: unknown[]) => h.playerMail(...a) };
});
vi.mock('../MailKeepMenu', () => ({ MailKeepMenu: () => <span>keep-stub</span> }));
vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 20)); }); };

async function mount() {
  const { MailFolderPanel } = await import('../MailFolderPanel');
  const v = render(<MailFolderPanel folder="inbox" onCompose={vi.fn()} />);
  await settle();
  return v;
}

afterEach(() => cleanup());
beforeEach(() => { h.playerMail.mockReset(); });

describe('Mail inbox filter-aware empty state (FIX-mail-006)', () => {
  it('says No matches (not No mail yet) when a status filter excludes everything', async () => {
    h.playerMail.mockImplementation(async (action: string) => {
      if (action === 'list') return { ok: true, mail: [row('m2', 'read')] };
      if (action === 'sent') return { ok: true, mail: [] };
      return { ok: true };
    });
    const view = await mount();
    expect(view.container.textContent).toMatch(/Subject m2/);
    await click(screen.getByRole('button', { name: 'unread' }));
    expect(view.container.textContent).toMatch(/No matches/);
    expect(view.container.textContent).toMatch(/No mail matches this filter or search\./);
    expect(view.container.textContent).not.toMatch(/No mail yet/);
    await click(screen.getByRole('button', { name: 'expired' }));
    expect(view.container.textContent).toMatch(/No matches/);
    expect(view.container.textContent).not.toMatch(/No mail yet/);
  });

  it('says No mail yet only when the inbox is truly empty', async () => {
    h.playerMail.mockImplementation(async (action: string) => {
      if (action === 'list') return { ok: true, mail: [] };
      if (action === 'sent') return { ok: true, mail: [] };
      return { ok: true };
    });
    const view = await mount();
    expect(view.container.textContent).toMatch(/No mail yet/);
  });

  it('names the active filter when the inbox is empty and a filter is selected (FIX-mail-006, residue leg)', async () => {
    h.playerMail.mockImplementation(async (action: string) => {
      if (action === 'list') return { ok: true, mail: [] };
      if (action === 'sent') return { ok: true, mail: [] };
      return { ok: true };
    });
    const view = await mount();
    await click(screen.getByRole('button', { name: 'unread' }));
    expect(view.container.textContent).toMatch(/No unread mail/);
    expect(view.container.textContent).not.toMatch(/No mail yet/);
  });
});
