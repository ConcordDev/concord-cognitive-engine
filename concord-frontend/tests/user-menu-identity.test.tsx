/**
 * User menu identity + export toast remedy (FIX-government-010).
 * The shell user menu offered Sign Out without naming the account;
 * it now reads /api/auth/me and heads the menu with the signed-in
 * username/email. The shared .dtu export refusal named the problem
 * but not the remedy; the toast now says what to do first.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const menu = fs.readFileSync(path.join(process.cwd(), 'components/shell/topbar/UserMenu.tsx'), 'utf8');
const exporter = fs.readFileSync(path.join(process.cwd(), 'components/lens/DTUExportButton.tsx'), 'utf8');

describe('user menu identity (FIX-government-010)', () => {
  it('reads /api/auth/me and renders the account name in the menu', () => {
    expect(menu).toContain("api.get('/api/auth/me')");
    expect(menu).toContain('identity.username || identity.email');
  });

  it('the export refusal names the remedy', () => {
    expect(exporter).toContain('Create or save something in this lens first, then export.');
  });
});
