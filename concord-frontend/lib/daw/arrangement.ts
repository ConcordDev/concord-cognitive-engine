/**
 * Arrangement Sketch model: pure helpers over studio.* markers (kind "section")
 * and audio clips. The server stores sections as timeline markers
 * (`studio.markers-*`) with an optional `lengthBeats`; everything here derives
 * the sketch from those records and computes the writes needed to re-lay-out
 * sections, so the component only wires events to macros. Nothing is invented:
 * an open-ended last section is drawn with a default width and flagged `open`.
 */

export interface SectionMarker {
  id: string;
  name: string;
  timeBeats: number;
  colour: string;
  kind: string;
  lengthBeats?: number;
}

export interface SketchSection {
  id: string;
  name: string;
  colour: string;
  startBeats: number;
  lengthBeats: number;
  /** True when no explicit length is stored and no later section bounds it (drawn at a default width). */
  open: boolean;
}

export interface SectionWrite { id: string; timeBeats: number; lengthBeats: number }

/** Length drawn for a last section that has neither a stored length nor a following section. */
export const OPEN_SECTION_BEATS = 16;

/** Beats per bar from a "4/4"-style signature (quarter-note beats). 4/4 → 4, 6/8 → 3, 3/4 → 3. */
export function beatsPerBar(timeSignature: unknown): number {
  const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(String(timeSignature ?? '4/4').trim());
  if (!m) return 4;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!(num > 0) || !(den > 0)) return 4;
  return (num * 4) / den;
}

export function sectionsFromMarkers(markers: SectionMarker[]): SketchSection[] {
  const sec = markers.filter((m) => m.kind === 'section').sort((a, b) => a.timeBeats - b.timeBeats);
  return sec.map((m, i) => {
    const next = sec[i + 1];
    const stored = Number(m.lengthBeats) > 0 ? Number(m.lengthBeats) : 0;
    const gap = next ? Math.max(0, next.timeBeats - m.timeBeats) : 0;
    const lengthBeats = stored || gap || OPEN_SECTION_BEATS;
    return { id: m.id, name: m.name, colour: m.colour || '#fbbf24', startBeats: m.timeBeats, lengthBeats, open: !stored && !gap };
  });
}

export function totalBars(sections: SketchSection[], bpb: number): number {
  if (!sections.length || !(bpb > 0)) return 0;
  const end = Math.max(...sections.map((s) => s.startBeats + s.lengthBeats));
  const start = Math.min(...sections.map((s) => s.startBeats));
  return Math.round(((end - start) / bpb) * 100) / 100;
}

/** Lay `ordered` out back to back from `origin`; returns only the sections whose stored time/length must change. */
export function relayout(ordered: SketchSection[], origin: number, original: SketchSection[]): SectionWrite[] {
  const before = new Map(original.map((s) => [s.id, s]));
  const writes: SectionWrite[] = [];
  let cursor = origin;
  for (const s of ordered) {
    const prev = before.get(s.id);
    if (!prev || prev.startBeats !== cursor || prev.lengthBeats !== s.lengthBeats || prev.open) {
      writes.push({ id: s.id, timeBeats: cursor, lengthBeats: s.lengthBeats });
    }
    cursor += s.lengthBeats;
  }
  return writes;
}

export function moveSection(sections: SketchSection[], id: string, dir: -1 | 1): SketchSection[] {
  const i = sections.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sections.length) return sections;
  const next = sections.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function resizeSection(sections: SketchSection[], id: string, deltaBars: number, bpb: number): SketchSection[] {
  return sections.map((s) => {
    if (s.id !== id) return s;
    const bars = Math.max(1, Math.min(64, Math.round(s.lengthBeats / bpb) + deltaBars));
    return { ...s, lengthBeats: bars * bpb };
  });
}

export function removeSection(sections: SketchSection[], id: string): SketchSection[] {
  return sections.filter((s) => s.id !== id);
}

/** End of the arrangement in beats (where the next appended section starts). */
export function arrangementEnd(sections: SketchSection[]): number {
  return sections.length ? Math.max(...sections.map((s) => s.startBeats + s.lengthBeats)) : 0;
}
