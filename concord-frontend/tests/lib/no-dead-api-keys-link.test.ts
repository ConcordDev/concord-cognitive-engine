// no-dead-api-keys-link.test.ts — SOURCE pin for FIX-expert-mode-008.
//
// The /api-keys page was retired when phase 7.4 replaced pasted plugin
// keys with the OAuth flow; no app route serves it. The dx-platform
// quick-link grid still linked to it, so Next.js RSC prefetch 404'd
// repeatedly during walks. This pin scans the frontend source for any
// page link to the dead route so the link cannot quietly return.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name)) yield p;
  }
}

describe('no page links to the retired /api-keys route (FIX-expert-mode-008)', () => {
  it('no href targets /api-keys anywhere in app/ or components/', () => {
    const offenders: string[] = [];
    for (const root of ['app', 'components']) {
      for (const file of walk(join(process.cwd(), root))) {
        const src = readFileSync(file, 'utf8');
        if (/href=\{?["'`]\/api-keys["'`]\}?/.test(src) || /href="\/api-keys\?/.test(src)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
