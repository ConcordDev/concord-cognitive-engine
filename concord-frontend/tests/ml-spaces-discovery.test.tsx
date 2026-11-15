/**
 * ML Spaces discovery section (FIX-ml-012, panel half).
 * The panel must actually request the public scope and render the
 * discovery listing, or the server's new listing has no surface.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/ml/SpacesPanel.tsx'), 'utf8');

describe('ml spaces discovery (FIX-ml-012)', () => {
  it('requests scope public and renders a Discover section', () => {
    expect(src).toContain("scope: 'public'");
    expect(src).toContain('Discover public spaces');
    expect(src).toContain('public · yours');
  });
});
