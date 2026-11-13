// FIX-byo-keys-004: org key groups could not be deleted or left — the
// panel offered neither control and the server had no such actions.
// Source-pin: the panel wires both actions, owner sees delete, members
// see leave.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'OrgKeysPanel.tsx'), 'utf8');

describe('Org group delete / leave (FIX-byo-keys-004)', () => {
  it('the panel calls org_key_delete and org_key_leave', () => {
    expect(SRC).toContain("lensRun('byo_keys', 'org_key_delete', { orgId })");
    expect(SRC).toContain("lensRun('byo_keys', 'org_key_leave', { orgId })");
    expect(SRC).toContain('delete group');
    expect(SRC).toContain('leave');
  });
});
