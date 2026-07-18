// Minimal type stub for the `fflate` package (real runtime dependency —
// see package.json/package-lock.json, pinned to the exact version already
// resolved as a transitive dep of @react-three/drei/three-stdlib). fflate
// ships its own hand-written declarations at node_modules/fflate/lib/index.d.ts,
// but under this project's `"moduleResolution": "bundler"` TypeScript
// setting, fflate's package.json `exports` map has no `types` condition per
// subpath, so TS can't discover them automatically and reports TS7016. This
// stub declares only the slice of the API actually used in this codebase
// (ObsidianVaultExport.tsx + its test) — extend here if a future caller
// needs more of fflate's surface (e.g. streaming zip/unzip, gzip helpers).

declare module 'fflate' {
  export interface AsyncZipOptions {
    level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    mem?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    comment?: string;
    mtime?: string | number | Date;
  }

  export type Zippable = {
    [path: string]: Uint8Array | [Uint8Array, AsyncZipOptions] | Zippable;
  };

  export type Unzipped = { [path: string]: Uint8Array };

  export function zipSync(data: Zippable, opts?: AsyncZipOptions): Uint8Array;
  export function unzipSync(data: Uint8Array): Unzipped;
  export function strToU8(str: string, latin1?: boolean): Uint8Array;
  export function strFromU8(dat: Uint8Array, latin1?: boolean): string;
}
