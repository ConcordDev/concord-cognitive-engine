/** Parse one Web MIDI channel message. Sustain is CC 64. */

export interface MidiNoteMessage {
  kind: 'on' | 'off';
  pitch: number;
  velocity: number;
  channel: number;
}

export function noteFromMidi(data: ArrayLike<number>): MidiNoteMessage | null {
  if (data.length < 3) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const pitch = data[1] & 0x7f;
  const velocity = data[2] & 0x7f;
  if (status === 0x90 && velocity > 0) return { kind: 'on', pitch, velocity, channel };
  if (status === 0x80 || (status === 0x90 && velocity === 0)) return { kind: 'off', pitch, velocity, channel };
  return null;
}

/** True when the sustain pedal is down, false when it is up, null for every other message. */
export function sustainFromMidi(data: ArrayLike<number>): boolean | null {
  if (data.length < 3 || (data[0] & 0xf0) !== 0xb0 || data[1] !== 64) return null;
  return data[2] >= 64;
}
