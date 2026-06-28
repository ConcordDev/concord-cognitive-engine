// server/domains/studio.js
//
// Content-engine bridge: publish-as-adaptive-music takes a studio
// project (tracks + clips + effects) + a client-bounced reference
// stem (audio bytes), persists both to the substrate, and makes the
// combined manifest available to the frontend AdaptiveMusicBridge as
// a per-region adaptive-music DTU. Per CLAUDE.md "music DTU → soundscape"
// pattern, but for a richer manifest than a single stem.

import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

const ADAPTIVE_REGIONS = new Set([
  "tavern", "archive", "forge", "market", "tower",
  "plaza", "wilderness", "arena", "underground",
]);
const ADAPTIVE_INTENSITIES = new Set(["ambient", "active", "battle"]);
const STUDIO_AUDIO_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

const STUDIO_DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync("/workspace/concord-data") ? "/workspace/concord-data" : path.join(process.cwd(), "data"));
const STUDIO_LENS_ROOT = path.join(STUDIO_DATA_DIR, "lens-assets", "adaptive-music");

function decodeStudioAudioDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:audio\/(wav|mpeg|mp3|ogg|flac);base64,(.+)$/);
  if (!m) return null;
  const sub = m[1] === "mp3" ? "mpeg" : m[1];
  const mimeType = `audio/${sub}`;
  const ext = m[1] === "mpeg" ? "mp3" : m[1] === "mp3" ? "mp3" : m[1];
  try {
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length || buf.length > STUDIO_AUDIO_MAX_BYTES) return null;
    return { buf, mimeType, ext };
  } catch {
    return null;
  }
}

function ensureRouteArtifactsTableStudio(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_artifacts (
      artifact_id  TEXT PRIMARY KEY,
      dtu_id       TEXT,
      name         TEXT NOT NULL,
      mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes   INTEGER NOT NULL DEFAULT 0,
      storage_mode TEXT NOT NULL DEFAULT 'inline',
      content_b64  TEXT,
      storage_path TEXT,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      description  TEXT NOT NULL DEFAULT '',
      tags         TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_route_artifacts_dtu ON route_artifacts (dtu_id);
    CREATE INDEX IF NOT EXISTS idx_route_artifacts_creator ON route_artifacts (created_by, created_at DESC);
  `);
}

// Persist a client-rendered audio buffer (decoded from a data: URL) into
// route_artifacts so /api/artifacts/:id/download serves the REAL bytes. Inline
// base64 ≤1 MB, else written to disk. Returns the artifact descriptor; throws on
// write/DB failure (caller catches and reports an honest failure). This is the
// shared producer for `bounce` + `export-stems` — neither fabricates a URL.
async function persistStudioRenderArtifact(db, { decoded, userId, fileName, description, tags }) {
  ensureRouteArtifactsTableStudio(db);
  const artifactId = crypto.randomUUID();
  const dtuId = `dtu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const inline = decoded.buf.length <= 1024 * 1024;
  const contentB64 = inline ? decoded.buf.toString("base64") : null;
  let storagePath = null;
  if (!inline) {
    const dir = path.join(STUDIO_DATA_DIR, "lens-assets", "studio-renders", userId);
    await fsp.mkdir(dir, { recursive: true });
    storagePath = path.join(dir, fileName);
    await fsp.writeFile(storagePath, decoded.buf);
  }
  db.prepare(`
    INSERT INTO route_artifacts (
      artifact_id, dtu_id, name, mime_type, size_bytes,
      storage_mode, content_b64, storage_path, created_by, description, tags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    artifactId, dtuId, fileName, decoded.mimeType, decoded.buf.length,
    inline ? "inline" : "disk", contentB64, storagePath, userId,
    description || "Studio render", JSON.stringify(tags || []),
  );
  return { artifactId, sizeBytes: decoded.buf.length, mimeType: decoded.mimeType, downloadUrl: `/api/artifacts/${artifactId}/download` };
}

export default function registerStudioActions(registerLensAction) {
  registerLensAction("studio", "projectTimeline", (ctx, artifact, _params) => {
    const tasks = artifact.data?.tasks || [];
    if (tasks.length === 0) return { ok: true, result: { message: "Add tasks with start/end dates and dependencies to build a timeline." } };
    const processed = tasks.map((t, i) => {
      const start = new Date(t.start || t.startDate || Date.now());
      const end = new Date(t.end || t.endDate || start.getTime() + 7 * 86400000);
      const duration = Math.ceil((end.getTime() - start.getTime()) / 86400000);
      return { id: t.id || `task-${i}`, name: t.name || t.title || `Task ${i + 1}`, start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0], duration, dependencies: t.dependencies || t.deps || [], status: t.status || "pending" };
    });
    // Critical path: longest chain through dependencies
    const taskMap = Object.fromEntries(processed.map(t => [t.id, t]));
    const getChainLength = (taskId, visited = new Set()) => {
      if (visited.has(taskId)) return 0;
      visited.add(taskId);
      const task = taskMap[taskId];
      if (!task) return 0;
      const depLengths = (task.dependencies || []).map(d => getChainLength(d, new Set(visited)));
      return task.duration + Math.max(0, ...depLengths);
    };
    const criticalPaths = processed.map(t => ({ id: t.id, totalDuration: getChainLength(t.id) })).sort((a, b) => b.totalDuration - a.totalDuration);
    const projectStart = new Date(Math.min(...processed.map(t => new Date(t.start).getTime())));
    const projectEnd = new Date(Math.max(...processed.map(t => new Date(t.end).getTime())));
    const totalDays = Math.ceil((projectEnd.getTime() - projectStart.getTime()) / 86400000);
    const completed = processed.filter(t => t.status === "completed" || t.status === "done").length;
    return { ok: true, result: { totalTasks: processed.length, completed, inProgress: processed.filter(t => t.status === "in-progress" || t.status === "active").length, pending: processed.filter(t => t.status === "pending").length, projectStart: projectStart.toISOString().split("T")[0], projectEnd: projectEnd.toISOString().split("T")[0], totalDays, completionRate: Math.round((completed / processed.length) * 100), criticalPath: criticalPaths[0], tasks: processed } };
  });

  registerLensAction("studio", "assetTracker", (ctx, artifact, _params) => {
    const assets = artifact.data?.assets || [];
    if (assets.length === 0) return { ok: true, result: { message: "Add digital assets to track." } };
    const byType = {};
    let totalSize = 0;
    const orphaned = [];
    assets.forEach(a => {
      const type = a.type || a.format || (a.name || "").split(".").pop() || "unknown";
      if (!byType[type]) byType[type] = { count: 0, totalSize: 0 };
      byType[type].count++;
      const size = parseFloat(a.size || a.fileSize) || 0;
      byType[type].totalSize += size;
      totalSize += size;
      if (a.references === 0 || a.orphaned) orphaned.push({ name: a.name, type, size });
    });
    const typeBreakdown = Object.entries(byType).map(([type, data]) => ({
      type, count: data.count, totalSizeMB: Math.round(data.totalSize / 1024 / 1024 * 100) / 100 || Math.round(data.totalSize * 100) / 100, percentage: Math.round((data.count / assets.length) * 100),
    })).sort((a, b) => b.count - a.count);
    return { ok: true, result: { totalAssets: assets.length, totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100 || Math.round(totalSize * 100) / 100, typeBreakdown, orphanedAssets: orphaned.length, orphaned: orphaned.slice(0, 20), duplicateCandidates: assets.filter((a, i) => assets.findIndex(b => b.name === a.name) !== i).map(a => a.name) } };
  });

  registerLensAction("studio", "renderEstimate", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const width = parseInt(data.width || data.resolutionX) || 1920;
    const height = parseInt(data.height || data.resolutionY) || 1080;
    const frames = parseInt(data.frames || data.frameCount) || 1;
    const complexity = parseFloat(data.complexity) || 1.0;
    const fps = parseInt(data.fps) || 24;
    const samples = parseInt(data.samples || data.sampleCount) || 128;
    const pixelCount = width * height;
    const baseTimePerFrame = (pixelCount / 1000000) * (samples / 128) * complexity * 2;
    const totalSeconds = baseTimePerFrame * frames;
    const totalMinutes = Math.round(totalSeconds / 60);
    const totalHours = Math.round(totalSeconds / 3600 * 10) / 10;
    const duration = frames / fps;
    return { ok: true, result: { resolution: `${width}x${height}`, frames, fps, duration: `${Math.round(duration * 100) / 100}s`, samples, complexity, estimatedPerFrame: `${Math.round(baseTimePerFrame * 10) / 10}s`, estimatedTotal: totalMinutes < 60 ? `${totalMinutes} min` : `${totalHours} hours`, estimatedTotalSeconds: Math.round(totalSeconds), recommendations: [ width > 3840 ? "Consider rendering at lower resolution first for previews" : null, samples > 256 ? "High sample count — consider progressive rendering" : null, frames > 1000 ? "Long render — consider distributed rendering" : null, complexity > 2 ? "High complexity — optimize geometry and materials" : null ].filter(Boolean) } };
  });

  registerLensAction("studio", "versionCompare", (ctx, artifact, _params) => {
    const v1 = artifact.data?.v1 || artifact.data?.version1 || {};
    const v2 = artifact.data?.v2 || artifact.data?.version2 || {};
    if (Object.keys(v1).length === 0 || Object.keys(v2).length === 0) return { ok: true, result: { message: "Provide v1 and v2 project versions to compare." } };
    const v1Assets = v1.assets || [];
    const v2Assets = v2.assets || [];
    const v1Names = new Set(v1Assets.map(a => a.name || a.id));
    const v2Names = new Set(v2Assets.map(a => a.name || a.id));
    const added = v2Assets.filter(a => !v1Names.has(a.name || a.id));
    const removed = v1Assets.filter(a => !v2Names.has(a.name || a.id));
    const modified = v2Assets.filter(a => {
      const original = v1Assets.find(o => (o.name || o.id) === (a.name || a.id));
      return original && (original.size !== a.size || original.hash !== a.hash || original.modified !== a.modified);
    });
    const v1Size = v1Assets.reduce((s, a) => s + (parseFloat(a.size) || 0), 0);
    const v2Size = v2Assets.reduce((s, a) => s + (parseFloat(a.size) || 0), 0);
    return { ok: true, result: { v1: { name: v1.name || "v1", assetCount: v1Assets.length, totalSize: v1Size }, v2: { name: v2.name || "v2", assetCount: v2Assets.length, totalSize: v2Size }, diff: { added: added.length, removed: removed.length, modified: modified.length, unchanged: v2Assets.length - added.length - modified.length, sizeDelta: v2Size - v1Size }, addedAssets: added.map(a => a.name || a.id).slice(0, 20), removedAssets: removed.map(a => a.name || a.id).slice(0, 20), modifiedAssets: modified.map(a => a.name || a.id).slice(0, 20) } };
  });

  // ─── 2026 parity — Ableton/FL/Logic/Bitwig project state substrate ──
  //
  // Web Audio engine itself lives in the frontend; backend persists projects,
  // tracks, clips, transport, and effects-chain config. Per-user.

  function getStudioState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.studioLens) {
      STATE.studioLens = {
        projects: new Map(), // userId -> Map<id, project>
      };
    }
    return STATE.studioLens;
  }
  function saveStudioState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function studioActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextStudioId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoStudio() { return new Date().toISOString(); }

  // ── Projects CRUD ──

  registerLensAction("studio", "project-list", (ctx, _artifact, _params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const map = s.projects.get(userId);
    if (!map) return { ok: true, result: { projects: [] } };
    const projects = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(({ tracks, ...meta }) => ({ ...meta, trackCount: tracks.length }));
    return { ok: true, result: { projects } };
  });

  registerLensAction("studio", "project-create", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long" };
    const bpm = Number(params.bpm) || 120;
    if (bpm < 30 || bpm > 300) return { ok: false, error: "bpm 30-300" };
    const project = {
      id: nextStudioId("proj"),
      name,
      bpm,
      timeSignature: String(params.timeSignature || "4/4"),
      masterVolume: 0.8,
      tracks: [],
      createdAt: nowIsoStudio(),
      updatedAt: nowIsoStudio(),
    };
    if (!s.projects.has(userId)) s.projects.set(userId, new Map());
    s.projects.get(userId).set(project.id, project);
    saveStudioState();
    return { ok: true, result: { project } };
  });

  registerLensAction("studio", "project-get", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const map = s.projects.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    return { ok: true, result: { project: map.get(id) } };
  });

  registerLensAction("studio", "project-delete", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const map = s.projects.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveStudioState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Tracks ──

  registerLensAction("studio", "track-add", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const project = s.projects.get(userId)?.get(projectId);
    if (!project) return { ok: false, error: "project not found" };
    const kind = ["audio", "midi", "drum", "synth", "sample"].includes(params.kind) ? params.kind : "audio";
    const name = String(params.name || `Track ${project.tracks.length + 1}`).slice(0, 60);
    const track = {
      id: nextStudioId("trk"),
      name, kind,
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      sends: [],
      effects: [],
      clips: [],
    };
    project.tracks.push(track);
    project.updatedAt = nowIsoStudio();
    saveStudioState();
    return { ok: true, result: { track } };
  });

  registerLensAction("studio", "track-update", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const trackId = String(params.trackId || "");
    const project = s.projects.get(userId)?.get(projectId);
    if (!project) return { ok: false, error: "project not found" };
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track) return { ok: false, error: "track not found" };
    if (typeof params.volume === "number") {
      if (params.volume < 0 || params.volume > 1) return { ok: false, error: "volume 0..1" };
      track.volume = params.volume;
    }
    if (typeof params.pan === "number") {
      if (params.pan < -1 || params.pan > 1) return { ok: false, error: "pan -1..1" };
      track.pan = params.pan;
    }
    if (typeof params.muted === "boolean") track.muted = params.muted;
    if (typeof params.solo === "boolean") track.solo = params.solo;
    if (typeof params.name === "string") track.name = params.name.slice(0, 60);
    project.updatedAt = nowIsoStudio();
    saveStudioState();
    return { ok: true, result: { track } };
  });

  registerLensAction("studio", "track-delete", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const trackId = String(params.trackId || "");
    const project = s.projects.get(userId)?.get(projectId);
    if (!project) return { ok: false, error: "project not found" };
    const idx = project.tracks.findIndex((t) => t.id === trackId);
    if (idx < 0) return { ok: false, error: "track not found" };
    project.tracks.splice(idx, 1);
    project.updatedAt = nowIsoStudio();
    saveStudioState();
    return { ok: true, result: { deleted: trackId } };
  });

  // ── Effects (per-track insert chain) ──

  registerLensAction("studio", "effect-add", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const project = s.projects.get(userId)?.get(String(params.projectId || ""));
    if (!project) return { ok: false, error: "project not found" };
    const track = project.tracks.find((t) => t.id === String(params.trackId || ""));
    if (!track) return { ok: false, error: "track not found" };
    const kind = ["delay", "reverb", "eq3", "compressor", "distortion"].includes(params.kind) ? params.kind : null;
    if (!kind) return { ok: false, error: "kind must be delay | reverb | eq3 | compressor | distortion" };
    const DEFAULTS = {
      delay: { timeMs: 250, feedback: 0.4, mix: 0.3 },
      reverb: { roomSize: 0.5, decay: 1.5, mix: 0.3 },
      eq3: { lowGainDb: 0, midGainDb: 0, highGainDb: 0 },
      compressor: { thresholdDb: -24, ratio: 4, attack: 0.003, release: 0.25 },
      distortion: { amount: 0.4, mix: 0.5 },
    };
    const effect = {
      id: nextStudioId("fx"),
      kind,
      params: { ...DEFAULTS[kind], ...(params.params || {}) },
      bypassed: false,
    };
    track.effects.push(effect);
    project.updatedAt = nowIsoStudio();
    saveStudioState();
    return { ok: true, result: { effect } };
  });

  registerLensAction("studio", "effect-remove", (ctx, _artifact, params = {}) => {
    const s = getStudioState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const project = s.projects.get(userId)?.get(String(params.projectId || ""));
    if (!project) return { ok: false, error: "project not found" };
    const track = project.tracks.find((t) => t.id === String(params.trackId || ""));
    if (!track) return { ok: false, error: "track not found" };
    const idx = track.effects.findIndex((e) => e.id === String(params.effectId || ""));
    if (idx < 0) return { ok: false, error: "effect not found" };
    track.effects.splice(idx, 1);
    project.updatedAt = nowIsoStudio();
    saveStudioState();
    return { ok: true, result: { deleted: params.effectId } };
  });

  // ─── Full-app parity: Logic Pro + Ableton Live 12 + Pro Tools ──────

  function uidStu(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function ensureStuBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }
  function findTrack(state, userId, projectId, trackId) {
    const project = state.projects.get(userId)?.get(projectId);
    if (!project) return null;
    return project.tracks.find(t => t.id === trackId) || null;
  }

  // ── Clips (regions on the timeline) ───────────────────────────

  registerLensAction("studio", "clips-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const trackId = params.trackId ? String(params.trackId) : null;
    const all = ensureStuBucket(s, "clips", userId);
    const clips = all.filter(c => c.projectId === projectId && (!trackId || c.trackId === trackId));
    return { ok: true, result: { clips } };
  });

  registerLensAction("studio", "clips-create", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const trackId = String(params.trackId || "");
    const startBeats = Math.max(0, Number(params.startBeats) || 0);
    const lengthBeats = Math.max(0.0625, Number(params.lengthBeats) || 4);
    if (!projectId || !trackId) return { ok: false, error: "projectId and trackId required" };
    const track = findTrack(s, userId, projectId, trackId);
    if (!track) return { ok: false, error: "track not found" };
    const clip = {
      id: uidStu("clip"), projectId, trackId,
      name: String(params.name || "Clip"),
      kind: ["audio", "midi", "drum"].includes(params.kind) ? params.kind : (track.kind === "audio" ? "audio" : "midi"),
      startBeats, lengthBeats,
      audioUrl: params.audioUrl ? String(params.audioUrl) : null,
      sceneId: params.sceneId ? String(params.sceneId) : null,
      colour: String(params.colour || track.colour || "#22d3ee"),
      muted: false,
      loop: params.loop !== false,
      warpEnabled: params.warpEnabled === true,
      warpMarkers: [],
      tempoLeader: false,
      createdAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "clips", userId).push(clip);
    saveStudioState();
    return { ok: true, result: { clip } };
  });

  registerLensAction("studio", "clips-update", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const clip = ensureStuBucket(s, "clips", userId).find(c => c.id === id);
    if (!clip) return { ok: false, error: "clip not found" };
    if (params.name != null) clip.name = String(params.name);
    if (params.startBeats != null) clip.startBeats = Math.max(0, Number(params.startBeats));
    if (params.lengthBeats != null) clip.lengthBeats = Math.max(0.0625, Number(params.lengthBeats));
    if (params.muted != null) clip.muted = Boolean(params.muted);
    if (params.colour != null) clip.colour = String(params.colour);
    if (params.warpEnabled != null) clip.warpEnabled = Boolean(params.warpEnabled);
    saveStudioState();
    return { ok: true, result: { clip } };
  });

  registerLensAction("studio", "clips-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "clips", userId);
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { ok: false, error: "clip not found" };
    list.splice(idx, 1);
    // also remove its MIDI notes
    const notes = ensureStuBucket(s, "midiNotes", userId);
    for (let i = notes.length - 1; i >= 0; i--) if (notes[i].clipId === id) notes.splice(i, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── MIDI notes (Piano Roll) ───────────────────────────────────

  registerLensAction("studio", "midi-notes-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const clipId = String(params.clipId || "");
    if (!clipId) return { ok: false, error: "clipId required" };
    const all = ensureStuBucket(s, "midiNotes", userId);
    const notes = all.filter(n => n.clipId === clipId);
    return { ok: true, result: { notes } };
  });

  registerLensAction("studio", "midi-notes-add", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const clipId = String(params.clipId || "");
    const pitch = Math.max(0, Math.min(127, Number(params.pitch)));
    const velocity = Math.max(1, Math.min(127, Number(params.velocity) || 96));
    const startBeats = Math.max(0, Number(params.startBeats) || 0);
    const lengthBeats = Math.max(0.0625, Number(params.lengthBeats) || 0.25);
    if (!clipId || !Number.isFinite(pitch)) return { ok: false, error: "clipId and pitch 0-127 required" };
    const note = {
      id: uidStu("note"), clipId, pitch, velocity, startBeats, lengthBeats,
    };
    ensureStuBucket(s, "midiNotes", userId).push(note);
    saveStudioState();
    return { ok: true, result: { note } };
  });

  registerLensAction("studio", "midi-notes-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "midiNotes", userId);
    const idx = list.findIndex(n => n.id === id);
    if (idx < 0) return { ok: false, error: "note not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Automation lanes ──────────────────────────────────────────

  registerLensAction("studio", "automation-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const trackId = String(params.trackId || "");
    if (!trackId) return { ok: false, error: "trackId required" };
    const all = ensureStuBucket(s, "automation", userId);
    const lanes = all.filter(l => l.trackId === trackId);
    return { ok: true, result: { lanes } };
  });

  registerLensAction("studio", "automation-add-lane", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const trackId = String(params.trackId || "");
    const parameter = String(params.parameter || "").trim();
    if (!trackId || !parameter) return { ok: false, error: "trackId and parameter required" };
    const lane = {
      id: uidStu("auto"), trackId, parameter,
      points: Array.isArray(params.points) ? params.points : [],
      visible: true,
      createdAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "automation", userId).push(lane);
    saveStudioState();
    return { ok: true, result: { lane } };
  });

  registerLensAction("studio", "automation-add-point", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const laneId = String(params.laneId || "");
    const timeBeats = Math.max(0, Number(params.timeBeats) || 0);
    const value = Number(params.value);
    if (!laneId || !Number.isFinite(value)) return { ok: false, error: "laneId and value required" };
    const lane = ensureStuBucket(s, "automation", userId).find(l => l.id === laneId);
    if (!lane) return { ok: false, error: "lane not found" };
    lane.points.push({ id: uidStu("pt"), timeBeats, value });
    lane.points.sort((a, b) => a.timeBeats - b.timeBeats);
    saveStudioState();
    return { ok: true, result: { lane } };
  });

  registerLensAction("studio", "automation-delete-lane", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "automation", userId);
    const idx = list.findIndex(l => l.id === id);
    if (idx < 0) return { ok: false, error: "lane not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Bounce / render queue ─────────────────────────────────────

  registerLensAction("studio", "renders-list", (ctx, _a, _p = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const renders = ensureStuBucket(s, "renders", userId);
    return { ok: true, result: { renders: renders.slice().reverse() } };
  });

  registerLensAction("studio", "bounce", async (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const trackId = params.trackId ? String(params.trackId) : null;
    if (!projectId) return { ok: false, error: "projectId required" };
    const project = s.projects.get(userId)?.get(projectId);
    if (!project) return { ok: false, error: "project not found" };
    const format = ["wav_24", "wav_32f", "aiff_24", "mp3_320", "flac"].includes(params.format) ? params.format : "wav_24";
    const sampleRate = [44100, 48000, 88200, 96000, 192000].includes(Number(params.sampleRate)) ? Number(params.sampleRate) : 48000;
    const stems = params.stems === true;
    const render = {
      id: uidStu("bnc"), projectId, projectName: project.name, trackId,
      format, sampleRate, stems,
      kind: trackId ? "stem" : (stems ? "stems" : "stereo_mix"),
      durationSec: Math.max(0, Number(params.durationSec) || 180),
      bouncedAt: new Date().toISOString(),
    };
    // HONEST artifact production. The mixdown is rendered CLIENT-SIDE via Web
    // Audio OfflineAudioContext (concord-frontend/lib/music/player.ts); when the
    // client POSTs the resulting `audioDataUrl` we persist the REAL bytes to
    // route_artifacts and return a working /api/artifacts/:id/download. With no
    // audioDataUrl the server cannot encode audio headless, so we report
    // status:"pending" with NO download URL — never a fabricated success.
    // (Was: status hard-set to "completed" + a /renders/*.wav URL that 404'd.)
    const db = ctx?.db;
    const decoded = params.audioDataUrl ? decodeStudioAudioDataUrl(params.audioDataUrl) : null;
    if (params.audioDataUrl && !decoded) {
      return { ok: false, error: `audioDataUrl must be a base64 audio data: URL (wav/mpeg/ogg/flac, ≤${STUDIO_AUDIO_MAX_BYTES / (1024 * 1024)} MB)` };
    }
    if (decoded && db) {
      try {
        const fileName = `${project.name.replace(/\s+/g, "_")}_${render.kind}_${Date.now()}.${decoded.ext}`;
        const art = await persistStudioRenderArtifact(db, {
          decoded, userId, fileName,
          description: `Studio bounce — ${project.name} (${render.kind})`,
          tags: ["studio_bounce", `project:${projectId}`, `format:${format}`, `creator:${userId}`],
        });
        render.status = "completed";
        render.completedAt = new Date().toISOString();
        render.artifactId = art.artifactId;
        render.sizeBytes = art.sizeBytes;
        render.mimeType = art.mimeType;
        render.downloadUrl = art.downloadUrl;
      } catch (err) {
        render.status = "failed";
        render.error = String(err?.message || err);
      }
    } else {
      render.status = "pending";
      render.reason = "needs_client_render";
    }
    ensureStuBucket(s, "renders", userId).push(render);
    saveStudioState();
    return { ok: render.status === "completed", result: { render } };
  });

  // ── Markers (timeline) ────────────────────────────────────────

  registerLensAction("studio", "markers-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!projectId) return { ok: false, error: "projectId required" };
    const all = ensureStuBucket(s, "markers", userId);
    const markers = all.filter(m => m.projectId === projectId).sort((a, b) => a.timeBeats - b.timeBeats);
    return { ok: true, result: { markers } };
  });

  registerLensAction("studio", "markers-add", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const name = String(params.name || "").trim();
    const timeBeats = Math.max(0, Number(params.timeBeats) || 0);
    if (!projectId || !name) return { ok: false, error: "projectId and name required" };
    const marker = {
      id: uidStu("mk"), projectId, name, timeBeats,
      colour: String(params.colour || "#fbbf24"),
      kind: ["section", "cue", "loop_start", "loop_end"].includes(params.kind) ? params.kind : "section",
    };
    ensureStuBucket(s, "markers", userId).push(marker);
    saveStudioState();
    return { ok: true, result: { marker } };
  });

  registerLensAction("studio", "markers-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "markers", userId);
    const idx = list.findIndex(m => m.id === id);
    if (idx < 0) return { ok: false, error: "marker not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Tempo + time signature changes ────────────────────────────

  registerLensAction("studio", "tempo-changes", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!projectId) return { ok: false, error: "projectId required" };
    const all = ensureStuBucket(s, "tempoChanges", userId);
    const changes = all.filter(t => t.projectId === projectId).sort((a, b) => a.atBeats - b.atBeats);
    return { ok: true, result: { changes } };
  });

  registerLensAction("studio", "tempo-add", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const bpm = Math.max(20, Math.min(999, Number(params.bpm) || 120));
    const atBeats = Math.max(0, Number(params.atBeats) || 0);
    if (!projectId) return { ok: false, error: "projectId required" };
    const change = {
      id: uidStu("tmp"), projectId, bpm, atBeats,
      timeSignatureNum: Math.max(1, Number(params.timeSignatureNum) || 4),
      timeSignatureDen: [1, 2, 4, 8, 16].includes(Number(params.timeSignatureDen)) ? Number(params.timeSignatureDen) : 4,
    };
    ensureStuBucket(s, "tempoChanges", userId).push(change);
    saveStudioState();
    return { ok: true, result: { change } };
  });

  // ── Presets library ───────────────────────────────────────────

  registerLensAction("studio", "presets-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const pluginName = params.pluginName ? String(params.pluginName) : null;
    const all = ensureStuBucket(s, "presets", userId);
    const presets = pluginName ? all.filter(p => p.pluginName === pluginName) : all;
    return { ok: true, result: { presets } };
  });

  registerLensAction("studio", "presets-save", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const name = String(params.name || "").trim();
    const pluginName = String(params.pluginName || "").trim();
    if (!name || !pluginName) return { ok: false, error: "name and pluginName required" };
    const preset = {
      id: uidStu("preset"), name, pluginName,
      category: String(params.category || "user"),
      tags: Array.isArray(params.tags) ? params.tags : [],
      paramSnapshot: typeof params.paramSnapshot === "object" ? params.paramSnapshot : {},
      createdAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "presets", userId).push(preset);
    saveStudioState();
    return { ok: true, result: { preset } };
  });

  registerLensAction("studio", "presets-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "presets", userId);
    const idx = list.findIndex(p => p.id === id);
    if (idx < 0) return { ok: false, error: "preset not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Sends / busses (mixer routing) ────────────────────────────

  registerLensAction("studio", "sends-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!projectId) return { ok: false, error: "projectId required" };
    const all = ensureStuBucket(s, "sends", userId);
    const sends = all.filter(s => s.projectId === projectId);
    return { ok: true, result: { sends } };
  });

  registerLensAction("studio", "sends-set", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const fromTrackId = String(params.fromTrackId || "");
    const toTrackId = String(params.toTrackId || "");
    const levelDb = Math.max(-Infinity, Math.min(12, Number(params.levelDb) || -Infinity));
    if (!projectId || !fromTrackId || !toTrackId) return { ok: false, error: "projectId, fromTrackId, toTrackId required" };
    const all = ensureStuBucket(s, "sends", userId);
    const existing = all.find(s => s.projectId === projectId && s.fromTrackId === fromTrackId && s.toTrackId === toTrackId);
    if (existing) {
      existing.levelDb = levelDb;
    } else {
      all.push({
        id: uidStu("send"), projectId, fromTrackId, toTrackId, levelDb,
        prePost: params.prePost === "pre" ? "pre" : "post",
      });
    }
    saveStudioState();
    return { ok: true, result: { sends: all.filter(x => x.projectId === projectId) } };
  });

  registerLensAction("studio", "sends-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "sends", userId);
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return { ok: false, error: "send not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Session view scenes (Ableton-style clip launcher) ─────────

  registerLensAction("studio", "scenes-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!projectId) return { ok: false, error: "projectId required" };
    const all = ensureStuBucket(s, "scenes", userId);
    const scenes = all.filter(sc => sc.projectId === projectId).sort((a, b) => a.order - b.order);
    return { ok: true, result: { scenes } };
  });

  registerLensAction("studio", "scenes-create", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const name = String(params.name || "").trim();
    if (!projectId || !name) return { ok: false, error: "projectId and name required" };
    const all = ensureStuBucket(s, "scenes", userId).filter(sc => sc.projectId === projectId);
    const scene = {
      id: uidStu("scn"), projectId, name,
      order: all.length,
      tempoBpm: params.tempoBpm != null ? Number(params.tempoBpm) : null,
      timeSignature: params.timeSignature || null,
      launchedAt: null,
      createdAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "scenes", userId).push(scene);
    saveStudioState();
    return { ok: true, result: { scene } };
  });

  registerLensAction("studio", "scenes-launch", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const scene = ensureStuBucket(s, "scenes", userId).find(sc => sc.id === id);
    if (!scene) return { ok: false, error: "scene not found" };
    scene.launchedAt = new Date().toISOString();
    // Find clips that belong to this scene and unmute; mute others on those tracks
    const clips = ensureStuBucket(s, "clips", userId).filter(c => c.projectId === scene.projectId);
    const clipsInScene = clips.filter(c => c.sceneId === id);
    const tracksInScene = new Set(clipsInScene.map(c => c.trackId));
    for (const clip of clips) {
      if (!tracksInScene.has(clip.trackId)) continue;
      clip.muted = clip.sceneId !== id;
    }
    saveStudioState();
    return { ok: true, result: { scene, clipsLaunched: clipsInScene.length } };
  });

  // ════════════════════════════════════════════════════════════════
  //  Feature-parity backlog vs Ableton Live (2026)
  // ════════════════════════════════════════════════════════════════

  // ── Audio clip editing — warp markers, slices, fades ──────────────
  // Buffer state lives client-side (Web Audio). This persists the
  // non-destructive edit envelope on a clip: warp markers (beat→sample
  // anchors), slice points, fade-in/out, gain.

  registerLensAction("studio", "clip-warp-set", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const clipId = String(params.clipId || "");
    const clip = ensureStuBucket(s, "clips", userId).find(c => c.id === clipId);
    if (!clip) return { ok: false, error: "clip not found" };
    const markers = Array.isArray(params.warpMarkers) ? params.warpMarkers : [];
    clip.warpMarkers = markers
      .map(m => ({
        beat: Math.max(0, Number(m.beat) || 0),
        sampleSec: Math.max(0, Number(m.sampleSec) || 0),
      }))
      .sort((a, b) => a.beat - b.beat);
    clip.warpEnabled = clip.warpMarkers.length >= 2 ? (params.warpEnabled !== false) : false;
    if (params.warpMode != null) {
      clip.warpMode = ["beats", "tones", "texture", "repitch", "complex"].includes(params.warpMode)
        ? params.warpMode : "beats";
    }
    saveStudioState();
    return { ok: true, result: { clip } };
  });

  registerLensAction("studio", "clip-slice", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const clipId = String(params.clipId || "");
    const list = ensureStuBucket(s, "clips", userId);
    const clip = list.find(c => c.id === clipId);
    if (!clip) return { ok: false, error: "clip not found" };
    const at = Number(params.atBeats);
    if (!Number.isFinite(at) || at <= clip.startBeats || at >= clip.startBeats + clip.lengthBeats) {
      return { ok: false, error: "atBeats must fall inside the clip" };
    }
    const leftLen = at - clip.startBeats;
    const rightLen = clip.lengthBeats - leftLen;
    const right = {
      ...clip,
      id: uidStu("clip"),
      name: `${clip.name} (slice)`,
      startBeats: at,
      lengthBeats: rightLen,
      warpMarkers: (clip.warpMarkers || []).filter(m => m.beat >= leftLen).map(m => ({ ...m, beat: m.beat - leftLen })),
      fadeInBeats: 0,
      createdAt: new Date().toISOString(),
    };
    clip.lengthBeats = leftLen;
    clip.warpMarkers = (clip.warpMarkers || []).filter(m => m.beat <= leftLen);
    clip.fadeOutBeats = 0;
    list.push(right);
    saveStudioState();
    return { ok: true, result: { left: clip, right } };
  });

  registerLensAction("studio", "clip-fade-set", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const clipId = String(params.clipId || "");
    const clip = ensureStuBucket(s, "clips", userId).find(c => c.id === clipId);
    if (!clip) return { ok: false, error: "clip not found" };
    const cap = clip.lengthBeats;
    if (params.fadeInBeats != null) clip.fadeInBeats = Math.max(0, Math.min(cap, Number(params.fadeInBeats) || 0));
    if (params.fadeOutBeats != null) clip.fadeOutBeats = Math.max(0, Math.min(cap, Number(params.fadeOutBeats) || 0));
    if (params.fadeInCurve != null) clip.fadeInCurve = ["linear", "exp", "log", "scurve"].includes(params.fadeInCurve) ? params.fadeInCurve : "linear";
    if (params.fadeOutCurve != null) clip.fadeOutCurve = ["linear", "exp", "log", "scurve"].includes(params.fadeOutCurve) ? params.fadeOutCurve : "linear";
    if (params.gainDb != null) clip.gainDb = Math.max(-60, Math.min(12, Number(params.gainDb) || 0));
    saveStudioState();
    return { ok: true, result: { clip } };
  });

  // ── Sampler / Drum-rack instrument ────────────────────────────────
  // 16-pad rack; each pad maps a sample DTU + a velocity/key zone.

  registerLensAction("studio", "drumrack-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = params.projectId ? String(params.projectId) : null;
    const racks = ensureStuBucket(s, "drumRacks", userId)
      .filter(r => !projectId || r.projectId === projectId);
    return { ok: true, result: { racks } };
  });

  registerLensAction("studio", "drumrack-create", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const name = String(params.name || "").trim();
    if (!projectId || !name) return { ok: false, error: "projectId and name required" };
    const padCount = [8, 16, 32].includes(Number(params.padCount)) ? Number(params.padCount) : 16;
    const rack = {
      id: uidStu("rack"), projectId, name,
      kind: params.kind === "sampler" ? "sampler" : "drumrack",
      pads: Array.from({ length: padCount }, (_, i) => ({
        index: i,
        label: `Pad ${i + 1}`,
        sampleUrl: null,
        sampleDtuId: null,
        gainDb: 0,
        pan: 0,
        tuneSemitones: 0,
        loop: false,
        reverse: false,
        chokeGroup: 0,
        velLow: 1, velHigh: 127,
        keyLow: 0, keyHigh: 127,
        rootNote: 60,
      })),
      createdAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "drumRacks", userId).push(rack);
    saveStudioState();
    return { ok: true, result: { rack } };
  });

  registerLensAction("studio", "drumrack-pad-assign", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const rackId = String(params.rackId || "");
    const rack = ensureStuBucket(s, "drumRacks", userId).find(r => r.id === rackId);
    if (!rack) return { ok: false, error: "rack not found" };
    const idx = Number(params.padIndex);
    const pad = rack.pads[idx];
    if (!pad) return { ok: false, error: "pad index out of range" };
    if (params.label != null) pad.label = String(params.label).slice(0, 40);
    if (params.sampleUrl != null) pad.sampleUrl = params.sampleUrl ? String(params.sampleUrl) : null;
    if (params.sampleDtuId != null) pad.sampleDtuId = params.sampleDtuId ? String(params.sampleDtuId) : null;
    if (params.gainDb != null) pad.gainDb = Math.max(-60, Math.min(12, Number(params.gainDb) || 0));
    if (params.pan != null) pad.pan = Math.max(-1, Math.min(1, Number(params.pan) || 0));
    if (params.tuneSemitones != null) pad.tuneSemitones = Math.max(-48, Math.min(48, Number(params.tuneSemitones) || 0));
    if (params.loop != null) pad.loop = Boolean(params.loop);
    if (params.reverse != null) pad.reverse = Boolean(params.reverse);
    if (params.chokeGroup != null) pad.chokeGroup = Math.max(0, Math.min(8, Number(params.chokeGroup) || 0));
    if (params.velLow != null) pad.velLow = Math.max(1, Math.min(127, Number(params.velLow) || 1));
    if (params.velHigh != null) pad.velHigh = Math.max(1, Math.min(127, Number(params.velHigh) || 127));
    if (params.keyLow != null) pad.keyLow = Math.max(0, Math.min(127, Number(params.keyLow) || 0));
    if (params.keyHigh != null) pad.keyHigh = Math.max(0, Math.min(127, Number(params.keyHigh) || 127));
    if (params.rootNote != null) pad.rootNote = Math.max(0, Math.min(127, Number(params.rootNote) || 60));
    saveStudioState();
    return { ok: true, result: { rack } };
  });

  registerLensAction("studio", "drumrack-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "drumRacks", userId);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return { ok: false, error: "rack not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Effects rack — EQ / compressor / reverb / delay parametric ─────
  // A standalone reusable effect chain (preset-able) with full param
  // surfaces. effect-add above adds an insert; this stores rack presets.

  const FX_PARAM_SCHEMA = {
    eq: { bands: "array", lowGainDb: [-24, 24], midGainDb: [-24, 24], highGainDb: [-24, 24], lowFreqHz: [20, 1000], highFreqHz: [1000, 20000] },
    compressor: { thresholdDb: [-60, 0], ratio: [1, 20], attackMs: [0.1, 300], releaseMs: [5, 2000], kneeDb: [0, 40], makeupDb: [0, 24] },
    reverb: { decaySec: [0.1, 12], preDelayMs: [0, 250], dampingHz: [200, 18000], mix: [0, 1], roomSize: [0, 1] },
    delay: { timeMs: [10, 2000], feedback: [0, 0.95], mix: [0, 1], pingPong: "bool", syncDivision: "string" },
  };

  registerLensAction("studio", "fx-rack-list", (ctx, _a, _p = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    return { ok: true, result: { racks: ensureStuBucket(s, "fxRacks", userId), schema: FX_PARAM_SCHEMA } };
  });

  registerLensAction("studio", "fx-rack-save", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const units = Array.isArray(params.units) ? params.units : [];
    if (units.length === 0) return { ok: false, error: "at least one effect unit required" };
    const VALID = ["eq", "compressor", "reverb", "delay"];
    for (const u of units) {
      if (!VALID.includes(u.type)) return { ok: false, error: `unit type must be ${VALID.join(" | ")}` };
    }
    const rack = {
      id: uidStu("fxrack"), name,
      units: units.map(u => ({
        id: uidStu("fxu"),
        type: u.type,
        bypassed: u.bypassed === true,
        params: typeof u.params === "object" && u.params ? u.params : {},
      })),
      createdAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "fxRacks", userId).push(rack);
    saveStudioState();
    return { ok: true, result: { rack } };
  });

  registerLensAction("studio", "fx-rack-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "fxRacks", userId);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return { ok: false, error: "rack not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── MIDI controller mappings (Web MIDI) ───────────────────────────
  // Persists CC#/note → parameter assignments. Live note input itself
  // is handled by the browser Web MIDI API; this stores the map.

  registerLensAction("studio", "midi-map-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = params.projectId ? String(params.projectId) : null;
    const maps = ensureStuBucket(s, "midiMaps", userId)
      .filter(m => !projectId || m.projectId === projectId);
    return { ok: true, result: { maps } };
  });

  registerLensAction("studio", "midi-map-add", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const target = String(params.target || "").trim();
    if (!projectId || !target) return { ok: false, error: "projectId and target required" };
    const msgType = ["cc", "note", "pitchbend", "program"].includes(params.msgType) ? params.msgType : "cc";
    const map = {
      id: uidStu("mmap"), projectId, target,
      msgType,
      controller: Math.max(0, Math.min(127, Number(params.controller) || 0)),
      channel: Math.max(0, Math.min(15, Number(params.channel) || 0)),
      rangeMin: Number.isFinite(Number(params.rangeMin)) ? Number(params.rangeMin) : 0,
      rangeMax: Number.isFinite(Number(params.rangeMax)) ? Number(params.rangeMax) : 1,
      deviceName: params.deviceName ? String(params.deviceName) : "any",
      createdAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "midiMaps", userId).push(map);
    saveStudioState();
    return { ok: true, result: { map } };
  });

  registerLensAction("studio", "midi-map-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const list = ensureStuBucket(s, "midiMaps", userId);
    const idx = list.findIndex(m => m.id === id);
    if (idx < 0) return { ok: false, error: "map not found" };
    list.splice(idx, 1);
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Quantization — MIDI notes + groove ────────────────────────────
  // Snaps a clip's MIDI note start beats (and optionally lengths) to a
  // grid, with strength (0..1) and optional swing.

  registerLensAction("studio", "midi-quantize", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const clipId = String(params.clipId || "");
    if (!clipId) return { ok: false, error: "clipId required" };
    const grid = Number(params.gridBeats);
    if (!Number.isFinite(grid) || grid <= 0) return { ok: false, error: "gridBeats must be > 0" };
    const strength = Math.max(0, Math.min(1, params.strength != null ? Number(params.strength) : 1));
    const swing = Math.max(0, Math.min(0.75, Number(params.swing) || 0));
    const quantizeLength = params.quantizeLength === true;
    const notes = ensureStuBucket(s, "midiNotes", userId).filter(n => n.clipId === clipId);
    if (notes.length === 0) return { ok: false, error: "clip has no notes to quantize" };
    let moved = 0;
    for (const n of notes) {
      const slot = Math.round(n.startBeats / grid);
      let target = slot * grid;
      // swing: shift every odd grid slot later
      if (swing > 0 && slot % 2 === 1) target += grid * swing;
      const next = n.startBeats + (target - n.startBeats) * strength;
      if (Math.abs(next - n.startBeats) > 1e-6) moved++;
      n.startBeats = Math.max(0, Number(next.toFixed(6)));
      if (quantizeLength) {
        const lenSlots = Math.max(1, Math.round(n.lengthBeats / grid));
        const tgtLen = lenSlots * grid;
        n.lengthBeats = Math.max(0.0625, Number((n.lengthBeats + (tgtLen - n.lengthBeats) * strength).toFixed(6)));
      }
    }
    saveStudioState();
    return { ok: true, result: { clipId, quantized: notes.length, moved, gridBeats: grid, strength, swing } };
  });

  registerLensAction("studio", "groove-list", (_ctx, _a, _p = {}) => {
    // Built-in groove templates — algorithmic groove definitions
    // (timing/velocity offset parameters), not seeded user data.
    const BUILTIN = [
      { id: "straight", name: "Straight", swing: 0, velAccent: 0 },
      { id: "swing-8-16", name: "8th Swing 16%", swing: 0.16, velAccent: 0.05 },
      { id: "swing-8-33", name: "8th Swing 33%", swing: 0.33, velAccent: 0.08 },
      { id: "swing-8-50", name: "8th Swing 50% (triplet)", swing: 0.5, velAccent: 0.1 },
      { id: "mpc-58", name: "MPC 58%", swing: 0.32, velAccent: 0.12 },
      { id: "laidback", name: "Laid Back", swing: 0.12, velAccent: -0.05 },
    ];
    return { ok: true, result: { grooves: BUILTIN } };
  });

  registerLensAction("studio", "groove-apply", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const clipId = String(params.clipId || "");
    const swing = Math.max(0, Math.min(0.75, Number(params.swing) || 0));
    const velAccent = Math.max(-0.5, Math.min(0.5, Number(params.velAccent) || 0));
    const grid = Number(params.gridBeats) || 0.5;
    if (!clipId) return { ok: false, error: "clipId required" };
    const notes = ensureStuBucket(s, "midiNotes", userId).filter(n => n.clipId === clipId);
    if (notes.length === 0) return { ok: false, error: "clip has no notes" };
    for (const n of notes) {
      const slot = Math.round(n.startBeats / grid);
      if (swing > 0 && slot % 2 === 1) {
        n.startBeats = Math.max(0, Number((slot * grid + grid * swing).toFixed(6)));
      }
      if (velAccent !== 0) {
        const onBeat = slot % 2 === 0;
        const delta = onBeat ? velAccent : -velAccent;
        n.velocity = Math.max(1, Math.min(127, Math.round(n.velocity * (1 + delta))));
      }
    }
    saveStudioState();
    return { ok: true, result: { clipId, grooved: notes.length, swing, velAccent } };
  });

  // ── Recording config — metronome / count-in / loop takes ──────────

  registerLensAction("studio", "record-config-get", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!projectId) return { ok: false, error: "projectId required" };
    const all = ensureStuBucket(s, "recordConfigs", userId);
    let cfg = all.find(c => c.projectId === projectId);
    if (!cfg) {
      cfg = {
        id: uidStu("rcfg"), projectId,
        metronomeEnabled: true,
        metronomeVolume: 0.7,
        countInBars: 1,
        loopRecord: false,
        compMode: false,
        punchInBeats: null,
        punchOutBeats: null,
      };
      all.push(cfg);
      saveStudioState();
    }
    return { ok: true, result: { config: cfg } };
  });

  registerLensAction("studio", "record-config-set", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!projectId) return { ok: false, error: "projectId required" };
    const all = ensureStuBucket(s, "recordConfigs", userId);
    let cfg = all.find(c => c.projectId === projectId);
    if (!cfg) {
      cfg = { id: uidStu("rcfg"), projectId, metronomeEnabled: true, metronomeVolume: 0.7, countInBars: 1, loopRecord: false, compMode: false, punchInBeats: null, punchOutBeats: null };
      all.push(cfg);
    }
    if (params.metronomeEnabled != null) cfg.metronomeEnabled = Boolean(params.metronomeEnabled);
    if (params.metronomeVolume != null) cfg.metronomeVolume = Math.max(0, Math.min(1, Number(params.metronomeVolume) || 0));
    if (params.countInBars != null) cfg.countInBars = Math.max(0, Math.min(4, Math.round(Number(params.countInBars) || 0)));
    if (params.loopRecord != null) cfg.loopRecord = Boolean(params.loopRecord);
    if (params.compMode != null) cfg.compMode = Boolean(params.compMode);
    if (params.punchInBeats !== undefined) cfg.punchInBeats = params.punchInBeats == null ? null : Math.max(0, Number(params.punchInBeats));
    if (params.punchOutBeats !== undefined) cfg.punchOutBeats = params.punchOutBeats == null ? null : Math.max(0, Number(params.punchOutBeats));
    saveStudioState();
    return { ok: true, result: { config: cfg } };
  });

  registerLensAction("studio", "takes-list", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const trackId = String(params.trackId || "");
    if (!trackId) return { ok: false, error: "trackId required" };
    const takes = ensureStuBucket(s, "takes", userId)
      .filter(t => t.trackId === trackId)
      .sort((a, b) => a.takeNumber - b.takeNumber);
    return { ok: true, result: { takes } };
  });

  registerLensAction("studio", "takes-add", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const trackId = String(params.trackId || "");
    if (!projectId || !trackId) return { ok: false, error: "projectId and trackId required" };
    const all = ensureStuBucket(s, "takes", userId);
    const existing = all.filter(t => t.trackId === trackId);
    const take = {
      id: uidStu("take"), projectId, trackId,
      takeNumber: existing.length + 1,
      name: String(params.name || `Take ${existing.length + 1}`),
      audioUrl: params.audioUrl ? String(params.audioUrl) : null,
      mediaDtuId: params.mediaDtuId ? String(params.mediaDtuId) : null,
      durationSec: Math.max(0, Number(params.durationSec) || 0),
      startBeats: Math.max(0, Number(params.startBeats) || 0),
      selected: existing.length === 0,
      createdAt: new Date().toISOString(),
    };
    all.push(take);
    saveStudioState();
    return { ok: true, result: { take } };
  });

  registerLensAction("studio", "takes-comp-select", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const all = ensureStuBucket(s, "takes", userId);
    const take = all.find(t => t.id === id);
    if (!take) return { ok: false, error: "take not found" };
    for (const t of all) {
      if (t.trackId === take.trackId) t.selected = t.id === id;
    }
    saveStudioState();
    return { ok: true, result: { selected: id, trackId: take.trackId } };
  });

  registerLensAction("studio", "takes-delete", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const id = String(params.id || "");
    const all = ensureStuBucket(s, "takes", userId);
    const idx = all.findIndex(t => t.id === id);
    if (idx < 0) return { ok: false, error: "take not found" };
    const wasSelected = all[idx].selected;
    const trackId = all[idx].trackId;
    all.splice(idx, 1);
    if (wasSelected) {
      const remaining = all.filter(t => t.trackId === trackId);
      if (remaining[0]) remaining[0].selected = true;
    }
    saveStudioState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Stem / multi-track export + project import/export ─────────────

  registerLensAction("studio", "export-stems", async (ctx, _a, params = {}) => {
  try {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const project = s.projects.get(userId)?.get(projectId);
    if (!project) return { ok: false, error: "project not found" };
    if (!project.tracks || project.tracks.length === 0) return { ok: false, error: "project has no tracks to export" };
    const format = ["wav_24", "wav_32f", "aiff_24", "flac"].includes(params.format) ? params.format : "wav_24";
    const sampleRate = [44100, 48000, 88200, 96000].includes(Number(params.sampleRate)) ? Number(params.sampleRate) : 48000;
    const db = ctx?.db;
    // HONEST stem export. The client renders each track buffer (OfflineAudioContext)
    // and POSTs `params.stems = [{ trackId, audioDataUrl }]`. We persist each to
    // route_artifacts and return REAL per-stem /api/artifacts/:id/download URLs.
    // Tracks with no supplied buffer are reported status:"pending" (no fabricated
    // URL); the job is "completed" only if EVERY track produced a real artifact.
    // (Was: every stem got a string-built /renders/... URL pointing at nothing.)
    const supplied = new Map();
    if (Array.isArray(params.stems)) {
      for (const sIn of params.stems) {
        if (sIn && typeof sIn === "object" && sIn.trackId && typeof sIn.audioDataUrl === "string") {
          supplied.set(String(sIn.trackId), sIn.audioDataUrl);
        }
      }
    }
    const ts = Date.now();
    const stems = [];
    let producedCount = 0;
    for (let i = 0; i < project.tracks.length; i++) {
      const t = project.tracks[i];
      const dataUrl = supplied.get(String(t.id));
      const decoded = dataUrl ? decodeStudioAudioDataUrl(dataUrl) : null;
      if (decoded && db) {
        try {
          const fileName = `${project.name.replace(/\s+/g, "_")}_${ts}_${String(i + 1).padStart(2, "0")}_${t.name.replace(/\s+/g, "_")}.${decoded.ext}`;
          const art = await persistStudioRenderArtifact(db, {
            decoded, userId, fileName,
            description: `Studio stem — ${project.name} / ${t.name}`,
            tags: ["studio_stem", `project:${projectId}`, `track:${t.id}`, `creator:${userId}`],
          });
          stems.push({ trackId: t.id, trackName: t.name, index: i, status: "completed", artifactId: art.artifactId, sizeBytes: art.sizeBytes, downloadUrl: art.downloadUrl });
          producedCount++;
        } catch (err) {
          stems.push({ trackId: t.id, trackName: t.name, index: i, status: "failed", error: String(err?.message || err) });
        }
      } else if (dataUrl && !decoded) {
        stems.push({ trackId: t.id, trackName: t.name, index: i, status: "failed", error: "invalid audioDataUrl" });
      } else {
        stems.push({ trackId: t.id, trackName: t.name, index: i, status: "pending", reason: "needs_client_render" });
      }
    }
    const allProduced = producedCount === project.tracks.length;
    const job = {
      id: uidStu("stemexp"), projectId, projectName: project.name,
      format, sampleRate, stemCount: stems.length, producedCount, stems,
      status: allProduced ? "completed" : "pending",
      exportedAt: new Date().toISOString(),
    };
    ensureStuBucket(s, "renders", userId).push({
      id: job.id, projectId, projectName: project.name, trackId: null,
      format, sampleRate, stems: true, kind: "stems",
      durationSec: 0, status: job.status,
      stemCount: stems.length, producedCount,
      bouncedAt: job.exportedAt,
      ...(allProduced ? { completedAt: job.exportedAt } : { reason: "needs_client_render" }),
    });
    saveStudioState();
    return { ok: allProduced, result: { job } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("studio", "project-export", (ctx, _a, params = {}) => {
  try {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const project = s.projects.get(userId)?.get(projectId);
    if (!project) return { ok: false, error: "project not found" };
    const clips = ensureStuBucket(s, "clips", userId).filter(c => c.projectId === projectId);
    const clipIds = new Set(clips.map(c => c.id));
    const midiNotes = ensureStuBucket(s, "midiNotes", userId).filter(n => clipIds.has(n.clipId));
    const trackIds = new Set((project.tracks || []).map(t => t.id));
    const automation = ensureStuBucket(s, "automation", userId).filter(l => trackIds.has(l.trackId));
    const bundle = {
      format: "concord-studio-project/v1",
      exportedAt: new Date().toISOString(),
      project,
      clips,
      midiNotes,
      automation,
      markers: ensureStuBucket(s, "markers", userId).filter(m => m.projectId === projectId),
      tempoChanges: ensureStuBucket(s, "tempoChanges", userId).filter(t => t.projectId === projectId),
      scenes: ensureStuBucket(s, "scenes", userId).filter(sc => sc.projectId === projectId),
      sends: ensureStuBucket(s, "sends", userId).filter(x => x.projectId === projectId),
      drumRacks: ensureStuBucket(s, "drumRacks", userId).filter(r => r.projectId === projectId),
      midiMaps: ensureStuBucket(s, "midiMaps", userId).filter(m => m.projectId === projectId),
    };
    return { ok: true, result: { bundle } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("studio", "project-import", (ctx, _a, params = {}) => {
  try {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const bundle = params.bundle;
    if (!bundle || typeof bundle !== "object") return { ok: false, error: "bundle required" };
    if (bundle.format !== "concord-studio-project/v1") return { ok: false, error: "unrecognised bundle format" };
    if (!bundle.project || !bundle.project.name) return { ok: false, error: "bundle missing project" };
    // Re-ID everything so import never collides with existing rows.
    const newProjectId = nextStudioId("proj");
    const trackIdMap = new Map();
    const tracks = (bundle.project.tracks || []).map(t => {
      const nid = uidStu("trk");
      trackIdMap.set(t.id, nid);
      return { ...t, id: nid, clips: [] };
    });
    const project = {
      ...bundle.project,
      id: newProjectId,
      name: `${bundle.project.name} (imported)`.slice(0, 80),
      tracks,
      createdAt: nowIsoStudio(),
      updatedAt: nowIsoStudio(),
    };
    if (!s.projects.has(userId)) s.projects.set(userId, new Map());
    s.projects.get(userId).set(newProjectId, project);
    const clipIdMap = new Map();
    const clipList = ensureStuBucket(s, "clips", userId);
    for (const c of (bundle.clips || [])) {
      const nid = uidStu("clip");
      clipIdMap.set(c.id, nid);
      clipList.push({ ...c, id: nid, projectId: newProjectId, trackId: trackIdMap.get(c.trackId) || c.trackId });
    }
    const noteList = ensureStuBucket(s, "midiNotes", userId);
    for (const n of (bundle.midiNotes || [])) {
      if (clipIdMap.has(n.clipId)) noteList.push({ ...n, id: uidStu("note"), clipId: clipIdMap.get(n.clipId) });
    }
    const autoList = ensureStuBucket(s, "automation", userId);
    for (const l of (bundle.automation || [])) {
      if (trackIdMap.has(l.trackId)) autoList.push({ ...l, id: uidStu("auto"), trackId: trackIdMap.get(l.trackId) });
    }
    const markerList = ensureStuBucket(s, "markers", userId);
    for (const m of (bundle.markers || [])) markerList.push({ ...m, id: uidStu("mk"), projectId: newProjectId });
    saveStudioState();
    return {
      ok: true,
      result: {
        project,
        imported: {
          tracks: tracks.length,
          clips: clipIdMap.size,
          notes: (bundle.midiNotes || []).length,
          markers: (bundle.markers || []).length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Real-time collaboration on a project ──────────────────────────
  // A live session: collaborators + an append-only edit log + per-user
  // cursor/selection presence. Frontend polls the session for changes.

  registerLensAction("studio", "collab-session-get", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!projectId) return { ok: false, error: "projectId required" };
    if (!s.collab) s.collab = new Map();
    const session = s.collab.get(projectId);
    if (!session) return { ok: true, result: { session: null } };
    // prune stale presence (90s)
    const cutoff = Date.now() - 90_000;
    session.collaborators = session.collaborators.filter(c => c.lastSeen >= cutoff || c.userId === session.hostUserId);
    return { ok: true, result: { session } };
  });

  registerLensAction("studio", "collab-session-start", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const project = s.projects.get(userId)?.get(projectId);
    if (!project) return { ok: false, error: "project not found" };
    if (!s.collab) s.collab = new Map();
    let session = s.collab.get(projectId);
    if (!session) {
      session = {
        id: uidStu("collab"), projectId, projectName: project.name,
        hostUserId: userId,
        collaborators: [],
        editLog: [],
        startedAt: new Date().toISOString(),
      };
      s.collab.set(projectId, session);
    }
    if (!session.collaborators.find(c => c.userId === userId)) {
      session.collaborators.push({
        userId,
        displayName: String(params.displayName || userId),
        role: "host",
        colour: String(params.colour || "#a855f7"),
        cursorBeats: 0,
        selectionTrackId: null,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
    }
    saveStudioState();
    return { ok: true, result: { session } };
  });

  registerLensAction("studio", "collab-join", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!s.collab) s.collab = new Map();
    const session = s.collab.get(projectId);
    if (!session) return { ok: false, error: "no active session — host must start one" };
    let me = session.collaborators.find(c => c.userId === userId);
    if (!me) {
      const colours = ["#22d3ee", "#f59e0b", "#10b981", "#ec4899", "#3b82f6", "#f43f5e"];
      me = {
        userId,
        displayName: String(params.displayName || userId),
        role: "editor",
        colour: String(params.colour || colours[session.collaborators.length % colours.length]),
        cursorBeats: 0,
        selectionTrackId: null,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      };
      session.collaborators.push(me);
    } else {
      me.lastSeen = Date.now();
    }
    saveStudioState();
    return { ok: true, result: { session } };
  });

  registerLensAction("studio", "collab-presence", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!s.collab) s.collab = new Map();
    const session = s.collab.get(projectId);
    if (!session) return { ok: false, error: "no active session" };
    const me = session.collaborators.find(c => c.userId === userId);
    if (!me) return { ok: false, error: "not a collaborator — join first" };
    me.lastSeen = Date.now();
    if (params.cursorBeats != null) me.cursorBeats = Math.max(0, Number(params.cursorBeats) || 0);
    if (params.selectionTrackId !== undefined) me.selectionTrackId = params.selectionTrackId ? String(params.selectionTrackId) : null;
    saveStudioState();
    return { ok: true, result: { collaborators: session.collaborators } };
  });

  registerLensAction("studio", "collab-edit", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    const op = String(params.op || "").trim();
    if (!s.collab) s.collab = new Map();
    const session = s.collab.get(projectId);
    if (!session) return { ok: false, error: "no active session" };
    if (!session.collaborators.find(c => c.userId === userId)) return { ok: false, error: "not a collaborator" };
    if (!op) return { ok: false, error: "op required" };
    const entry = {
      seq: session.editLog.length + 1,
      userId, op,
      target: params.target ? String(params.target) : null,
      detail: typeof params.detail === "object" && params.detail ? params.detail : {},
      at: new Date().toISOString(),
    };
    session.editLog.push(entry);
    if (session.editLog.length > 500) session.editLog.splice(0, session.editLog.length - 500);
    saveStudioState();
    return { ok: true, result: { entry, logLength: session.editLog.length } };
  });

  registerLensAction("studio", "collab-since", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const projectId = String(params.projectId || "");
    const sinceSeq = Math.max(0, Number(params.sinceSeq) || 0);
    if (!s.collab) s.collab = new Map();
    const session = s.collab.get(projectId);
    if (!session) return { ok: true, result: { entries: [], latestSeq: 0 } };
    const entries = session.editLog.filter(e => e.seq > sinceSeq);
    return {
      ok: true,
      result: {
        entries,
        latestSeq: session.editLog.length,
        collaborators: session.collaborators,
      },
    };
  });

  registerLensAction("studio", "collab-leave", (ctx, _a, params = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projectId = String(params.projectId || "");
    if (!s.collab) s.collab = new Map();
    const session = s.collab.get(projectId);
    if (!session) return { ok: false, error: "no active session" };
    session.collaborators = session.collaborators.filter(c => c.userId !== userId);
    if (session.collaborators.length === 0) {
      s.collab.delete(projectId);
      saveStudioState();
      return { ok: true, result: { left: userId, sessionClosed: true } };
    }
    if (session.hostUserId === userId) {
      session.hostUserId = session.collaborators[0].userId;
      session.collaborators[0].role = "host";
    }
    saveStudioState();
    return { ok: true, result: { left: userId, sessionClosed: false } };
  });

  // ── Dashboard summary (DawShell data source) ──────────────────

  registerLensAction("studio", "dashboard-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projects = s.projects.get(userId) ? Array.from(s.projects.get(userId).values()) : [];
    const clips = ensureStuBucket(s, "clips", userId);
    const renders = ensureStuBucket(s, "renders", userId);
    const presets = ensureStuBucket(s, "presets", userId);
    const drumRacks = ensureStuBucket(s, "drumRacks", userId);
    const fxRacks = ensureStuBucket(s, "fxRacks", userId);
    const totalTracks = projects.reduce((sum, p) => sum + (p.tracks?.length || 0), 0);
    const audioClips = clips.filter(c => c.kind === "audio").length;
    const midiClips = clips.filter(c => c.kind === "midi" || c.kind === "drum").length;
    const activeCollab = s.collab ? s.collab.size : 0;
    return {
      ok: true,
      result: {
        projectCount: projects.length,
        totalTracks,
        totalClips: clips.length,
        audioClips,
        midiClips,
        rendersCompleted: renders.filter(r => r.status === "completed").length,
        rendersQueued: renders.filter(r => r.status === "queued").length,
        presetsCount: presets.length,
        drumRacksCount: drumRacks.length,
        fxRacksCount: fxRacks.length,
        activeCollabSessions: activeCollab,
        latestProject: projects.length > 0
          ? projects.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
          : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Content-engine bridge: publish a studio project as adaptive music ──
  //
  // Studio renders audio client-side via Web Audio API; this macro
  // takes the bounced reference stem (data URL) + the project manifest
  // (tracks/clips/fx as JSON) and persists both to the substrate.
  //
  // The reference stem rides through route_artifacts (HTTP-served at
  // /api/artifacts/:id/download); the manifest rides through dtus
  // with body_json={type:'adaptive_music', region, intensity, manifest,
  // artifactId, mimeType, durationMs}. Frontend AdaptiveMusicBridge
  // queries DTUs by tag (adaptive_music + region:<name>) on world-
  // region transitions and swaps stems live.
  //
  // Future enhancement: a draft_version_id column on dtus lets users
  // iterate without publishing. v1 ships as full-publish-each-time.
  registerLensAction("studio", "publish-as-adaptive-music", async (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const userId = studioActor(ctx);
    if (!userId || userId === "anon") {
      return { ok: false, error: "authentication required to publish adaptive music" };
    }
    const region = String(params.soundscapeRegion || "").toLowerCase();
    if (!ADAPTIVE_REGIONS.has(region)) {
      return { ok: false, error: `soundscapeRegion must be one of: ${[...ADAPTIVE_REGIONS].join(", ")}` };
    }
    const intensity = String(params.intensity || "ambient").toLowerCase();
    if (!ADAPTIVE_INTENSITIES.has(intensity)) {
      return { ok: false, error: `intensity must be one of: ${[...ADAPTIVE_INTENSITIES].join(", ")}` };
    }
    const projectId = params.projectId ? String(params.projectId).slice(0, 64) : null;
    const title = String(params.title || "Adaptive music").slice(0, 200);
    const durationMs = Math.max(0, Math.round(Number(params.durationMs) || 0));
    const moodTags = Array.isArray(params.moodTags)
      ? params.moodTags.filter((m) => typeof m === "string").map((m) => m.toLowerCase().slice(0, 40)).slice(0, 6)
      : [];

    const decoded = decodeStudioAudioDataUrl(params.referenceStemDataUrl);
    if (!decoded) {
      return {
        ok: false,
        error: `referenceStemDataUrl must be a base64 data: URL (audio/wav, mpeg, ogg, or flac, ≤${STUDIO_AUDIO_MAX_BYTES / (1024 * 1024)} MB)`,
      };
    }
    if (!params.manifest || typeof params.manifest !== "object") {
      return { ok: false, error: "manifest required (project tracks/clips/fx JSON)" };
    }

    ensureRouteArtifactsTableStudio(db);

    const dtuId = `dtu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const artifactId = crypto.randomUUID();
    const fileName = `${region}-${intensity}-${dtuId}.${decoded.ext}`;
    const inline = decoded.buf.length <= 1024 * 1024;
    const contentB64 = inline ? decoded.buf.toString("base64") : null;
    let storagePath = null;
    if (!inline) {
      const dir = path.join(STUDIO_LENS_ROOT, region, intensity);
      try {
        // Async fs — a ≤20 MB audio write must not block the event loop.
        await fsp.mkdir(dir, { recursive: true });
        storagePath = path.join(dir, fileName);
        await fsp.writeFile(storagePath, decoded.buf);
      } catch (err) {
        return { ok: false, error: `failed to write reference stem: ${err?.message || err}` };
      }
    }

    const tagsArr = [
      "adaptive_music",
      `region:${region}`,
      `intensity:${intensity}`,
      `creator:${userId}`,
    ];
    if (projectId) tagsArr.push(`project:${projectId}`);
    for (const mood of moodTags) tagsArr.push(`mood:${mood}`);

    try {
      db.prepare(`
        INSERT INTO route_artifacts (
          artifact_id, dtu_id, name, mime_type, size_bytes,
          storage_mode, content_b64, storage_path, created_by,
          description, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        artifactId, dtuId, fileName, decoded.mimeType, decoded.buf.length,
        inline ? "inline" : "disk",
        contentB64, storagePath, userId,
        `Studio adaptive music — ${region}/${intensity}`,
        JSON.stringify(tagsArr),
      );

      db.prepare(`
        INSERT INTO dtus (
          id, owner_user_id, title, body_json, tags_json, visibility, tier
        ) VALUES (?, ?, ?, ?, ?, ?, 'regular')
      `).run(
        dtuId, userId, title,
        JSON.stringify({
          type: "adaptive_music",
          region,
          intensity,
          manifest: params.manifest,
          artifactId,
          mimeType: decoded.mimeType,
          durationMs,
          moodTags,
          projectId,
        }),
        JSON.stringify(tagsArr),
        "public",
      );
    } catch (err) {
      if (storagePath) {
        await fsp.unlink(storagePath).catch(() => { /* idempotent */ });
      }
      return { ok: false, error: `failed to register adaptive-music DTU: ${err?.message || err}` };
    }

    return {
      ok: true,
      result: {
        dtuId,
        artifactId,
        region,
        intensity,
        durationMs,
        moodTags,
        mimeType: decoded.mimeType,
        sizeBytes: decoded.buf.length,
        downloadUrl: `/api/artifacts/${artifactId}/download`,
      },
    };
  });

  // Discovery — list published adaptive-music DTUs for a region/intensity.
  // Frontend AdaptiveMusicBridge polls this on world-region transitions.
  registerLensAction("studio", "list-adaptive-music", (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    const wantRegion = params.region
      ? String(params.region).toLowerCase()
      : null;
    if (wantRegion && !ADAPTIVE_REGIONS.has(wantRegion)) {
      return { ok: false, error: `region must be one of: ${[...ADAPTIVE_REGIONS].join(", ")}` };
    }
    const wantIntensity = params.intensity
      ? String(params.intensity).toLowerCase()
      : null;
    if (wantIntensity && !ADAPTIVE_INTENSITIES.has(wantIntensity)) {
      return { ok: false, error: `intensity must be one of: ${[...ADAPTIVE_INTENSITIES].join(", ")}` };
    }

    const rows = db.prepare(`
      SELECT id, owner_user_id, title, body_json, tags_json, created_at
      FROM dtus
      WHERE tags_json LIKE '%adaptive_music%'
        AND visibility != 'private'
      ORDER BY created_at DESC
      LIMIT 200
    `).all();

    const tracks = [];
    for (const row of rows) {
      let tags = [], body = {};
      try { tags = JSON.parse(row.tags_json || "[]"); } catch { continue; }
      try { body = JSON.parse(row.body_json || "{}"); } catch { continue; }
      if (!Array.isArray(tags) || !tags.includes("adaptive_music")) continue;
      if (body?.type !== "adaptive_music") continue;
      const regionTag = tags.find((t) => typeof t === "string" && t.startsWith("region:"));
      const regionName = regionTag ? regionTag.slice(7) : null;
      if (!regionName || !ADAPTIVE_REGIONS.has(regionName)) continue;
      if (wantRegion && regionName !== wantRegion) continue;
      const intensityTag = tags.find((t) => typeof t === "string" && t.startsWith("intensity:"));
      const intensityName = intensityTag ? intensityTag.slice(10) : null;
      if (wantIntensity && intensityName !== wantIntensity) continue;
      tracks.push({
        dtuId: row.id,
        title: row.title,
        ownerUserId: row.owner_user_id,
        region: regionName,
        intensity: intensityName,
        durationMs: typeof body?.durationMs === "number" ? body.durationMs : null,
        artifactId: body?.artifactId ?? null,
        mimeType: body?.mimeType ?? null,
        moodTags: Array.isArray(body?.moodTags) ? body.moodTags : [],
        downloadUrl: body?.artifactId ? `/api/artifacts/${body.artifactId}/download` : null,
        manifestSummary: body?.manifest
          ? { trackCount: Number(body.manifest?.trackCount) || 0 }
          : null,
        createdAt: row.created_at,
      });
    }
    return { ok: true, result: { tracks, count: tracks.length } };
  });
}
