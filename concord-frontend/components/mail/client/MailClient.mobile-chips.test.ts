// FIX-mail-009: at 390px the mobile folder chip row drew the native
// scrollbar bar and the last chip ('Player mail') read as clipped with no
// cue; the content column also lacked min-w-0, so a wide descendant could
// hold the 1fr grid column open past the viewport. Source-pin (the defect
// is absent classes on data-driven markup).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'MailClient.tsx'), 'utf8');

describe('MailClient mobile layout (FIX-mail-009)', () => {
  it('the folder chip row scrolls with no native scrollbar bar', () => {
    expect(SRC).toContain('no-scrollbar flex gap-1 overflow-x-auto md:hidden');
  });

  it('the content column can shrink to the viewport', () => {
    expect(SRC).toContain('flex min-h-0 min-w-0 flex-col gap-2');
  });
});
