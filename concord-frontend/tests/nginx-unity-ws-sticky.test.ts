import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('sticky nginx upgrades Unity/Godot sockets', () => {
  it('5080 fragment has dedicated /unity-ws and /godot-ws upgrade locations', () => {
    const src = fs.readFileSync(
      path.join(root, 'infra', 'nginx', 'concord-sticky-5080.conf'),
      'utf8',
    );
    expect(src).toMatch(/location \/unity-ws/);
    expect(src).toMatch(/location \/godot-ws/);
    const unity = src.split('location /unity-ws')[1]?.split('location ')[0] || '';
    expect(unity).toContain('Connection "upgrade"');
    expect(unity).not.toContain('Connection ""');
  });
});
