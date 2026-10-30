/** Shared types/constants for the FigJam-shaped whiteboard studio. */

export type BoardMode = 'canvas' | 'moodboard' | 'arrangement';

export type SketchTool =
  | 'select' | 'draw' | 'rectangle' | 'ellipse' | 'line' | 'arrow'
  | 'text' | 'dtu' | 'audio' | 'image' | 'notecard' | 'section';

export type SketchElement = {
  id: string;
  type: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'freehand' | 'dtu'
    | 'audio' | 'image' | 'notecard' | 'section';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: { x: number; y: number }[];
  text?: string;
  dtuId?: string;
  dtuTitle?: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
  rotation?: number;
  clipName?: string;
  duration?: number;
  playing?: boolean;
  imageUrl?: string;
  imageLabel?: string;
  cardColor?: string;
  sectionType?: string;
  bars?: number;
};

export type ArrangementSection = {
  id: string;
  type: string;
  label: string;
  bars: number;
  color: string;
};

export type MoodZone = {
  id: string;
  label: string;
  items: { kind: 'color' | 'text' | 'image' | 'audio'; value: string }[];
};

export const COLORS = ['#00d4ff', '#a855f7', '#ec4899', '#22c55e', '#f59e0b', '#ef4444', '#ffffff', '#6b7280'];
export const STROKE_WIDTHS = [1, 2, 4, 6, 8];
export const CARD_COLORS = ['#fbbf24', '#34d399', '#f472b6', '#60a5fa', '#c084fc', '#fb923c'];
export const SECTION_PRESETS: { type: string; label: string; bars: number; color: string }[] = [
  { type: 'intro', label: 'Intro', bars: 4, color: '#60a5fa' },
  { type: 'verse', label: 'Verse', bars: 8, color: '#34d399' },
  { type: 'prechorus', label: 'Pre-Chorus', bars: 4, color: '#fbbf24' },
  { type: 'chorus', label: 'Chorus', bars: 8, color: '#f472b6' },
  { type: 'bridge', label: 'Bridge', bars: 4, color: '#c084fc' },
  { type: 'outro', label: 'Outro', bars: 4, color: '#fb923c' },
];
export const DEFAULT_ARRANGEMENT: ArrangementSection[] = [
  { id: 'arr_1', type: 'intro', label: 'Intro', bars: 4, color: '#60a5fa' },
  { id: 'arr_2', type: 'verse', label: 'Verse 1', bars: 8, color: '#34d399' },
  { id: 'arr_3', type: 'prechorus', label: 'Pre-Chorus', bars: 4, color: '#fbbf24' },
  { id: 'arr_4', type: 'chorus', label: 'Chorus 1', bars: 8, color: '#f472b6' },
  { id: 'arr_5', type: 'verse', label: 'Verse 2', bars: 8, color: '#34d399' },
  { id: 'arr_6', type: 'chorus', label: 'Chorus 2', bars: 8, color: '#f472b6' },
  { id: 'arr_7', type: 'bridge', label: 'Bridge', bars: 4, color: '#c084fc' },
  { id: 'arr_8', type: 'chorus', label: 'Final Chorus', bars: 8, color: '#f472b6' },
  { id: 'arr_9', type: 'outro', label: 'Outro', bars: 4, color: '#fb923c' },
];
export const DEFAULT_MOOD_ZONES: MoodZone[] = [
  { id: 'mz_1', label: 'Ideas & Concepts', items: [] },
  { id: 'mz_2', label: 'Visual References', items: [] },
  { id: 'mz_3', label: 'Mood Words', items: [] },
  { id: 'mz_4', label: 'Color Palette', items: [] },
  { id: 'mz_5', label: 'Tools & Resources', items: [] },
  { id: 'mz_6', label: 'Inspiration Board', items: [] },
];

export const MODE_LABELS: Record<BoardMode, string> = {
  canvas: 'Freeform Canvas',
  moodboard: 'Moodboard',
  arrangement: 'Arrangement Sketch',
};

export const uid = () => `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- multi-selection model (Q57) ----------
 * The canvas selection is a set of element ids. These pure helpers own
 * the semantics so the studio component only wires them to events:
 * plain click replaces (unless the clicked element is already in the
 * set — then the set survives so a drag moves the whole group),
 * shift/⌘-click toggles, click on empty canvas clears, ⌘A selects all.
 */

export type Selection = ReadonlySet<string>;

export function clickSelection(current: Selection, clickedId: string | null, additive: boolean): Set<string> {
  if (additive) {
    const next = new Set(current);
    if (clickedId) {
      if (next.has(clickedId)) next.delete(clickedId);
      else next.add(clickedId);
    }
    return next;
  }
  if (!clickedId) return new Set();
  if (current.has(clickedId)) return new Set(current);
  return new Set([clickedId]);
}

export function selectAllIds(elements: SketchElement[]): Set<string> {
  return new Set(elements.map((el) => el.id));
}

/** Snapshot of where each selected element starts a drag. */
export interface DragStart { x: number; y: number; points?: { x: number; y: number }[] }

export function dragStarts(elements: SketchElement[], ids: Selection): Map<string, DragStart> {
  const starts = new Map<string, DragStart>();
  for (const el of elements) {
    if (!ids.has(el.id)) continue;
    starts.set(el.id, {
      x: el.x,
      y: el.y,
      points: el.points ? el.points.map((p) => ({ ...p })) : undefined,
    });
  }
  return starts;
}

/** Move every element in `starts` by (dx, dy) from its drag-start position. */
export function moveSelection(elements: SketchElement[], starts: Map<string, DragStart>, dx: number, dy: number): SketchElement[] {
  // A zero delta is NOT a no-op: dragging back to the grab point must restore the start positions, not leave
  // the elements at the last intermediate move.
  if (starts.size === 0) return elements;
  return elements.map((el) => {
    const start = starts.get(el.id);
    if (!start) return el;
    return {
      ...el,
      x: start.x + dx,
      y: start.y + dy,
      points: start.points ? start.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) : el.points,
    };
  });
}

export function deleteSelection(elements: SketchElement[], ids: Selection): SketchElement[] {
  if (ids.size === 0) return elements;
  return elements.filter((el) => !ids.has(el.id));
}

/** Copies of every selected element, offset by (+16, +16), in board order. */
export function duplicateSelection(elements: SketchElement[], ids: Selection, makeId: () => string): SketchElement[] {
  return elements
    .filter((el) => ids.has(el.id))
    .map((el) => ({
      ...el,
      id: makeId(),
      x: (el.x ?? 0) + 16,
      y: (el.y ?? 0) + 16,
      points: el.points ? el.points.map((p) => ({ x: p.x + 16, y: p.y + 16 })) : el.points,
    }));
}
