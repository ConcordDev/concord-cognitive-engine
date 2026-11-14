/**
 * Photos format honesty (FIX-photos-008, FE halves).
 * The import must send the file's own bytes (no canvas re-encode to
 * PNG for storable formats), and the lightbox File row must show the
 * photo's real format instead of a hardcoded "PNG".
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const page = fs.readFileSync(path.join(process.cwd(), 'app/lenses/photos/page.tsx'), 'utf8');
const lightbox = fs.readFileSync(path.join(process.cwd(), 'components/photos/PhotoLightboxModal.tsx'), 'utf8');

describe('photos format label (FIX-photos-008)', () => {
  it('import sends original bytes for storable formats', () => {
    expect(page).toContain('readAsImageDataUrl');
    expect(page).toContain('STORABLE_TYPES');
    expect(page).toContain('reader.readAsDataURL(file)');
    expect(page).not.toContain('readAsPngDataUrl');
  });

  it('lightbox shows the real format, never a hardcoded PNG', () => {
    expect(lightbox).toContain('photo.format');
    expect(lightbox).not.toContain('PNG &middot;');
  });
});
