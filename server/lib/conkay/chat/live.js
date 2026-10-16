// server/lib/conkay/chat/live.js
//
// The live build stream (conversational-loop item 3): the orchestrator's progress events, read-only, for the
// /conkay/designs/[id]/live page. Two sources, one event shape:
//   - a recorded run (lib/conkay/showcase/live/<id>.json, with each snapshot STL copied beside it under
//     <id>/<sha12>.stl): replayed in order, event ids 1..n, so a viewer resumes from Last-Event-ID;
//   - a run in this process (startLiveRun): its events as they happen, to every viewer, with the same ids.
// No user data: events are the orchestrator's design records (checks, candidates, margins, the change, the rerun
// set, envelope counts, a snapshot reference). Local cache paths never leave the server: a snapshot is a file name
// and its sha256, served only if the run lists it and its hash still matches.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const LIVE_VERSION = "1.0.0";
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LIVE_DIR = path.join(HERE, "..", "showcase", "live");
export const LIVE_ID = /^[a-z0-9-]{1,40}$/;
const FILE_NAME = /^[a-f0-9]{12}\.stl$/;

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** Copy a snapshot's STL into the run's folder and replace its local path by a file name + hash. */
function publishSnapshot(snapshot, dir, files) {
  if (!snapshot?.path || !fs.existsSync(snapshot.path)) return snapshot ? { kind: snapshot.kind, file: null, sha256: snapshot.sha256 ?? null, note: "the snapshot file was not available when the run was recorded" } : null;
  const sha = sha256File(snapshot.path);
  const name = `${sha.slice(0, 12)}.stl`;
  if (!files.has(name)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(snapshot.path, path.join(dir, name));
    files.set(name, { name, sha256: sha, bytes: fs.statSync(snapshot.path).size });
  }
  return { kind: "stl", file: name, sha256: sha, triangles: snapshot.triangles ?? null };
}

/** Public form of an event: snapshot paths replaced. */
function publicEvent(e, dir, files) {
  return e && "snapshot" in e ? { ...e, snapshot: publishSnapshot(e.snapshot, dir, files) } : e;
}

/** Write a recorded run: { id, prompt, events } -> lib/conkay/showcase/live/<id>.json (+ its STL snapshots). */
export function recordLiveRun({ id, prompt, events, liveDir = LIVE_DIR }) {
  if (!LIVE_ID.test(id)) throw new Error(`bad live run id "${id}"`);
  const dir = path.join(liveDir, id);
  const files = new Map();
  const out = events.map((e, i) => ({ id: i + 1, ...publicEvent(e, dir, files) }));
  const run = { liveVersion: LIVE_VERSION, id, prompt, events: out, files: [...files.values()] };
  fs.mkdirSync(liveDir, { recursive: true });
  fs.writeFileSync(path.join(liveDir, `${id}.json`), `${JSON.stringify(run, null, 1)}\n`);
  return run;
}

const recorded = new Map();
/** A recorded run, or null. */
export function loadLiveRun(id, { liveDir = LIVE_DIR } = {}) {
  if (!LIVE_ID.test(String(id))) return null;
  const key = `${liveDir}|${id}`;
  if (recorded.has(key)) return recorded.get(key);
  const p = path.join(liveDir, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  const run = JSON.parse(fs.readFileSync(p, "utf8"));
  recorded.set(key, run);
  return run;
}

/** A snapshot file of a recorded run, only if the run lists it and its hash still matches. */
export function loadLiveRunFile(id, name, { liveDir = LIVE_DIR } = {}) {
  const run = loadLiveRun(id, { liveDir });
  if (!run || !FILE_NAME.test(String(name))) return null;
  const listed = run.files.find((f) => f.name === name);
  if (!listed) return null;
  const p = path.join(liveDir, id, name);
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  if (crypto.createHash("sha256").update(buf).digest("hex") !== listed.sha256) return null;
  return buf;
}

// ---- runs in this process ----------------------------------------------------------------------------------------

const hub = new Map(); // id -> { events, listeners:Set, done, dir, files }

/** Start a run whose events stream live: run(onEvent) is the orchestration (e.g. designFromChat with onEvent). */
export function startLiveRun(id, run, { liveDir = LIVE_DIR } = {}) {
  if (!LIVE_ID.test(id)) throw new Error(`bad live run id "${id}"`);
  if (hub.has(id) && !hub.get(id).done) throw new Error(`live run ${id} is already running`);
  const ch = { events: [], listeners: new Set(), done: false, dir: path.join(liveDir, id), files: new Map() };
  hub.set(id, ch);
  const onEvent = (e) => {
    const ev = { id: ch.events.length + 1, ...publicEvent(e, ch.dir, ch.files) };
    ch.events.push(ev);
    for (const l of ch.listeners) l(ev);
    if (e.type === "done") ch.done = true;
  };
  return Promise.resolve().then(() => run(onEvent)).finally(() => { ch.done = true; for (const l of ch.listeners) l(null); });
}

/** Subscribe to a live run: replays events after `after`, then new ones; listener(null) when it ends. */
export function subscribeLive(id, after, listener) {
  const ch = hub.get(id);
  if (!ch) return null;
  for (const e of ch.events) if (e.id > after) listener(e);
  if (ch.done) { listener(null); return () => {}; }
  ch.listeners.add(listener);
  return () => ch.listeners.delete(listener);
}

/** The events of a recorded or live run after event id `after` (for tests and non-streaming readers). */
export function eventsAfter(id, after = 0, opts = {}) {
  const live = hub.get(id);
  const events = live ? live.events : loadLiveRun(id, opts)?.events;
  return events ? events.filter((e) => e.id > after) : null;
}

export function _resetLiveHubForTest() { hub.clear(); recorded.clear(); }
