/**
 * stale-display-genus.test.ts — CB-0456 guard (B6).
 *
 * Pins:
 *  - FIX-studio-003: arrangement clip bodies take their track's colour (the
 *    clip's creation-time colour copy no longer shadows a track recolor).
 *  - FIX-mail-015: the claim-result note is scoped to the mail it belongs to.
 *  - FIX-mail-019: the detail pane closes a mail the visible list no longer
 *    contains, and the folder panel stays mounted during compose so its
 *    filter state survives.
 *  - FIX-social-017: opening a thread reloads the inbox list so the unread
 *    badge and preview catch up.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('CB-0456 stale-display genus', () => {
  it('FIX-studio-003: clip bodies render with track.color, not the clip colour copy', () => {
    const src = read('components/studio/ArrangementView.tsx');
    expect(src).toContain("backgroundColor: track.color + '40'");
    expect(src).toContain('borderColor: track.color,');
    expect(src).not.toContain('clip.color || track.color');
  });

  it('FIX-mail-015: claim note is stored and rendered per-mail', () => {
    const src = read('components/mail/MailFolderPanel.tsx');
    expect(src).toContain('setClaimNote({ mailId, msg: note.msg })');
    expect(src).toContain('claimNote.mailId === selected.id');
  });

  it('FIX-mail-019: selection reconciles against visible rows; panel stays mounted during compose', () => {
    const panel = read('components/mail/MailFolderPanel.tsx');
    expect(panel).toContain('!rows.some((r) => r.id === selected.id)');
    const client = read('components/mail/client/MailClient.tsx');
    expect(client).toContain('lastFolderRef');
    expect(client).not.toContain("tab === 'compose' ? <ComposeMailPanel");
  });

  it('FIX-social-017: openThread reloads the inbox list on success', () => {
    const src = read('components/social/feed/DMInbox.tsx');
    const openThread = src.slice(src.indexOf('const openThread'), src.indexOf('const send'));
    expect(openThread).toContain('void loadInbox()');
  });
});
