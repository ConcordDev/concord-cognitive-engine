import { describe, it, expect } from 'vitest';
import { buildTemplate, STUDIO_TEMPLATES } from '@/lib/daw/templates';
import { normalizeProject, snapshotForSave, snapshotHash, createTrack, createAudioClip, assetMeta } from '@/lib/daw/project';
import { Autosaver, loadProject, resolveAudio, toServerDaw, type StudioTransport, type LocalStore, type ProjectRecord } from '@/lib/daw/persistence';
import { createHistory, pushHistory, undo, redo, canUndo } from '@/lib/daw/history';
import { decodeWav } from '@/lib/daw/wav';
import { planAutoMix, inferRole, TARGET_RMS_DBFS } from '@/lib/daw/automix';
import { parseMidiFile } from '@/lib/daw/midi-file';
import type { DAWProject } from '@/lib/daw/types';

/** In-memory server that behaves like domains/studio.js (sanitize = JSON round-trip, audioBuffers cleared). */
function fakeServer() {
  const projects = new Map<string, ProjectRecord & { rev: number }>();
  const files = new Map<string, Uint8Array>();
  let n = 0;
  const sanitize = (d: unknown) => ({ ...JSON.parse(JSON.stringify(d)), audioBuffers: {} });
  const t: StudioTransport = {
    async create(p) { const id = `proj_${++n}`; const r = { id, name: p.title, updatedAt: new Date().toISOString(), rev: 1, daw: sanitize(toServerDaw(p)) }; projects.set(id, r); return { ...r, daw: undefined }; },
    async save(p) { const r = projects.get(p.id)!; r.daw = sanitize(toServerDaw(p)); r.rev += 1; r.updatedAt = new Date(Date.now() + 1).toISOString(); return { ...r, daw: undefined }; },
    async get(id) { const r = projects.get(id); return r ? JSON.parse(JSON.stringify(r)) : null; },
    async list() { return [...projects.values()]; },
    async versions() { return []; },
    async snapshot() { return null; },
    async restore() { return null; },
    async uploadAudio(pid, aid, bytes) { files.set(`${pid}/${aid}`, bytes.slice()); },
    async downloadAudio(pid, aid) { const b = files.get(`${pid}/${aid}`); return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer : null; },
  };
  return { t, projects, files };
}

function memLocal(): LocalStore & { audio: Map<string, { sampleRate: number; channelData: Float32Array[] }>; journal: Map<string, unknown> } {
  const audio = new Map<string, { sampleRate: number; channelData: Float32Array[] }>();
  const journal = new Map<string, unknown>();
  return {
    audio, journal,
    async putAudio(a) { audio.set(a.id, { sampleRate: a.sampleRate, channelData: a.channelData }); },
    async getAudio(id) { return audio.get(id); },
    async putJournal(e) { journal.set(e.key, JSON.parse(JSON.stringify(e))); },
    async getJournal(k) { return journal.get(k) as never; },
    async deleteJournal(k) { journal.delete(k); },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('save → reload → load round-trip', () => {
  it('every template round-trips identically through the server snapshot', async () => {
    for (const tpl of STUDIO_TEMPLATES) {
      const p = tpl.build();
      const srv = fakeServer();
      const rec = await srv.t.create(p);
      const loaded = await loadProject(rec.id, srv.t, memLocal());
      expect(loaded).not.toBeNull();
      expect(snapshotForSave({ ...loaded!.project, id: p.id })).toEqual(snapshotForSave(p));
    }
  });

  it('autosave creates, saves edits, uploads takes, and a fresh device loads the same project with audio', async () => {
    const srv = fakeServer();
    const local = memLocal();
    let project: DAWProject = buildTemplate('vocal');
    const statuses: string[] = [];
    const saver = new Autosaver({
      transport: srv.t, local, debounceMs: 5, intervalMs: 60000,
      onStatus: (s) => statuses.push(s),
      onProjectId: (_o, id) => { project = { ...project, id }; },
      onAssetsUploaded: (ids) => {
        project = { ...project, audioAssets: Object.fromEntries(Object.entries(project.audioAssets || {}).map(([k, v]) => [k, ids.includes(k) ? { ...v, uploaded: true } : v])) };
        saver.update(project);
      },
    });
    // Record a take.
    const sr = 48000;
    const ch = new Float32Array(sr);
    for (let i = 0; i < sr; i++) ch[i] = Math.sin(i / 10) * 0.5;
    await local.putAudio({ id: 'take_1', projectId: project.id, name: 'Take 1', sampleRate: sr, channelData: [ch], createdAt: 0 });
    const vox = project.tracks.find((t) => t.armed)!;
    project = {
      ...project,
      audioAssets: { take_1: assetMeta('take_1', 'Take 1', [ch], sr) },
      tracks: project.tracks.map((t) => (t.id === vox.id ? { ...t, clips: [createAudioClip(t, 4, 2, 'take_1', 'Take 1')] } : t)),
    };
    saver.update(project);
    await saver.flush();
    await settle();
    await saver.flush();
    await settle();
    expect(project.id.startsWith('proj_')).toBe(true);
    expect(statuses).toContain('saving');
    expect(statuses[statuses.length - 1]).toBe('saved');
    expect(srv.files.has(`${project.id}/take_1`)).toBe(true);

    // "Another device": empty local store.
    const other = memLocal();
    const loaded = await loadProject(project.id, srv.t, other);
    expect(snapshotForSave(loaded!.project)).toEqual(snapshotForSave(project));
    const { audio, missing } = await resolveAudio(loaded!.project, srv.t, other);
    expect(missing).toEqual([]);
    const got = audio.get('take_1')!;
    expect(got.sampleRate).toBe(sr);
    expect(Array.from(got.channels[0].subarray(0, 100))).toEqual(Array.from(ch.subarray(0, 100)));
    saver.dispose();
  });

  it('recovers unsaved local edits after a crash (journal newer than server)', async () => {
    const srv = fakeServer();
    const local = memLocal();
    const p0 = buildTemplate('beat');
    const rec = await srv.t.create(p0);
    const saver = new Autosaver({ transport: { ...srv.t, save: () => new Promise(() => {}) }, local, debounceMs: 10000, intervalMs: 60000 });
    const base = (await loadProject(rec.id, srv.t, local))!;
    saver.prime(base.project, base.rev);
    const edited = { ...base.project, title: 'Edited offline', bpm: 150 };
    saver.update(edited);
    await new Promise((r) => setTimeout(r, 300)); // journal written, server save never completes ("crash")
    saver.dispose();
    const re = await loadProject(rec.id, srv.t, local);
    expect(re!.recovered).toBe(true);
    expect(re!.project.title).toBe('Edited offline');
    expect(re!.project.bpm).toBe(150);
  });

  it('normalizeProject never throws on junk and fills defaults', () => {
    for (const junk of [null, 42, 'x', { tracks: 'nope' }, { tracks: [{ clips: [{}] }] }]) {
      const p = normalizeProject(junk);
      expect(Array.isArray(p.tracks)).toBe(true);
      expect(p.bpm).toBeGreaterThan(0);
    }
  });

  it('snapshotHash ignores updatedAt but sees real edits', () => {
    const p = buildTemplate('demo');
    expect(snapshotHash({ ...p, updatedAt: 1 })).toBe(snapshotHash({ ...p, updatedAt: 2 }));
    expect(snapshotHash({ ...p, bpm: p.bpm + 1 })).not.toBe(snapshotHash(p));
  });

  it('decodeWav reads the float WAV the uploader writes', async () => {
    const { encodeWav } = await import('@/lib/daw/wav');
    const x = new Float32Array([0, 0.25, -0.5, 0.999]);
    const d = decodeWav(encodeWav([x, x], 44100, { bitDepth: 32 }));
    expect(Array.from(d.channels[1])).toEqual(Array.from(x));
  });
});

describe('undo / redo', () => {
  it('steps back and forward, coalescing drags', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2, { coalesceKey: 'drag', now: 0 });
    h = pushHistory(h, 3, { coalesceKey: 'drag', now: 100 });
    h = pushHistory(h, 4, { now: 5000 });
    expect(h.past).toEqual([1, 3]);
    h = undo(h); expect(h.present).toBe(3);
    h = undo(h); expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h); expect(h.present).toBe(3);
    h = pushHistory(h, 9);
    expect(h.future).toEqual([]);
  });
});

describe('auto mix plan', () => {
  it('gain-stages to -18 dBFS RMS, cleans up by role, ducks bass under kick, enables mastering', () => {
    const p = buildTemplate('demo');
    const meas = p.tracks.map((t, i) => ({ trackId: t.id, rmsDb: -30 + i * 4 }));
    const { project, notes } = planAutoMix(p, meas, { lufs: -14, ceilingDb: -1 });
    project.tracks.forEach((t, i) => {
      expect(t.trimDb).toBeCloseTo((p.tracks[i].trimDb || 0) + (TARGET_RMS_DBFS - meas[i].rmsDb), 1);
    });
    const bass = project.tracks.find((t) => inferRole(t) === 'bass')!;
    expect(bass.effectChain.some((e) => e.type === 'eq3' && Number(e.params.highPass) > 0)).toBe(false);
    expect(bass.duck?.sourceTrackId).toBe(project.tracks.find((t) => inferRole(t) === 'drums')!.id);
    const vocal = project.tracks.find((t) => inferRole(t) === 'vocal')!;
    expect(vocal.effectChain.find((e) => e.id === 'am-eq')?.params.highPass).toBe(90);
    expect(vocal.effectChain.some((e) => e.id === 'am-comp')).toBe(true);
    expect(project.masteringChain.enabled).toBe(true);
    expect(project.masteringChain.limiter.params.ceiling).toBe(-1);
    expect(project.masterBus.inserts[0].id).toBe('am-glue');
    expect(notes.length).toBeGreaterThan(3);
    // Re-running replaces (not stacks) the auto devices.
    const again = planAutoMix(project, meas, { lufs: -14, ceilingDb: -1 }).project;
    expect(again.tracks[0].effectChain.filter((e) => e.id === 'am-comp')).toHaveLength(1);
  });

  it('spreads doubled vocals and keeps the lead centred', () => {
    const p = buildTemplate('vocal');
    const { project } = planAutoMix(p, [], { lufs: -14, ceilingDb: -1 });
    const vox = project.tracks.filter((t) => inferRole(t) === 'vocal');
    expect(vox[0].pan).toBe(0);
    expect(Math.sign(vox[1].pan)).toBe(-Math.sign(vox[2].pan));
  });
});

describe('MIDI file import', () => {
  it('parses notes, tempo and track names', () => {
    const bytes: number[] = [];
    const s = (x: string) => [...x].forEach((c) => bytes.push(c.charCodeAt(0)));
    const u32 = (v: number) => bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
    s('MThd'); u32(6); bytes.push(0, 0, 0, 1, 0x01, 0xe0); // format 0, 1 track, 480 tpq
    const trk = [0x00, 0xff, 0x03, 4, ...[...'Keys'].map((c) => c.charCodeAt(0)), 0x00, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, // 120 bpm
      0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, // C4 for 480 ticks
      0x00, 0x90, 64, 90, 0x81, 0x70, 0x90, 64, 0, // E4 for 240 ticks (note-on vel 0)
      0x00, 0xff, 0x2f, 0x00];
    s('MTrk'); u32(trk.length); bytes.push(...trk);
    const m = parseMidiFile(new Uint8Array(bytes).buffer);
    expect(m.bpm).toBe(120);
    expect(m.tracks[0].name).toBe('Keys');
    expect(m.tracks[0].notes.map((n) => [n.pitch, n.startBeat, n.lengthBeats])).toEqual([[60, 0, 1], [64, 1, 0.5]]);
  });
});

describe('templates', () => {
  it('ships a demo plus music-only templates (no podcast)', () => {
    const ids = STUDIO_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['demo', 'beat', 'vocal', 'songwriter']));
    expect(STUDIO_TEMPLATES.some((t) => /podcast/i.test(t.name + t.description))).toBe(false);
    const demo = buildTemplate('demo');
    expect(demo.tracks.reduce((n, t) => n + t.clips.length, 0)).toBeGreaterThan(4);
    expect(createTrack('drums', 0).instrumentId).toBe('drums:808');
  });
});
