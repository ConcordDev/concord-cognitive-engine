/**
 * FIX-mail-007 — typing in Subject scrambled: the compose panel's
 * async draft restore landed mid-typing and overwrote the fields
 * with the stale draft. The restore now fills only fields that are
 * still empty when it resolves, via functional updates.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-mail-007 — draft restore respects in-progress typing', () => {
  const s = read('components/mail/ComposeMailPanel.tsx');

  it('restores into empty fields only', () => {
    expect(s).toContain('setComposeSubject((prev) => prev || d.subject)');
    expect(s).toContain('setComposeBody((prev) => prev || d.body)');
    expect(s).toContain('setComposeTo((prev) => prev || d.toUserId)');
  });

  it('no unconditional draft overwrite remains', () => {
    expect(s).not.toContain('if (d.subject) setComposeSubject(d.subject);');
    expect(s).not.toContain('if (d.body) setComposeBody(d.body);');
  });
});
