// server/domains/studio.js
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

  registerLensAction("studio", "bounce", (ctx, _a, params = {}) => {
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
      status: "queued",
      outputUrl: `/renders/${project.name.replace(/\s+/g, '_')}_${Date.now()}.${format.split('_')[0]}`,
      bouncedAt: new Date().toISOString(),
    };
    // Simulate completion immediately (server-side bounce would queue + render)
    render.status = "completed";
    render.completedAt = new Date().toISOString();
    ensureStuBucket(s, "renders", userId).push(render);
    saveStudioState();
    return { ok: true, result: { render } };
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

  // ── Dashboard summary (DawShell data source) ──────────────────

  registerLensAction("studio", "dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getStudioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = studioActor(ctx);
    const projects = s.projects.get(userId) ? Array.from(s.projects.get(userId).values()) : [];
    const clips = ensureStuBucket(s, "clips", userId);
    const renders = ensureStuBucket(s, "renders", userId);
    const presets = ensureStuBucket(s, "presets", userId);
    const totalTracks = projects.reduce((sum, p) => sum + (p.tracks?.length || 0), 0);
    const audioClips = clips.filter(c => c.kind === "audio").length;
    const midiClips = clips.filter(c => c.kind === "midi" || c.kind === "drum").length;
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
        latestProject: projects.length > 0
          ? projects.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
          : null,
      },
    };
  });
}
