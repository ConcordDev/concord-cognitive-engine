/**
 * Profile posts route shape (FIX-metalearning-012, console-404 leg).
 * The profile pages and the shared API client called
 * GET /api/social/posts/<userId> — a route that does not exist (the
 * user-posts route is /api/social/posts/user/<userId>, registered in
 * both routes/social-core.js and server.js), so the Posts/Media tabs
 * 404'd and rendered permanently empty, and the public DTUs tab aimed
 * at the same dead shape instead of the dedicated
 * /api/social/dtus/user/<userId> collection route. These pins keep
 * every caller on the routes that exist.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const own = read('app/profile/page.tsx');
const pub = read('app/profile/[username]/page.tsx');
const client = read('lib/api/client.ts');

describe('profile posts route shape (FIX-metalearning-012)', () => {
  it('no caller uses the nonexistent /api/social/posts/<userId> GET shape', () => {
    for (const src of [own, pub, client]) {
      expect(src).not.toContain('api.get(`/api/social/posts/${userId}`');
      expect(src).not.toContain('api.get(`/api/social/posts/${userId}`,');
    }
  });

  it('posts and media tabs read the registered /posts/user/ route', () => {
    expect(own).toContain('/api/social/posts/user/${userId}');
    expect(pub).toContain('/api/social/posts/user/${userId}');
    expect(client).toContain('/api/social/posts/user/${userId}');
  });

  it('the public DTUs tab reads the dedicated dtus collection route + field', () => {
    expect(pub).toContain('/api/social/dtus/user/${userId}');
    expect(pub).toContain('res.data.dtus');
  });
});
