/**
 * silent-validation-genus.test.ts — CB-0463 guard (B6).
 *
 * The platform contract: server.js INPUT_LIMITS rejects title/name fields
 * over 200 chars at the API (HTTP 400, console-only). Each pin holds a
 * surface to validating at the field against the tightest limit that
 * governs it, with feedback a user can see.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('CB-0463 silent-validation genus', () => {
  it('FIX-board-011: new-board name caps at the handler limit (120) with a counter', () => {
    const src = read('components/board/BoardWorkspace.tsx');
    expect(src).toContain('maxLength={120}');
    expect(src).toContain('{newBoardName.length}/120');
  });

  it('FIX-events-011: event create name caps at the platform name limit (200)', () => {
    const src = read('components/events/EventOps.tsx');
    expect(src).toContain('value={newEvtName} maxLength={200}');
  });

  it('FIX-council-003: proposal title caps at the platform title limit (200) with a counter', () => {
    const src = read('components/council/CouncilChamber.tsx');
    expect(src).toContain('maxLength={200}');
    expect(src).toContain('{newProposal.title.length}/200');
  });

  it('FIX-music-004: blank track titles are refused in words; the field is capped', () => {
    const src = read('components/music/MusicActionPanel.tsx');
    expect(src).toContain('maxLength={185}');
    expect(src.match(/Give the track a title first/g)?.length).toBe(2);
  });

  it('FIX-art-001: artwork rename caps at the platform title limit (200)', () => {
    const src = read('components/art/ArtCanvas.tsx');
    expect(src).toContain('maxLength={200}');
  });

  it('FIX-foundry-003: world name caps at 200 and a blank name is refused in words', () => {
    const src = read('components/foundry/FoundryCanvas.tsx');
    expect(src).toContain('maxLength={200}');
    expect(src).toContain('Give the game a name first');
  });

  it('FIX-photos-007: a cleared album name explains the disabled Create', () => {
    const src = read('app/lenses/photos/page.tsx');
    expect(src).toContain('Name the album to create it.');
  });
});
