import { describe, it, expect } from 'vitest';
import {
  isLoopbackHttpOrigin,
  unityKernelGatewayUrl,
  buildUnityIframeSearch,
} from '@/lib/unity-iframe-config';

describe('unityKernelGatewayUrl', () => {
  it('keeps production on same-origin /unity-ws', () => {
    expect(isLoopbackHttpOrigin('https://concord-os.org')).toBe(false);
    expect(unityKernelGatewayUrl('https://concord-os.org')).toBe('wss://concord-os.org/unity-ws');
  });

  it('pins loopback next to the kitchen kernel on :5050', () => {
    expect(unityKernelGatewayUrl('http://127.0.0.1:3000')).toBe('ws://127.0.0.1:5050/unity-ws');
    expect(unityKernelGatewayUrl('http://localhost:3010')).toBe('ws://127.0.0.1:5050/unity-ws');
  });
});

describe('buildUnityIframeSearch', () => {
  it('stamps world, optional jwt, and the kernel gateway', () => {
    const params = buildUnityIframeSearch({
      worldId: 'concordia-hub',
      token: 'tok',
      pageOrigin: 'https://concord-os.org',
    });
    expect(params.get('CONCORD_WORLD_ID')).toBe('concordia-hub');
    expect(params.get('CONCORD_AUTH_TOKEN')).toBe('tok');
    expect(params.get('CONCORD_GATEWAY_URL')).toBe('wss://concord-os.org/unity-ws');
  });
});
