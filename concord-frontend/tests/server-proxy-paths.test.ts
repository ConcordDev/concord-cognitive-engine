import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { isBackendWsProxyPath } = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server-proxy-paths.cjs'),
);

describe('isBackendWsProxyPath', () => {
  it('upgrades kernel sockets Next cannot', () => {
    expect(isBackendWsProxyPath('/socket.io/?EIO=4&transport=websocket')).toBe(true);
    expect(isBackendWsProxyPath('/unity-ws')).toBe(true);
    expect(isBackendWsProxyPath('/unity-ws?world=hub')).toBe(true);
    expect(isBackendWsProxyPath('/godot-ws')).toBe(true);
  });

  it('leaves the rest of the site to Next', () => {
    expect(isBackendWsProxyPath('/lenses/world')).toBe(false);
    expect(isBackendWsProxyPath('/unity-client/index.html')).toBe(false);
    expect(isBackendWsProxyPath('/api/health')).toBe(false);
  });
});
