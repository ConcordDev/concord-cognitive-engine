#!/usr/bin/env node
// heartbeat — builder and walker heartbeat; die loudly (Mega Plan v2, HV-04).
//
// Contract (MEGA_PLAN.md §3, HV-G0, row HV-04):
//   1) Each claimed seat touches ~/.zuko/quality/heartbeats/<seat>.hb at least
//      every 5 minutes while its claim is live.
//   2) A watcher appends ONE "NOTE: <seat> SILENT 30m on <claim>" line per
//      silence to the fleet bridge — via bridge-append only — and never edits
//      past bridge entries.
//   3) Only Dutch or the Overseer office releases a claim (the `release`
//      command is the mechanism; who may run it is a procedural rule).
//
// Usage:
//   heartbeat beat <seat> --claim <claim-id>   touch <seat>.hb now
//   heartbeat watch [--loop <seconds>]         one watcher pass (or loop)
//   heartbeat status                           list seats, ages, flag state
//   heartbeat release <seat>                   remove <seat>.hb (Dutch/office)
//
// Test hooks (the HV-04 acceptance pin runs on an injected clock):
//   HEARTBEAT_DIR            heartbeat directory (default ~/.zuko/quality/heartbeats)
//   HEARTBEAT_NOW            injected clock: ISO string or epoch ms (or --now)
//   HEARTBEAT_BRIDGE_APPEND  bridge-append path (default ~/.zuko/quality/bin/bridge-append)
//   BRIDGE_FILE              passed through to bridge-append (its own override)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const SILENCE_MS = 30 * 60 * 1000;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

export function resolveNow() {
  const raw = opt("--now") || process.env.HEARTBEAT_NOW;
  if (!raw) return Date.now();
  const n = Number(raw);
  if (Number.isFinite(n) && String(n) === String(raw).trim()) return n;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error(`heartbeat: unparseable injected clock "${raw}"`);
  return t;
}

export function heartbeatDir() {
  return process.env.HEARTBEAT_DIR || path.join(os.homedir(), ".zuko", "quality", "heartbeats");
}

export function bridgeAppendPath() {
  return (
    process.env.HEARTBEAT_BRIDGE_APPEND ||
    path.join(os.homedir(), ".zuko", "quality", "bin", "bridge-append")
  );
}

const hbPath = (dir, seat) => path.join(dir, `${seat}.hb`);
const flagPath = (dir, seat) => path.join(dir, `${seat}.flagged`);

export function readHeartbeat(dir, seat) {
  const p = hbPath(dir, seat);
  if (!fs.existsSync(p)) return null;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    data = {};
  }
  const updatedAt =
    typeof data.updatedAt === "number" ? data.updatedAt : fs.statSync(p).mtimeMs;
  return { seat: data.seat || seat, claim: data.claim || "unknown claim", updatedAt };
}

export function beat(seat, claim, now = resolveNow(), dir = heartbeatDir()) {
  if (!seat) throw new Error("usage: heartbeat beat <seat> --claim <claim-id>");
  fs.mkdirSync(dir, { recursive: true });
  const record = { seat, claim: claim || "unknown claim", updatedAt: now };
  fs.writeFileSync(hbPath(dir, seat), JSON.stringify(record) + "\n");
  // A fresh beat ends any flagged silence episode; the next silence re-arms.
  return record;
}

export function appendFlagLine(line, appendPath = bridgeAppendPath()) {
  execFileSync(appendPath, ["-a", "heartbeat watcher (HV-04)", "-t", "NOTE"], {
    input: line + "\n",
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
}

/** One watcher pass. Returns the flag lines appended in this pass. */
export function watchOnce(now = resolveNow(), dir = heartbeatDir(), append = appendFlagLine) {
  const appended = [];
  if (!fs.existsSync(dir)) return appended;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".hb")).sort()) {
    const seat = name.slice(0, -3);
    const hb = readHeartbeat(dir, seat);
    if (!hb) continue;
    if (now - hb.updatedAt <= SILENCE_MS) continue; // 29m: none. 31m: flag.
    const fp = flagPath(dir, seat);
    const already =
      fs.existsSync(fp) && fs.readFileSync(fp, "utf8").trim() === String(hb.updatedAt);
    if (already) continue; // exactly one flag per silence
    const line = `NOTE: ${seat} SILENT 30m on ${hb.claim}`;
    append(line);
    fs.writeFileSync(fp, String(hb.updatedAt) + "\n");
    appended.push(line);
  }
  return appended;
}

export function release(seat, dir = heartbeatDir()) {
  if (!seat) throw new Error("usage: heartbeat release <seat>");
  fs.rmSync(hbPath(dir, seat), { force: true });
  fs.rmSync(flagPath(dir, seat), { force: true });
}

function status(now = resolveNow(), dir = heartbeatDir()) {
  if (!fs.existsSync(dir)) return console.log("no heartbeats directory");
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".hb")).sort()) {
    const hb = readHeartbeat(dir, name.slice(0, -3));
    const ageMin = Math.floor((now - hb.updatedAt) / 60000);
    const flagged = fs.existsSync(flagPath(dir, hb.seat)) ? " FLAGGED" : "";
    console.log(`${hb.seat} · ${hb.claim} · last beat ${ageMin}m ago${flagged}`);
  }
}

async function main() {
  if (cmd === "beat") {
    const r = beat(args[1], opt("--claim"));
    console.log(`heartbeat: ${r.seat} beat on ${r.claim} @ ${new Date(r.updatedAt).toISOString()}`);
  } else if (cmd === "watch") {
    const loopSec = Number(opt("--loop") || 0);
    for (;;) {
      const lines = watchOnce();
      for (const l of lines) console.log(l);
      if (!loopSec) break;
      await new Promise((r) => setTimeout(r, loopSec * 1000));
    }
  } else if (cmd === "status") {
    status();
  } else if (cmd === "release") {
    release(args[1]);
    console.log(`heartbeat: ${args[1]} released`);
  } else {
    console.error("usage: heartbeat <beat|watch|status|release> ...");
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
