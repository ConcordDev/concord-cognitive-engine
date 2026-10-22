/**
 * Music-only filter for the Studio browser / import.
 * Accepts audio, MIDI, stems, samples, loops, presets and music DTUs; rejects
 * everything else (documents, code, images, generic DTUs).
 */

export type MusicItemKind = 'audio' | 'midi' | 'stem' | 'sample' | 'loop' | 'preset' | 'project' | 'music-dtu';

export const AUDIO_EXTENSIONS = ['wav', 'wave', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'caf'];
export const MIDI_EXTENSIONS = ['mid', 'midi', 'smf'];
export const PRESET_EXTENSIONS = ['cpreset', 'json'];

export interface MusicCandidate {
  name?: string | null;
  title?: string | null;
  mimeType?: string | null;
  type?: string | null;
  kind?: string | null;
  domain?: string | null;
  tags?: string[] | null;
  lens?: string | null;
}

const ext = (name: string) => {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
};

const MUSIC_WORDS = /\b(music|audio|song|beat|loop|stem|sample|drum|kit|preset|synth|vocal|melody|chord|midi|bass|instrument|track|mix|master|bpm)s?\b/i;
const MUSIC_KINDS = new Set(['music_dtu', 'audio_dtu', 'music', 'audio', 'stem', 'loop', 'sample', 'preset', 'synth_preset', 'drum_kit', 'midi', 'beat', 'song', 'studio_project']);
const MUSIC_DOMAINS = new Set(['studio', 'music', 'audio', 'beats', 'sound']);

/** Classify a file or library item; null means "not music, hide it". */
export function classifyMusicItem(c: MusicCandidate): MusicItemKind | null {
  const name = String(c.name || c.title || '');
  const e = ext(name);
  const mime = String(c.mimeType || '').toLowerCase();
  const kind = String(c.kind || c.type || '').toLowerCase();
  const tags = (c.tags || []).map((t) => String(t).toLowerCase());
  const has = (w: string) => tags.includes(w) || kind.includes(w) || name.toLowerCase().includes(w);

  if (MIDI_EXTENSIONS.includes(e) || mime === 'audio/midi' || mime === 'audio/x-midi' || kind === 'midi') return 'midi';
  if (AUDIO_EXTENSIONS.includes(e) || mime.startsWith('audio/')) {
    if (has('stem')) return 'stem';
    if (has('loop')) return 'loop';
    if (has('sample') || has('one-shot') || has('oneshot')) return 'sample';
    return 'audio';
  }
  if (e === 'cpreset' || kind === 'preset' || kind === 'synth_preset' || kind === 'drum_kit') return 'preset';
  if (kind === 'studio_project') return 'project';
  if (MUSIC_KINDS.has(kind)) {
    if (kind === 'stem') return 'stem';
    if (kind === 'loop') return 'loop';
    if (kind === 'sample') return 'sample';
    return 'music-dtu';
  }
  const domain = String(c.domain || c.lens || '').toLowerCase();
  if (MUSIC_DOMAINS.has(domain) && (MUSIC_WORDS.test(name) || tags.some((t) => MUSIC_WORDS.test(t)))) return 'music-dtu';
  if (tags.some((t) => MUSIC_KINDS.has(t))) return 'music-dtu';
  return null;
}

export const isMusicItem = (c: MusicCandidate) => classifyMusicItem(c) !== null;

/** `accept` attribute for the import file picker. */
export const MUSIC_FILE_ACCEPT = [
  'audio/*',
  ...AUDIO_EXTENSIONS.map((e) => `.${e}`),
  ...MIDI_EXTENSIONS.map((e) => `.${e}`),
  '.cpreset',
].join(',');
