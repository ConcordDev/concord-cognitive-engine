/**
 * The Booth's three rooms over one song. Same project, same undo history,
 * same transport; each room lays out the tools one job needs.
 *   Write   (artist)   record takes, comp, tune, mark song sections, collaborate
 *   Produce (producer) instruments, beats, piano roll, session clips, devices, feel
 *   Mix     (engineer) console faders and meters, inserts, master, controllers, export
 */

export type Room = 'write' | 'produce' | 'mix';

export const ROOMS: ReadonlyArray<{ id: Room; label: string; key: string; who: string }> = [
  { id: 'write', label: 'Write', key: '1', who: 'Record, comp and tune takes' },
  { id: 'produce', label: 'Produce', key: '2', who: 'Build beats, parts and sounds' },
  { id: 'mix', label: 'Mix', key: '3', who: 'Balance, master and export' },
];

export const ROOM_KEY = 'concord-studio-room';

export function roomFromKey(key: string): Room | null {
  return ROOMS.find((r) => r.key === key)?.id ?? null;
}

export function parseRoom(v: string | null | undefined): Room | null {
  return v === 'write' || v === 'produce' || v === 'mix' ? v : null;
}
