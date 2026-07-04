/**
 * Concord — voice.tts per-request voice parameter (Unit B6)
 *
 * `voice.tts` (server.js) previously read the Piper synthesis model ONLY
 * from process.env.PIPER_VOICE — a per-request `input.voice` had no way
 * to steer synthesis. `server/lib/voice-piper-voice.js` is the extracted,
 * testable validator + resolver: `input.voice` is validated against a
 * closed allowlist (never a blocklist) before it can ever reach
 * `spawnSync` as a `--model` argument.
 *
 * Run: node --test tests/voice-tts-voice-param.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PIPER_VOICE_ID_RE,
  validatePiperVoiceId,
  resolvePiperVoice,
} from '../lib/voice-piper-voice.js';

describe('validatePiperVoiceId', () => {
  it('accepts well-formed Piper voice ids', () => {
    assert.equal(validatePiperVoiceId('en_US-amy-medium'), 'en_US-amy-medium');
    assert.equal(validatePiperVoiceId('en_GB-alan-low'), 'en_GB-alan-low');
    assert.equal(validatePiperVoiceId('de_DE-thorsten-x_low'), 'de_DE-thorsten-x_low');
    assert.equal(validatePiperVoiceId('fr_FR-siwis-high'), 'fr_FR-siwis-high');
  });

  it('rejects path traversal strings', () => {
    assert.equal(validatePiperVoiceId('../evil'), null);
    assert.equal(validatePiperVoiceId('../../etc/passwd'), null);
    assert.equal(validatePiperVoiceId('en_US-amy-medium/../../../etc/passwd'), null);
  });

  it('rejects shell-metacharacter strings', () => {
    assert.equal(validatePiperVoiceId('en_US-amy-medium; rm -rf /'), null);
    assert.equal(validatePiperVoiceId('$(whoami)'), null);
    assert.equal(validatePiperVoiceId('en_US-amy-medium`id`'), null);
    assert.equal(validatePiperVoiceId('en_US-amy-medium && cat /etc/passwd'), null);
    assert.equal(validatePiperVoiceId('en_US-amy-medium|cat'), null);
  });

  it('rejects malformed but plausible-looking ids', () => {
    assert.equal(validatePiperVoiceId('en_US-amy'), null); // missing quality suffix
    assert.equal(validatePiperVoiceId('enus-amy-medium'), null); // wrong locale shape
    assert.equal(validatePiperVoiceId('EN_US-amy-medium'), null); // wrong case on language
    assert.equal(validatePiperVoiceId('en_US-Amy-medium'), null); // uppercase in name segment
    assert.equal(validatePiperVoiceId('en_US-amy-superfast'), null); // invalid quality tier
  });

  it('empty and non-string inputs return null', () => {
    assert.equal(validatePiperVoiceId(''), null);
    assert.equal(validatePiperVoiceId(null), null);
    assert.equal(validatePiperVoiceId(undefined), null);
    assert.equal(validatePiperVoiceId(123), null);
    assert.equal(validatePiperVoiceId({}), null);
    assert.equal(validatePiperVoiceId([]), null);
  });

  it('the exported regex is the exact closed allowlist shape', () => {
    assert.equal(
      PIPER_VOICE_ID_RE.source,
      '^[a-z]{2}_[A-Z]{2}-[a-z0-9]+-(x_low|low|medium|high)$'
    );
  });
});

describe('resolvePiperVoice', () => {
  it('no requested voice, no env voice -> none', () => {
    const result = resolvePiperVoice({ requestedVoice: undefined, envVoice: '' });
    assert.deepEqual(result, { modelArg: '', voiceUsed: '', voiceFallback: 'none' });
  });

  it('no requested voice, env voice set -> uses env, no fallback flag', () => {
    const result = resolvePiperVoice({ requestedVoice: undefined, envVoice: 'en_US-amy-medium' });
    assert.deepEqual(result, {
      modelArg: 'en_US-amy-medium',
      voiceUsed: 'en_US-amy-medium',
      voiceFallback: null,
    });
  });

  it('valid requested voice, no voicesDir configured -> honored directly', () => {
    const result = resolvePiperVoice({
      requestedVoice: 'en_GB-alan-low',
      envVoice: 'en_US-amy-medium',
      voicesDir: '',
    });
    assert.deepEqual(result, {
      modelArg: 'en_GB-alan-low',
      voiceUsed: 'en_GB-alan-low',
      voiceFallback: null,
    });
  });

  it('invalid requested voice never reaches modelArg, falls back to env', () => {
    const result = resolvePiperVoice({
      requestedVoice: '../evil; rm -rf /',
      envVoice: 'en_US-amy-medium',
    });
    assert.deepEqual(result, {
      modelArg: 'en_US-amy-medium',
      voiceUsed: 'en_US-amy-medium',
      voiceFallback: 'env',
    });
  });

  it('invalid requested voice, no env voice -> none, empty modelArg', () => {
    const result = resolvePiperVoice({ requestedVoice: '$(id)', envVoice: '' });
    assert.deepEqual(result, { modelArg: '', voiceUsed: '', voiceFallback: 'none' });
  });

  it("voicesDir configured, requested voice's model file exists -> resolved path used", () => {
    const seen = [];
    const existsSync = (p) => {
      seen.push(p);
      return p === '/voices/en_GB-alan-low.onnx';
    };
    const result = resolvePiperVoice({
      requestedVoice: 'en_GB-alan-low',
      envVoice: 'en_US-amy-medium',
      voicesDir: '/voices',
      existsSync,
    });
    assert.deepEqual(result, {
      modelArg: '/voices/en_GB-alan-low.onnx',
      voiceUsed: 'en_GB-alan-low',
      voiceFallback: null,
    });
    assert.deepEqual(seen, ['/voices/en_GB-alan-low.onnx']);
  });

  it("voicesDir configured, requested voice's model file is absent -> honest env fallback", () => {
    const result = resolvePiperVoice({
      requestedVoice: 'en_GB-alan-low',
      envVoice: 'en_US-amy-medium',
      voicesDir: '/voices',
      existsSync: () => false,
    });
    assert.deepEqual(result, {
      modelArg: 'en_US-amy-medium',
      voiceUsed: 'en_US-amy-medium',
      voiceFallback: 'env',
    });
  });

  it('voicesDir configured but no existsSync injected fails closed (never open)', () => {
    const result = resolvePiperVoice({
      requestedVoice: 'en_GB-alan-low',
      envVoice: 'en_US-amy-medium',
      voicesDir: '/voices',
    });
    assert.deepEqual(result, {
      modelArg: 'en_US-amy-medium',
      voiceUsed: 'en_US-amy-medium',
      voiceFallback: 'env',
    });
  });

  it('path traversal requested voice with voicesDir configured never joins path', () => {
    const seen = [];
    const existsSync = (p) => {
      seen.push(p);
      return true; // even if something existed, an invalid id must never be joined/used
    };
    const result = resolvePiperVoice({
      requestedVoice: '../../etc/passwd',
      envVoice: 'en_US-amy-medium',
      voicesDir: '/voices',
      existsSync,
    });
    assert.deepEqual(result, {
      modelArg: 'en_US-amy-medium',
      voiceUsed: 'en_US-amy-medium',
      voiceFallback: 'env',
    });
    assert.deepEqual(seen, []);
  });
});
