// server/lib/runtime/workspace-sensor.js
//
// Shared-workspace awareness — git state + file hashes for invalidation.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_workspace_snapshots'`).get();
  } catch {
    return false;
  }
}

async function gitState(repoRoot) {
  try {
    const { stdout: branch } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });
    const { stdout: commit } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
    return {
      branch: branch.trim(),
      commitHash: commit.trim(),
      dirty: status.trim().length > 0,
      dirtyFiles: status.trim().split("\n").filter(Boolean).length,
    };
  } catch {
    return { branch: null, commitHash: null, dirty: false, dirtyFiles: 0 };
  }
}

async function hashFile(filePath) {
  try {
    const buf = await readFile(filePath);
    return createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

export async function captureWorkspaceSnapshot(db, {
  missionId, repoRoot, watchPaths = [],
} = {}) {
  const root = repoRoot || process.cwd().replace(/\/server$/, "") || process.cwd();
  const git = await gitState(root);
  const fileHashes = {};

  for (const rel of watchPaths.slice(0, 20)) {
    const fp = join(root, rel);
    try {
      const st = await stat(fp);
      if (st.isFile()) fileHashes[rel] = await hashFile(fp);
    } catch { /* optional */ }
  }

  if (!db || !tablesReady(db)) {
    return { ok: true, repoRoot: root, git, fileHashes, persisted: false };
  }

  try {
    db.prepare(`
      INSERT INTO runtime_workspace_snapshots
        (mission_id, repo_root, branch, commit_hash, dirty, file_hashes_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      missionId || null,
      root,
      git.branch,
      git.commitHash,
      git.dirty ? 1 : 0,
      JSON.stringify(fileHashes),
    );
    return { ok: true, repoRoot: root, git, fileHashes, persisted: true };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e), git, fileHashes };
  }
}

export function loadLatestWorkspaceSnapshot(db, missionId) {
  if (!db || !missionId || !tablesReady(db)) return null;
  try {
    const row = db.prepare(`
      SELECT * FROM runtime_workspace_snapshots
      WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(missionId);
    if (!row) return null;
    return {
      ...row,
      fileHashes: row.file_hashes_json ? JSON.parse(row.file_hashes_json) : {},
    };
  } catch {
    return null;
  }
}

export async function detectWorkspaceChanges(db, { missionId, repoRoot, watchPaths = [] } = {}) {
  const prior = loadLatestWorkspaceSnapshot(db, missionId);
  const current = await captureWorkspaceSnapshot(db, { missionId, repoRoot, watchPaths });

  if (!prior) {
    return { ok: true, changed: false, reason: "no_prior_snapshot", current };
  }

  const changes = {
    commitChanged: prior.commit_hash !== current.git?.commitHash,
    branchChanged: prior.branch !== current.git?.branch,
    dirtyChanged: prior.dirty !== (current.git?.dirty ? 1 : 0),
    fileChanges: [],
  };

  const priorHashes = prior.fileHashes || {};
  for (const [path, hash] of Object.entries(current.fileHashes || {})) {
    if (priorHashes[path] && priorHashes[path] !== hash) {
      changes.fileChanges.push({ path, prior: priorHashes[path], current: hash });
    }
  }

  const changed = changes.commitChanged || changes.branchChanged || changes.fileChanges.length > 0
    || (changes.dirtyChanged && current.git?.dirty);

  return {
    ok: true,
    changed,
    changes,
    invalidateContext: changed,
    prior,
    current,
  };
}
