// server/scripts/cartographer/runtime-introspect.js
//
// Spawns a child node process that imports server.js with the disable
// flags set, dumps the registries via globalThis.__CARTOGRAPHER__, and
// exits. Parent reads the JSON dump from a tmp file.
//
// Why a child process: importing server.js binds a SQLite DB, registers
// many setInterval timers, and starts the Socket.IO listener. The child
// gets a 180-second hard timeout and a process.exit after dump so we
// never inherit lingering timers in the parent CLI.
//
// Falls back to `{ booted: false, reason }` on any failure — the
// cartographer's static-parse output is always sufficient on its own.

import { spawn } from "node:child_process";
import { readFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const BRIDGE_TIMEOUT_MS = 180_000;

export async function runtimeIntrospect(repoRoot) {
  const t0 = Date.now();
  const tmpDir = path.join(os.tmpdir(), `cartographer-${process.pid}-${crypto.randomUUID().slice(0, 8)}`);
  await mkdir(tmpDir, { recursive: true });
  const dumpPath = path.join(tmpDir, "dump.json");
  const dbPath = path.join(tmpDir, "concord.db");
  const bridgeScript = path.join(repoRoot, "server", "scripts", "cartographer", "runtime-bridge.js");

  let bridgeExists = false;
  try { await stat(bridgeScript); bridgeExists = true; } catch { /* missing */ }
  if (!bridgeExists) {
    return { booted: false, reason: "runtime_bridge_missing", bootDurationMs: Date.now() - t0 };
  }

  const env = {
    ...process.env,
    CONCORD_NO_LISTEN: "true",
    CONCORD_DB_PATH: dbPath,
    CONCORD_DISABLE_BRAINS: "true",
    CONCORD_DISABLE_GHOST_FLEET: "true",
    CONCORD_DISABLE_HEARTBEAT: "true",
    CONCORD_CARTOGRAPHER: "true",
    CONCORD_CARTOGRAPHER_DUMP_PATH: dumpPath,
    NODE_ENV: "test",
  };

  const child = spawn(process.execPath, [bridgeScript], {
    cwd: path.join(repoRoot, "server"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", d => stdoutChunks.push(d));
  child.stderr.on("data", d => stderrChunks.push(d));

  const timeout = new Promise(resolve => {
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      resolve("timeout");
    }, BRIDGE_TIMEOUT_MS);
  });

  const finished = new Promise(resolve => {
    child.on("exit", code => resolve(code === 0 ? "ok" : `exit:${code}`));
    child.on("error", err => resolve(`error:${err?.message ?? "unknown"}`));
  });

  const result = await Promise.race([finished, timeout]);
  const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
  const stderr = Buffer.concat(stderrChunks).toString("utf-8");

  if (result !== "ok") {
    await tryCleanup(tmpDir);
    return {
      booted: false,
      reason: `bridge_failed:${result}`,
      bootDurationMs: Date.now() - t0,
      stderrTail: stderr.slice(-500),
      stdoutTail: stdout.slice(-500),
    };
  }

  let dump;
  try {
    const raw = await readFile(dumpPath, "utf-8");
    dump = JSON.parse(raw);
  } catch (err) {
    await tryCleanup(tmpDir);
    return {
      booted: false,
      reason: `dump_unreadable:${err?.message ?? "unknown"}`,
      bootDurationMs: Date.now() - t0,
    };
  }

  await tryCleanup(tmpDir);

  return {
    booted: true,
    bootDurationMs: Date.now() - t0,
    macros: dump.macros ?? [],
    heartbeats: dump.heartbeats ?? [],
    lensManifests: dump.lensManifests ?? [],
    moduleRegistry: dump.moduleRegistry ?? [],
    ghostFleetStatus: dump.ghostFleetStatus ?? [],
  };
}

async function tryCleanup(dir) {
  try { await rm(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
