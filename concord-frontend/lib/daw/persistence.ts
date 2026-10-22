/**
 * Studio persistence: server-side projects tied to the signed-in user, audio
 * files uploaded to the server (so takes follow you to any device), a local
 * crash-recovery journal, debounced autosave, and version snapshots.
 *
 * Transport is injectable so the save → reload → load round-trip is unit-tested.
 */

import type { DAWProject, AudioAssetMeta } from './types';
import { normalizeProject, snapshotForSave, snapshotHash } from './project';
import { encodeWav, decodeWav } from './wav';
import type { PcmAudio } from './render';

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'offline' | 'error';

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: string;
  rev?: number;
  daw?: unknown;
}

export interface VersionMeta {
  id: string;
  at: string;
  label: string;
  rev: number;
}

export interface StudioTransport {
  create(project: DAWProject): Promise<ProjectRecord>;
  save(project: DAWProject, baseRev: number): Promise<ProjectRecord>;
  get(id: string): Promise<ProjectRecord | null>;
  list(): Promise<ProjectRecord[]>;
  versions(id: string): Promise<VersionMeta[]>;
  snapshot(id: string, label: string): Promise<VersionMeta | null>;
  restore(id: string, versionId: string): Promise<ProjectRecord | null>;
  uploadAudio(projectId: string, assetId: string, bytes: Uint8Array, onProgress?: (f: number) => void): Promise<void>;
  downloadAudio(projectId: string, assetId: string): Promise<ArrayBuffer | null>;
}

export interface LocalStore {
  putAudio(a: { id: string; projectId: string; name: string; sampleRate: number; channelData: Float32Array[]; createdAt: number }): Promise<unknown>;
  getAudio(id: string): Promise<{ sampleRate: number; channelData: Float32Array[] } | undefined>;
  putJournal(e: { key: string; projectId: string; savedAt: number; hash: string; baseRev: number; project: unknown }): Promise<unknown>;
  getJournal(key: string): Promise<{ savedAt: number; hash: string; baseRev: number; project: unknown } | undefined>;
  deleteJournal(key: string): Promise<unknown>;
}

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024; // stays under proxy body limits

export function journalKey(projectId: string): string {
  return `project:${projectId}`;
}

/** Save → load must be identical; this is the exact transform both sides use. */
export function toServerDaw(p: DAWProject): DAWProject {
  return snapshotForSave(p);
}

export function fromServerRecord(rec: ProjectRecord): DAWProject {
  const p = normalizeProject(rec.daw, rec.name);
  return { ...p, id: rec.id, title: p.title || rec.name };
}

export interface AutosaveOptions {
  transport: StudioTransport;
  local: LocalStore;
  debounceMs?: number;
  intervalMs?: number;
  onStatus?: (s: SaveStatus, info?: { at?: number; error?: string }) => void;
  /** Called when the server assigns a real id (first save of a new project). */
  onProjectId?: (oldId: string, newId: string) => void;
  /** Called after audio uploads mark assets as uploaded. */
  onAssetsUploaded?: (ids: string[]) => void;
}

/**
 * Debounced autosave. `update()` on every edit writes the local journal
 * (≈immediately) and schedules a server save; a 30 s interval catches
 * anything missed. Saves are serialized; the newest state always wins.
 */
export class Autosaver {
  private o: Required<Pick<AutosaveOptions, 'debounceMs' | 'intervalMs'>> & AutosaveOptions;
  private latest: DAWProject | null = null;
  private savedHash = '';
  private rev = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private journalTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  private status: SaveStatus = 'idle';
  private uploading = new Set<string>();
  private disposed = false;

  constructor(opts: AutosaveOptions) {
    this.o = { debounceMs: 1500, intervalMs: 30000, ...opts };
    if (typeof setInterval !== 'undefined') this.interval = setInterval(() => { void this.flush(); }, this.o.intervalMs);
  }

  get currentStatus(): SaveStatus { return this.status; }
  get revision(): number { return this.rev; }

  /** Seed with the state just loaded from the server (not dirty). */
  prime(p: DAWProject, rev: number): void {
    this.latest = p;
    this.rev = rev || 0;
    this.savedHash = snapshotHash(p);
    this.setStatus('saved');
  }

  update(p: DAWProject): void {
    if (this.disposed) return;
    this.latest = p;
    const h = snapshotHash(p);
    if (h === this.savedHash) return;
    this.setStatus('unsaved');
    if (this.journalTimer) clearTimeout(this.journalTimer);
    this.journalTimer = setTimeout(() => { void this.writeJournal(); }, 250);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.o.debounceMs);
  }

  private async writeJournal(): Promise<void> {
    const p = this.latest;
    if (!p) return;
    try {
      await this.o.local.putJournal({ key: journalKey(p.id), projectId: p.id, savedAt: Date.now(), hash: snapshotHash(p), baseRev: this.rev, project: toServerDaw(p) });
    } catch { /* storage full / private mode: server save still runs */ }
  }

  /** Save now (awaits any save already running, then saves the newest state). */
  async flush(): Promise<void> {
    if (this.inflight) { await this.inflight; }
    const p = this.latest;
    if (!p || this.disposed) return;
    const hash = snapshotHash(p);
    if (hash === this.savedHash && !p.id.startsWith('local_')) return;
    this.inflight = this.doSave(p, hash).finally(() => { this.inflight = null; });
    await this.inflight;
  }

  private async doSave(p: DAWProject, hash: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.setStatus('offline'); await this.writeJournal(); return; }
    this.setStatus('saving');
    try {
      let rec: ProjectRecord;
      if (p.id.startsWith('local_')) {
        rec = await this.o.transport.create(p);
        const oldId = p.id;
        const moved = { ...p, id: rec.id };
        if (this.latest && this.latest.id === oldId) this.latest = { ...this.latest, id: rec.id };
        try { await this.o.local.deleteJournal(journalKey(oldId)); } catch { /* noop */ }
        this.o.onProjectId?.(oldId, rec.id);
        this.rev = rec.rev || 1;
        this.savedHash = snapshotHash(moved);
      } else {
        rec = await this.o.transport.save(p, this.rev);
        this.rev = rec.rev || this.rev + 1;
        this.savedHash = hash;
      }
      const id = rec.id;
      try { await this.o.local.putJournal({ key: journalKey(id), projectId: id, savedAt: Date.now(), hash: this.savedHash, baseRev: this.rev, project: toServerDaw(this.latest || p) }); } catch { /* noop */ }
      const dirty = this.latest ? snapshotHash(this.latest) !== this.savedHash : false;
      this.setStatus(dirty ? 'unsaved' : 'saved', { at: Date.now() });
      void this.uploadPending(id, (this.latest || p).audioAssets || {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus(/network|offline|failed to fetch/i.test(msg) ? 'offline' : 'error', { error: msg });
      await this.writeJournal();
    }
  }

  private async uploadPending(projectId: string, assets: Record<string, AudioAssetMeta>): Promise<void> {
    const pending = Object.values(assets).filter((a) => !a.uploaded && !this.uploading.has(a.id));
    if (!pending.length) return;
    const done: string[] = [];
    for (const a of pending) {
      this.uploading.add(a.id);
      try {
        const stored = await this.o.local.getAudio(a.id);
        if (!stored) continue;
        const bytes = new Uint8Array(encodeWav(stored.channelData, stored.sampleRate, { bitDepth: 32 }));
        await this.o.transport.uploadAudio(projectId, a.id, bytes);
        done.push(a.id);
      } catch {
        // retried on the next save
      } finally {
        this.uploading.delete(a.id);
      }
    }
    if (done.length) this.o.onAssetsUploaded?.(done);
  }

  private setStatus(s: SaveStatus, info?: { at?: number; error?: string }) {
    this.status = s;
    this.o.onStatus?.(s, info);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.journalTimer) clearTimeout(this.journalTimer);
    if (this.interval) clearInterval(this.interval);
  }
}

export interface LoadedProject {
  project: DAWProject;
  rev: number;
  /** True when a newer unsaved local journal replaced the server copy. */
  recovered: boolean;
}

/** Open a project: server copy, unless this device holds newer unsaved edits. */
export async function loadProject(id: string, transport: StudioTransport, local: LocalStore): Promise<LoadedProject | null> {
  let rec: ProjectRecord | null = null;
  try { rec = await transport.get(id); } catch { rec = null; }
  let journal: Awaited<ReturnType<LocalStore['getJournal']>>;
  try { journal = await local.getJournal(journalKey(id)); } catch { journal = undefined; }
  if (!rec && !journal) return null;
  const server = rec ? fromServerRecord(rec) : null;
  const serverRev = rec?.rev || 0;
  if (journal && (!server || (journal.hash !== snapshotHash(server) && journal.baseRev >= serverRev && journal.savedAt > Date.parse(rec?.updatedAt || '0')))) {
    const p = normalizeProject(journal.project, server?.title || 'Recovered Song');
    return { project: { ...p, id }, rev: serverRev, recovered: !!server };
  }
  return server ? { project: server, rev: serverRev, recovered: false } : null;
}

/** Make sure every asset's samples are available locally (IndexedDB first, then the server file). */
export async function resolveAudio(project: DAWProject, transport: StudioTransport, local: LocalStore): Promise<{ audio: Map<string, PcmAudio>; missing: string[] }> {
  const audio = new Map<string, PcmAudio>();
  const missing: string[] = [];
  for (const a of Object.values(project.audioAssets || {})) {
    try {
      const s = await local.getAudio(a.id);
      if (s) { audio.set(a.id, { channels: s.channelData, sampleRate: s.sampleRate }); continue; }
    } catch { /* fall through */ }
    try {
      const buf = await transport.downloadAudio(project.id, a.id);
      if (buf) {
        const d = decodeWav(buf);
        audio.set(a.id, d);
        try { await local.putAudio({ id: a.id, projectId: project.id, name: a.name, sampleRate: d.sampleRate, channelData: d.channels, createdAt: Date.now() }); } catch { /* cache only */ }
        continue;
      }
    } catch { /* missing */ }
    missing.push(a.id);
  }
  return { audio, missing };
}
