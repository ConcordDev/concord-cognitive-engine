import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ANON_BROWSE_HEADER } from '@/lib/anon-browse-constants';

// The root layout is a server component. A plain value imported from a 'use client' module
// arrives there as a client reference (a function), so headers().get(<it>) threw and every
// page 500'd in production (#1990). The header name must come from a server-safe module.
const root = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('root layout reads the anon-browse header from a server-safe module', () => {
  it('anon-browse-constants is not a client module and exports the literal header', () => {
    expect(read('lib/anon-browse-constants.ts')).not.toMatch(/^\s*['"]use client['"]/m);
    expect(ANON_BROWSE_HEADER).toBe('x-concord-anon-browse');
  });
  it('layout.tsx imports ANON_BROWSE_HEADER from anon-browse-constants, not the client module', () => {
    const src = read('app/layout.tsx');
    expect(src).toMatch(/import\s*\{\s*ANON_BROWSE_HEADER\s*\}\s*from\s*'@\/lib\/anon-browse-constants'/);
    const clientImport = src.match(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/anon-browse'/);
    expect(clientImport?.[1] ?? '').not.toMatch(/ANON_BROWSE_HEADER|PUBLIC_BROWSE_LENSES/);
  });
  it('middleware literal still equals the shared constant', () => {
    expect(read('middleware.ts')).toContain(`const ANON_BROWSE_HEADER = '${ANON_BROWSE_HEADER}'`);
  });
});
