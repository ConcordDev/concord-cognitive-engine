import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveUnityWebRoot,
  resolveUnityIndexFile,
  safeUnityRelativePath,
  unityAssetContentType,
  unityAssetIsGzipped,
  unityPayloadIsGzip,
  unityPayloadIsLfsPointer,
} from '@/lib/unity-web-files';

const repoFrontend = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('unity web files', () => {
  it('finds the committed player from the frontend cwd', () => {
    const root = resolveUnityWebRoot(repoFrontend);
    expect(root).toBeTruthy();
    expect(fs.existsSync(path.join(root!, 'Build', 'concordia.wasm.unityweb'))).toBe(true);
    expect(resolveUnityIndexFile(repoFrontend)).toMatch(/export-index\.html$/);
  });

  it('finds the committed player from a fake standalone cwd', () => {
    const standaloneCwd = path.join(repoFrontend, '.next', 'standalone');
    const root = resolveUnityWebRoot(standaloneCwd);
    expect(root).toBeTruthy();
    expect(fs.existsSync(path.join(root!, 'Build', 'concordia.loader.js'))).toBe(true);
  });

  it('rejects traversal and maps gzip unityweb types', () => {
    expect(safeUnityRelativePath('../server.js')).toBeNull();
    expect(safeUnityRelativePath('Build/concordia.wasm.unityweb')).toBe(
      'Build/concordia.wasm.unityweb',
    );
    expect(unityAssetIsGzipped('Build/concordia.wasm.unityweb')).toBe(true);
    expect(unityAssetIsGzipped('Build/concordia.loader.js')).toBe(false);
    expect(unityAssetContentType('Build/concordia.wasm.unityweb')).toBe('application/wasm');
  });

  it('tells a Git LFS pointer from a gzip Unity blob', () => {
    const pointer = new TextEncoder().encode('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n');
    expect(unityPayloadIsLfsPointer(pointer)).toBe(true);
    expect(unityPayloadIsGzip(pointer)).toBe(false);
    const gzip = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
    expect(unityPayloadIsLfsPointer(gzip)).toBe(false);
    expect(unityPayloadIsGzip(gzip)).toBe(true);
  });

  it('the committed framework is gzip bytes or an LFS pointer, never both', () => {
    const file = path.join(repoFrontend, 'public', 'unity-client', 'Build', 'concordia.framework.js.unityweb');
    const buf = fs.readFileSync(file);
    const pointer = unityPayloadIsLfsPointer(buf);
    const gzip = unityPayloadIsGzip(buf);
    expect(pointer || gzip).toBe(true);
    expect(pointer && gzip).toBe(false);
  });
});
