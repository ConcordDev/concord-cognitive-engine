/**
 * FIX-atlas-007 — atlas controls reached the a11y tree with generic
 * or numeric names: MapLibre names every marker element "Map
 * marker" by default, and the AtlasShell activity-bar buttons are
 * icon-only with a count badge, so their name-from-content was the
 * badge digit ('1' / '2'). Markers now carry their own place label
 * (set in the shared MapView, where the marker element is created),
 * and the nav buttons carry aria-label from the same label their
 * title shows. The ticket's share-button leg was not locatable at
 * branch state — the share trigger is named "Share or act on this
 * place" — and is left to the desk's live re-walk.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-atlas-007 — atlas control names', () => {
  it('MapView names each marker element from its label', () => {
    const s = read('components/common/MapView.tsx');
    expect(s).toContain("marker.getElement().setAttribute('aria-label', m.label)");
  });

  it('AtlasShell nav buttons carry aria-label, not just the badge digit', () => {
    const s = read('components/atlas/AtlasShell.tsx');
    expect(s).toContain('aria-label={n.label}');
    expect(s).toContain('title={n.label}');
  });
});
