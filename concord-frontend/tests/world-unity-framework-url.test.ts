import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => null }));

import { unityFrameworkUrl } from '@/components/world/WorldUnityShell';

describe('unityFrameworkUrl', () => {
  it('reads the framework file the player index loads', () => {
    const html = 'var buildUrl = "Build";\n config = { frameworkUrl: buildUrl + "/concordia-webgl-out-editor-20260909-real.framework.js.gz" }';
    expect(unityFrameworkUrl('/concordia-webgl/index.html', html)).toBe(
      '/concordia-webgl/Build/concordia-webgl-out-editor-20260909-real.framework.js.gz',
    );
  });

  it('keeps the committed player name when the index matches it', () => {
    const html = 'var buildUrl = "Build"; frameworkUrl: buildUrl + "/concordia.framework.js.unityweb",';
    expect(unityFrameworkUrl('/unity-client/index.html?x=1', html)).toBe('/unity-client/Build/concordia.framework.js.unityweb');
  });

  it('falls back to the committed name when the index does not say', () => {
    expect(unityFrameworkUrl('/unity-client/index.html')).toBe('/unity-client/Build/concordia.framework.js.unityweb');
  });

  it('honours an absolute buildUrl', () => {
    const html = "var buildUrl = '/cdn/b'; frameworkUrl: buildUrl + '/x.framework.js.br'";
    expect(unityFrameworkUrl('/p/index.html', html)).toBe('/cdn/b/x.framework.js.br');
  });
});
