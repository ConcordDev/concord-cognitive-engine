import { describe, expect, it } from 'vitest';
import {
  absoluteHttpUrlError,
  apiKeyError,
  artifactTitleError,
  dependencyPctError,
  httpsUrlError,
  parseCsvList,
  sceneLocationError,
  tournamentTitleError,
} from '@/lib/form-guards';

describe('form guards', () => {
  it('refuses a scene location longer than 120 and keeps a short one', () => {
    expect(sceneLocationError('L'.repeat(121))).toMatch(/120/);
    expect(sceneLocationError('Stage 4')).toBeNull();
  });

  it('refuses a gallery image that is not an absolute http(s) link', () => {
    expect(absoluteHttpUrlError('not-a-url')).toMatch(/http/);
    expect(absoluteHttpUrlError('/lenses/not-a-url')).toMatch(/http/);
    expect(absoluteHttpUrlError('javascript:alert(1)')).toMatch(/http/);
    expect(absoluteHttpUrlError('https://cdn.example/a.jpg')).toBeNull();
    expect(absoluteHttpUrlError('')).toBeNull();
  });

  it('refuses a webhook that is not https', () => {
    expect(httpsUrlError('not-a-url')).toMatch(/https/);
    expect(httpsUrlError('http://example.com/hook')).toMatch(/https/);
    expect(httpsUrlError('https://example.com/hook')).toBeNull();
  });

  it('trims an API key and refuses spaces and a 500-character string', () => {
    expect(apiKeyError('  sk-live-1234  ')).toBeNull();
    expect(apiKeyError('sk-qa zt1 fake 0000')).toMatch(/spaces/);
    expect(apiKeyError('k'.repeat(500))).toMatch(/256/);
    expect(apiKeyError('', { allowBlank: true })).toBeNull();
  });

  it('keeps both capability terms around a comma', () => {
    const a = parseCsvList('x, y');
    const b = parseCsvList('y, z');
    expect(a).toEqual(['x', 'y']);
    expect(b.filter((term) => a.includes(term))).toEqual(['y']);
  });

  it('refuses a dependency outside 0 to 100', () => {
    expect(dependencyPctError('-5')).toMatch(/0 and 100/);
    expect(dependencyPctError('99999999999')).toMatch(/0 and 100/);
    expect(dependencyPctError('40')).toBeNull();
  });

  it('refuses tournament and aviation titles that the server will not store whole', () => {
    expect(tournamentTitleError('T'.repeat(347))).toMatch(/120/);
    expect(tournamentTitleError('Cup')).toBeNull();
    expect(artifactTitleError('A'.repeat(600))).toMatch(/200/);
    expect(artifactTitleError('KJFK hop')).toBeNull();
  });
});
