import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

/**
 * #1707 follow-up (GB-0836/0837): the Pyodide vendoring gate must run in the
 * build path that is actually invoked. Next 16 builds with Turbopack, which
 * never runs the `webpack` hook the gate used to hang off, so `next build`
 * exited 0 with no public/pyodide. The gate is now also triggered from
 * `generateBuildId`, which `next build` awaits for every production build
 * whatever the bundler. This pins that wiring (and that a failing gate
 * fails the build), not just ensure-pyodide's own decision table.
 */
const req = createRequire(import.meta.url);
const configPath = path.resolve(__dirname, '../next.config.js');
const cp = req('node:child_process') as { spawnSync: (...a: unknown[]) => unknown };

type Cfg = { generateBuildId: () => Promise<string | null>; webpack: unknown };
function loadConfig(): Cfg {
  delete req.cache[configPath]; // fresh module => fresh once-per-process flag
  return req(configPath) as Cfg;
}

describe('Pyodide gate is wired into the invoked build path', () => {
  const realSpawn = cp.spawnSync;
  const env = { ...process.env };
  beforeEach(() => { delete process.env.CONCORD_PYODIDE_VENDOR_SKIP; delete process.env.NEXT_PUBLIC_SENTRY_DSN; });
  afterEach(() => { cp.spawnSync = realSpawn; process.env = { ...env }; vi.restoreAllMocks(); });

  it('next.config exposes a bundler-independent generateBuildId trigger (not only the webpack hook)', () => {
    const cfg = loadConfig();
    expect(typeof cfg.generateBuildId).toBe('function');
  });

  it('generateBuildId runs ensure-pyodide.mjs and keeps Next\'s default build id (null)', async () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    cp.spawnSync = spawn;
    const cfg = loadConfig();
    await expect(cfg.generateBuildId()).resolves.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(1);
    const args = spawn.mock.calls[0] as unknown as [string, string[]];
    expect(args[1][0]).toMatch(/scripts[\\/]ensure-pyodide\.mjs$/);
  });

  it('a failing gate FAILS the build loudly (rejects with the remedy), never a soft pass', async () => {
    cp.spawnSync = vi.fn(() => ({ status: 1 }));
    const cfg = loadConfig();
    await expect(cfg.generateBuildId()).rejects.toThrow(/Pyodide vendoring failed.*vendor:pyodide/s);
  });

  it('runs once per process even if the webpack hook also fires', async () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    cp.spawnSync = spawn;
    const cfg = loadConfig();
    await cfg.generateBuildId();
    (cfg.webpack as (c: object, o: object) => object)({ resolve: {}, plugins: [], module: { rules: [] } }, { isServer: false, dev: false, webpack: { DefinePlugin: class {}, IgnorePlugin: class {} } });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('the explicit skip is the only opt-out and is logged, not silent', async () => {
    process.env.CONCORD_PYODIDE_VENDOR_SKIP = '1';
    const spawn = vi.fn(() => ({ status: 0 }));
    cp.spawnSync = spawn;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = loadConfig();
    await expect(cfg.generateBuildId()).resolves.toBeNull();
    expect(spawn).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/CONCORD_PYODIDE_VENDOR_SKIP=1/);
  });

  it('the npm build script still ends with check:pyodide (hash mismatch / missing files fail `npm run build`)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    expect(pkg.scripts.build).toMatch(/next build.*check:pyodide$/);
    expect(pkg.scripts['check:pyodide']).toContain('check-pyodide.mjs');
  });
});
