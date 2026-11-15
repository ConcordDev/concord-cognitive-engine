/**
 * Forestry Workbench DM recipient (FIX-forestry-009).
 * The DM form took a free-text "recipient" and posted it as toUserId —
 * a typed handle is not a user id, so every typed DM (including to
 * your own handle) failed with a bare 'recipient not found' and no
 * guidance. The form now uses the shared UserPicker (the society-011
 * pattern): a recipient exists only once picked from search results,
 * the send carries the picked user's id, and sending with nobody
 * picked explains the rule (another user; never yourself).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/forestry/ForestryActionPanel.tsx'), 'utf8');

describe('forestry DM recipient (FIX-forestry-009)', () => {
  it('uses the shared UserPicker and sends the picked user id', () => {
    expect(src).toContain("from '@/components/social/UserPicker'");
    expect(src).toContain('toUserId: recipientUser.userId');
    expect(src).not.toContain('toUserId: recipient.trim()');
  });

  it('explains the recipient rule when nobody is picked', () => {
    expect(src).toContain("Pick a recipient from the search results first");
    expect(src).toContain('send one to yourself');
  });
});
