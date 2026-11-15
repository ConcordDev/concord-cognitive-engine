// server/lib/build-sha.js
//
// The git sha of the running tree, exposed on GET /health as `buildSha` so an
// external verifier (the lens walker's sha gate) can prove WHICH build it is
// looking at before it writes any verdict. Resolved ONCE at route
// registration (boot) — never per request, never shelling out from a handler.
//
// Resolution order:
//   1. env CONCORD_BUILD_SHA (set by deploy tooling), if it is a 40-hex sha
//   2. `git rev-parse HEAD` in the repo dir (execFileSync, no shell)
//   3. null — fail-soft; /health must never crash or 503 over this.
//
// Only the bare sha is returned: no branch, path, remote or env content.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveBuildSha({ env = process.env, exec = execFileSync, cwd = REPO_DIR } = {}) {
  try {
    const fromEnv = String(env?.CONCORD_BUILD_SHA ?? "").trim().toLowerCase();
    if (SHA_RE.test(fromEnv)) return fromEnv;
  } catch { /* fall through to git */ }
  try {
    const out = String(exec("git", ["rev-parse", "HEAD"], {
      cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    })).trim().toLowerCase();
    return SHA_RE.test(out) ? out : null;
  } catch {
    return null; // git missing / not a checkout / timeout — never crash boot
  }
}
