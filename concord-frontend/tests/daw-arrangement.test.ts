import { describe, it, expect } from 'vitest';
import {
  OPEN_SECTION_BEATS, arrangementEnd, beatsPerBar, moveSection, relayout, removeSection, resizeSection,
  sectionsFromMarkers, totalBars, type SectionMarker,
} from '@/lib/daw/arrangement';

const mk = (id: string, name: string, timeBeats: number, lengthBeats?: number, kind = 'section'): SectionMarker =>
  ({ id, name, timeBeats, colour: '#fff', kind, ...(lengthBeats !== undefined ? { lengthBeats } : {}) });

describe('beatsPerBar', () => {
  it('reads the project signature in quarter-note beats', () => {
    expect(beatsPerBar('4/4')).toBe(4);
    expect(beatsPerBar('3/4')).toBe(3);
    expect(beatsPerBar('6/8')).toBe(3);
    expect(beatsPerBar('7/8')).toBe(3.5);
    expect(beatsPerBar(undefined)).toBe(4);
    expect(beatsPerBar('nonsense')).toBe(4);
  });
});

describe('sectionsFromMarkers', () => {
  it('uses only section markers, sorted by time', () => {
    const s = sectionsFromMarkers([mk('b', 'Chorus', 32, 32), mk('a', 'Intro', 0, 16), mk('c', 'cue', 8, undefined, 'cue')]);
    expect(s.map((x) => x.name)).toEqual(['Intro', 'Chorus']);
  });
  it('length: stored length wins, else the gap to the next section, else the open default (flagged)', () => {
    const s = sectionsFromMarkers([mk('a', 'A', 0, 8), mk('b', 'B', 16), mk('c', 'C', 40), mk('d', 'D', 100, 12)]);
    expect(s[0]).toMatchObject({ lengthBeats: 8, open: false });
    expect(s[1]).toMatchObject({ lengthBeats: 24, open: false }); // 40 - 16
    expect(s[2]).toMatchObject({ lengthBeats: 60, open: false }); // 100 - 40
    const open = sectionsFromMarkers([mk('x', 'X', 0)]);
    expect(open[0]).toMatchObject({ lengthBeats: OPEN_SECTION_BEATS, open: true });
  });
  it('total bars and arrangement end', () => {
    const s = sectionsFromMarkers([mk('a', 'A', 0, 16), mk('b', 'B', 16, 32)]);
    expect(totalBars(s, 4)).toBe(12);
    expect(arrangementEnd(s)).toBe(48);
    expect(totalBars([], 4)).toBe(0);
    expect(arrangementEnd([])).toBe(0);
  });
});

describe('re-layout', () => {
  const base = () => sectionsFromMarkers([mk('a', 'Intro', 0, 16), mk('b', 'Verse', 16, 32), mk('c', 'Chorus', 48, 32)]);
  it('moving a section swaps neighbours and only rewrites what changed', () => {
    const orig = base();
    const writes = relayout(moveSection(orig, 'b', -1), 0, orig); // Verse before Intro
    expect(writes).toEqual([
      { id: 'b', timeBeats: 0, lengthBeats: 32 },
      { id: 'a', timeBeats: 32, lengthBeats: 16 },
    ]); // Chorus stays at 48: untouched
  });
  it('edge moves are no-ops', () => {
    const orig = base();
    expect(moveSection(orig, 'a', -1)).toBe(orig);
    expect(moveSection(orig, 'c', 1)).toBe(orig);
    expect(relayout(orig, 0, orig)).toEqual([]);
  });
  it('resizing shifts everything after it, clamped to 1..64 bars', () => {
    const orig = base();
    const writes = relayout(resizeSection(orig, 'a', 2, 4), 0, orig); // Intro 4 -> 6 bars
    expect(writes).toEqual([
      { id: 'a', timeBeats: 0, lengthBeats: 24 },
      { id: 'b', timeBeats: 24, lengthBeats: 32 },
      { id: 'c', timeBeats: 56, lengthBeats: 32 },
    ]);
    expect(resizeSection(orig, 'a', -99, 4).find((s) => s.id === 'a')!.lengthBeats).toBe(4); // floor 1 bar
    expect(resizeSection(orig, 'a', 999, 4).find((s) => s.id === 'a')!.lengthBeats).toBe(256); // cap 64 bars
  });
  it('deleting closes the gap', () => {
    const orig = base();
    const writes = relayout(removeSection(orig, 'a'), 0, orig);
    expect(writes).toEqual([
      { id: 'b', timeBeats: 0, lengthBeats: 32 },
      { id: 'c', timeBeats: 32, lengthBeats: 32 },
    ]);
  });
  it('an open-ended last section is given an explicit length on the next layout', () => {
    const orig = sectionsFromMarkers([mk('a', 'A', 0, 8), mk('b', 'B', 8)]);
    const writes = relayout(orig, 0, orig);
    expect(writes).toEqual([{ id: 'b', timeBeats: 8, lengthBeats: OPEN_SECTION_BEATS }]);
  });
});
