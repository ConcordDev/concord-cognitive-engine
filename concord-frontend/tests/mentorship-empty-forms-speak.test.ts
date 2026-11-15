// FIX-mentorship-006 — 'Send request' disabled on blank fields with
// no word about which were missing, and 'Open conversation' silently
// did nothing on a blank partner ID, while sibling forms in the same
// lens already speak ('Goal title is required.'). Both now name the
// missing field.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = readFileSync(path.resolve(__dirname, '..', 'components/mentorship/MentorDirectoryPanel.tsx'), 'utf8');
const msg = readFileSync(path.resolve(__dirname, '..', 'components/mentorship/MentorshipMessagesPanel.tsx'), 'utf8');

describe('FIX-mentorship-006 — empty mentorship forms speak', () => {
  it('send-request names the missing fields beside the disabled button', () => {
    expect(dir).toContain('role="note"');
    expect(dir).toContain('to send the request.</p>');
    expect(dir).toContain("!reqForm.topic.trim() ? 'a topic' : null");
  });
  it('open-conversation refuses a blank partner ID in words', () => {
    expect(msg).toContain("setError('Partner user ID is required.')");
    expect(msg).not.toContain('if (newPartner.trim()) { setShowNew(false); void openThread(newPartner.trim()); }');
  });
});
