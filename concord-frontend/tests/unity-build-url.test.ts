import { describe, it, expect } from 'vitest';
import {
  resolveUnityBuildBaseUrl,
  unityPlayerCandidatesFromEnv,
  UNITY_SAME_ORIGIN_INDEX,
} from '@/lib/unity-build-url';

describe('unity build url (PF-10)', () => {
  it('no base configured: candidates are exactly the pre-PF-10 list', () => {
    expect(resolveUnityBuildBaseUrl({})).toBeNull();
    expect(unityPlayerCandidatesFromEnv({})).toEqual([UNITY_SAME_ORIGIN_INDEX]);
    expect(
      unityPlayerCandidatesFromEnv({ NEXT_PUBLIC_UNITY_WEBGL_URL: 'https://player.example/play' }),
    ).toEqual(['https://player.example/play', UNITY_SAME_ORIGIN_INDEX]);
  });

  it('a valid CDN base slots its index between the override and same-origin', () => {
    const env = {
      NEXT_PUBLIC_UNITY_WEBGL_URL: 'https://player.example/play',
      NEXT_PUBLIC_UNITY_BUILD_BASE_URL: 'https://cdn.example/builds/abc123',
    };
    expect(resolveUnityBuildBaseUrl(env)).toBe('https://cdn.example/builds/abc123/');
    expect(unityPlayerCandidatesFromEnv(env)).toEqual([
      'https://player.example/play',
      'https://cdn.example/builds/abc123/index.html',
      UNITY_SAME_ORIGIN_INDEX,
    ]);
  });

  it('normalizes a trailing slash and keeps an existing one', () => {
    expect(resolveUnityBuildBaseUrl({ NEXT_PUBLIC_UNITY_BUILD_BASE_URL: 'https://cdn.example/b' })).toBe(
      'https://cdn.example/b/',
    );
    expect(resolveUnityBuildBaseUrl({ NEXT_PUBLIC_UNITY_BUILD_BASE_URL: 'https://cdn.example/b/' })).toBe(
      'https://cdn.example/b/',
    );
    expect(resolveUnityBuildBaseUrl({ NEXT_PUBLIC_UNITY_BUILD_BASE_URL: 'https://cdn.example' })).toBe(
      'https://cdn.example/',
    );
  });

  it('an invalid base resolves to null and never reaches the candidates', () => {
    const bad = [
      'not a url',
      '/unity-client',
      'ftp://cdn.example/b',
      'https://user:pass@cdn.example/b',
      'https://cdn.example/b?x=1',
      'https://cdn.example/b#frag',
      '   ',
    ];
    for (const value of bad) {
      const env = { NEXT_PUBLIC_UNITY_BUILD_BASE_URL: value };
      expect(resolveUnityBuildBaseUrl(env)).toBeNull();
      expect(unityPlayerCandidatesFromEnv(env)).toEqual([UNITY_SAME_ORIGIN_INDEX]);
    }
  });

  it('dedupes when the override already is the CDN index', () => {
    const env = {
      NEXT_PUBLIC_UNITY_WEBGL_URL: 'https://cdn.example/b/index.html',
      NEXT_PUBLIC_UNITY_BUILD_BASE_URL: 'https://cdn.example/b/',
    };
    expect(unityPlayerCandidatesFromEnv(env)).toEqual([
      'https://cdn.example/b/index.html',
      UNITY_SAME_ORIGIN_INDEX,
    ]);
  });

  it('the legacy CONCORDIA_UNITY_URL alias still works as the override', () => {
    expect(unityPlayerCandidatesFromEnv({ NEXT_PUBLIC_CONCORDIA_UNITY_URL: 'https://old.example/x' })).toEqual([
      'https://old.example/x',
      UNITY_SAME_ORIGIN_INDEX,
    ]);
  });
});
