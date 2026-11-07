// Declaration + surface pins for the mail full lens build (F-B row 10).
//
// The declaration was ABSENT entire at premise (F1, genesis form), so
// the legs pin what the build added: the manifest tier, the scoped
// badge caption stating the Player/Gmail split. The surface pins assert
// the built legs' forms: correspondent names from the server payload,
// never the raw id (F3); the two-step Sent delete wired to mail.delete
// (F5); the gmail error-wording map over the full reason-code set (F2);
// and the player-mail load failure stated in product words.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import { gmailErrorText, NOT_CONNECTED } from '@/components/mail/client/gmail';
import { deleteResultText, mailPartyLabel } from '@/components/mail/playerMail';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('mail declarations', () => {
  it('manifest carries mail at REAL_LIVE', () => {
    expect(getLensManifest('mail')?.dataTier).toBe('REAL_LIVE');
  });

  it('depth badge carries the scoped two-mailbox caption', () => {
    const { result } = renderHook(() => useDepthBadge('mail'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('Player mail is real');
    expect(result.current.caption).toContain('your own Google account');
    expect(result.current.caption).toContain('connect wall');
    expect(result.current.caption).not.toContain('polled live from an external source');
  });
});

describe('correspondent labels (F3)', () => {
  it('prefers the display name, then the handle, then a neutral word — never a raw id', () => {
    expect(mailPartyLabel('Alice A', 'alice')).toBe('Alice A');
    expect(mailPartyLabel(null, 'alice')).toBe('@alice');
    expect(mailPartyLabel(null, null)).toBe('A Concord member');
    expect(mailPartyLabel('', '')).toBe('A Concord member');
  });

  it('the folder panel renders names and never slices a raw id into a row', () => {
    const src = read('components/mail/MailFolderPanel.tsx');
    expect(src).toContain('mailPartyLabel(selected.fromName, selected.fromHandle)');
    expect(src).toContain('mailPartyLabel(selected.toName, selected.toHandle)');
    expect(src).not.toContain('other?.slice(0, 16)');
    expect(src).not.toContain('{selected.fromUser}');
    expect(src).not.toContain('{selected.toUser}');
  });
});

describe('sent delete (F5)', () => {
  it('the panel offers a two-step delete on sent mail, wired to mail.delete', () => {
    const src = read('components/mail/MailFolderPanel.tsx');
    expect(src).toContain("playerMail('delete', { id: mailId })");
    expect(src).toContain('Remove from Sent');
    expect(src).toContain('The recipient keeps theirs.');
    expect(src).toContain('setConfirmDelete(true)');
  });

  it('delete outcomes render in product words', () => {
    expect(deleteResultText({ ok: true }).msg).toContain('Removed from your Sent list');
    expect(deleteResultText({ ok: false, error: 'already_claimed' }).msg).toContain('claim record');
    expect(deleteResultText({ ok: false, error: 'not_authorized' }).msg).toContain('only remove mail you sent');
    expect(deleteResultText({ ok: false, error: 'not_found' }).msg).toContain('already gone');
  });
});

describe('gmail error wording (F2)', () => {
  it('every NOT_CONNECTED code stays a wall state, and also maps to words', () => {
    for (const code of NOT_CONNECTED) {
      expect(gmailErrorText(code)).not.toBe(code);
      expect(gmailErrorText(code)).not.toContain('_');
    }
  });

  it('the residue codes render in product words, never as raw codes', () => {
    for (const code of ['auth_expired', 'reauth_required', 'handler_error', 'network_error', 'threads_failed', 'some_new_code']) {
      const words = gmailErrorText(code);
      expect(words).not.toBe(code);
      expect(words).not.toContain('_');
    }
    expect(gmailErrorText('auth_expired')).toContain('expired');
    expect(gmailErrorText('db unavailable')).toContain('unavailable');
    expect(gmailErrorText(undefined)).toContain('went wrong');
  });

  it('the client routes list errors through the wording map', () => {
    const src = read('components/mail/client/MailClient.tsx');
    expect(src).toContain('setListError(gmailErrorText(r.error))');
    expect(src).not.toContain('setListError(r.error)');
  });
});

describe('open path + load wording (F4)', () => {
  it('the read flip is inbox-only and its failure is one inline product-word notice', () => {
    const src = read('components/mail/MailFolderPanel.tsx');
    expect(src).toContain("folder !== 'inbox'");
    expect(src).toContain('could not be marked as read');
    expect(src).not.toContain("err.replace(/_/g, ' ')");
  });
});
