/**
 * FIX-insurance-014 — writing a pact demanded a raw beneficiary user
 * id with no way to find one, and the writer's own id was shown
 * nowhere. The form now searches the user directory (the same
 * /api/social/users/search the calendar collaborator picker uses),
 * fills the id from a picked person, and prints the writer's own id
 * with the note that a beneficiary must be someone else.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-insurance-014 — beneficiary picker', () => {
  const s = read('components/insurance/MutualAidPactsPanel.tsx');

  it('searches the user directory and fills the id from a pick', () => {
    expect(s).toContain("api.get('/api/social/users/search', { params: { q } })");
    expect(s).toContain('setForm((f) => ({ ...f, beneficiaryUserId: u.id }))');
  });

  it("shows the writer's own user id", () => {
    expect(s).toContain('Your own user id:');
    expect(s).toContain('a beneficiary must be someone else');
  });
});
