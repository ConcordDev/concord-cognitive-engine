/** Real StudioTransport: lens actions for projects/versions, REST for audio files. */

import { api, lensRun } from '@/lib/api/client';
import type { DAWProject } from './types';
import { toServerDaw, UPLOAD_CHUNK_BYTES, type ProjectRecord, type StudioTransport, type VersionMeta } from './persistence';
import { putAudio, getAudio, putJournal, getJournal, deleteJournal } from './audio-store';
import type { LocalStore } from './persistence';

async function run<T>(action: string, input: Record<string, unknown>): Promise<T> {
  const r = await lensRun<T>('studio', action, input);
  if (!r.data.ok || r.data.result == null) throw new Error(r.data.error || `studio.${action} failed`);
  return r.data.result;
}

function meta(p: DAWProject) {
  return { name: p.title.slice(0, 80) || 'Untitled Song', bpm: p.bpm, key: p.key, scale: p.scale, genre: p.genre, timeSignature: p.timeSignature };
}

export const studioTransport: StudioTransport = {
  async create(p) {
    const r = await run<{ project: ProjectRecord }>('project-create', { ...meta(p), daw: toServerDaw(p) });
    return r.project;
  },
  async save(p, baseRev) {
    const r = await run<{ project: ProjectRecord }>('project-save', { id: p.id, ...meta(p), daw: { ...toServerDaw(p), id: p.id }, baseRev });
    return r.project;
  },
  async get(id) {
    try {
      const r = await run<{ project: ProjectRecord }>('project-get', { id });
      return r.project;
    } catch (e) {
      if (/not found/i.test(String((e as Error).message))) return null;
      throw e;
    }
  },
  async list() {
    const r = await run<{ projects: ProjectRecord[] }>('project-list', {});
    return r.projects || [];
  },
  async versions(id) {
    const r = await run<{ versions: VersionMeta[] }>('project-versions', { id });
    return r.versions || [];
  },
  async snapshot(id, label) {
    const r = await run<{ version: VersionMeta }>('project-snapshot', { id, label });
    return r.version || null;
  },
  async restore(id, versionId) {
    const r = await run<{ project: ProjectRecord }>('project-version-restore', { id, versionId });
    return r.project || null;
  },
  async uploadAudio(projectId, assetId, bytes, onProgress) {
    const total = bytes.byteLength;
    for (let off = 0; off < total; off += UPLOAD_CHUNK_BYTES) {
      const chunk = bytes.subarray(off, Math.min(total, off + UPLOAD_CHUNK_BYTES));
      await api.put(`/api/studio/audio/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`, chunk, {
        params: { offset: off, total },
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: 120000,
        transformRequest: [(d) => d],
      });
      onProgress?.(Math.min(1, (off + chunk.byteLength) / total));
    }
  },
  async downloadAudio(projectId, assetId) {
    try {
      const r = await api.get(`/api/studio/audio/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`, { responseType: 'arraybuffer', timeout: 120000 });
      return r.data as ArrayBuffer;
    } catch {
      return null;
    }
  },
};

export const browserLocalStore: LocalStore = { putAudio, getAudio, putJournal, getJournal, deleteJournal };

export interface LibraryItem {
  id: string;
  title: string;
  kind: string;
  bpm: number | null;
  key: string | null;
  url: string | null;
}

export async function browseMusicLibrary(kind?: string, q?: string): Promise<LibraryItem[]> {
  try {
    const r = await run<{ items: LibraryItem[] }>('library-browse', { kind, q, limit: 100 });
    return r.items || [];
  } catch {
    return [];
  }
}
