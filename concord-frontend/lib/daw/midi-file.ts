/** Standard MIDI File (format 0/1) reader → notes in beats, one entry per MIDI track with notes. */

export interface ParsedMidiTrack {
  name: string;
  notes: Array<{ pitch: number; velocity: number; startBeat: number; lengthBeats: number; channel: number }>;
  isDrums: boolean;
}

export interface ParsedMidi {
  bpm: number | null;
  tracks: ParsedMidiTrack[];
}

export function parseMidiFile(buf: ArrayBuffer): ParsedMidi {
  const v = new DataView(buf);
  let p = 0;
  const str = (n: number) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const x = v.getUint32(p); p += 4; return x; };
  const u16 = () => { const x = v.getUint16(p); p += 2; return x; };
  const vlq = (end: number) => { let x = 0; for (let i = 0; i < 4 && p < end; i++) { const b = v.getUint8(p++); x = (x << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return x; };

  if (buf.byteLength < 14 || str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = u32();
  const hstart = p;
  u16(); // format
  const ntrks = u16();
  const division = u16();
  p = hstart + hlen;
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  const tpq = division || 480;
  let bpm: number | null = null;
  const tracks: ParsedMidiTrack[] = [];

  for (let t = 0; t < ntrks && p + 8 <= buf.byteLength; t++) {
    const id = str(4);
    const len = u32();
    const end = Math.min(buf.byteLength, p + len);
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0;
    let status = 0;
    let name = `Track ${t + 1}`;
    const open = new Map<number, { tick: number; vel: number }>();
    const notes: ParsedMidiTrack['notes'] = [];
    let drumHits = 0;
    while (p < end) {
      tick += vlq(end);
      let b = v.getUint8(p);
      if (b & 0x80) { status = b; p++; } else b = status;
      const type = status & 0xf0;
      const ch = status & 0x0f;
      if (status === 0xff) {
        const meta = v.getUint8(p++);
        const mlen = vlq(end);
        if (meta === 0x03 && mlen) { name = ''; for (let i = 0; i < mlen; i++) name += String.fromCharCode(v.getUint8(p + i)); name = name.trim() || `Track ${t + 1}`; }
        if (meta === 0x51 && mlen === 3 && bpm === null) {
          const us = (v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2);
          if (us > 0) bpm = Math.round((60000000 / us) * 100) / 100;
        }
        p += mlen;
        if (meta === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { const l = vlq(end); p += l; continue; }
      if (type === 0x90 || type === 0x80) {
        const pitch = v.getUint8(p++);
        const vel = v.getUint8(p++);
        const key = ch * 128 + pitch;
        if (type === 0x90 && vel > 0) {
          if (open.has(key)) {
            const o = open.get(key)!;
            notes.push({ pitch, velocity: o.vel, startBeat: o.tick / tpq, lengthBeats: Math.max(1 / 64, (tick - o.tick) / tpq), channel: ch });
          }
          open.set(key, { tick, vel });
          if (ch === 9) drumHits++;
        } else if (open.has(key)) {
          const o = open.get(key)!;
          open.delete(key);
          notes.push({ pitch, velocity: o.vel, startBeat: o.tick / tpq, lengthBeats: Math.max(1 / 64, (tick - o.tick) / tpq), channel: ch });
        }
        continue;
      }
      if (type === 0xc0 || type === 0xd0) { p += 1; continue; }
      p += 2; // 0xA0, 0xB0, 0xE0
    }
    for (const [key, o] of open) notes.push({ pitch: key % 128, velocity: o.vel, startBeat: o.tick / tpq, lengthBeats: Math.max(0.25, (tick - o.tick) / tpq), channel: Math.floor(key / 128) });
    p = end;
    if (notes.length) tracks.push({ name, notes: notes.sort((a, b) => a.startBeat - b.startBeat), isDrums: drumHits > notes.length / 2 });
  }
  return { bpm, tracks };
}

/** Format 0 MIDI file. Notes are in beats at `bpm`. */
export function encodeMidiFile(notes: Array<{ pitch: number; velocity: number; startBeat: number; lengthBeats: number; channel?: number }>, bpm = 120, tpq = 480): Uint8Array {
  const events: Array<{ tick: number; data: number[] }> = [];
  const us = Math.max(1, Math.round(60000000 / Math.max(1, bpm)));
  events.push({ tick: 0, data: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] });
  for (const note of notes) {
    const on = Math.max(0, Math.round(note.startBeat * tpq));
    const off = Math.max(on + 1, Math.round((note.startBeat + Math.max(1 / 64, note.lengthBeats)) * tpq));
    const ch = (note.channel || 0) & 0x0f;
    events.push({ tick: on, data: [0x90 | ch, note.pitch & 0x7f, Math.max(1, Math.min(127, note.velocity || 100))] });
    events.push({ tick: off, data: [0x80 | ch, note.pitch & 0x7f, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
  const body: number[] = [];
  let last = 0;
  const vlq = (n: number) => {
    let value = Math.max(0, n);
    const bytes = [value & 0x7f];
    value >>= 7;
    while (value > 0) {
      bytes.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    return bytes;
  };
  for (const ev of events) {
    body.push(...vlq(ev.tick - last), ...ev.data);
    last = ev.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpq >> 8) & 0xff, tpq & 0xff];
  const track = [0x4d, 0x54, 0x72, 0x6b, (body.length >> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff, ...body];
  return Uint8Array.from([...header, ...track]);
}
