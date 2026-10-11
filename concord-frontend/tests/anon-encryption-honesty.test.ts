// @vitest-environment node
/**
 * Anonymous lens encryption claim.
 * The UI sources must not contain "end-to-end". That sentence is returned
 * only when claimEndToEnd is true (flag on, every member client-held), and
 * the send payload for that path has no plaintext and no private key.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anonEncryptionNotice, claimEndToEnd } from '@/lib/anon/encryption-copy';
import {
  buildAnonSendPayload,
  buildIdentityParams,
  createClientKeyPair,
  openSealed,
  sealEnvelopes,
} from '@/lib/anon/client-e2e';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(relDir: string): string[] {
  const dir = path.join(root, relDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => path.join(dir, name));
}

describe('anon lens encryption honesty', () => {
  it('does not hardcode an end-to-end claim in the Anonymous lens UI', () => {
    const files = [...sourceFiles('app/lenses/anon'), ...sourceFiles('components/anon')];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src.toLowerCase(), file).not.toContain('end-to-end');
    }
    const messenger = readFileSync(path.join(root, 'components/anon/AnonMessenger.tsx'), 'utf8');
    expect(messenger).toContain('claimEndToEnd(');
    expect(messenger).toContain('anonEncryptionNotice(e2eClaim)');
    expect(messenger).toContain('buildAnonSendPayload(');
    expect(messenger).not.toContain('anonEncryptionNotice(true)');
  });

  it('keeps the end-to-end sentence off unless every key is client-held', () => {
    expect(anonEncryptionNotice(false).body.toLowerCase()).not.toContain('end-to-end');
    expect(anonEncryptionNotice(false).badge).toBeNull();
    expect(claimEndToEnd({
      flagOn: false,
      myKeyCustody: 'client',
      members: [{ keyCustody: 'client' }],
    })).toBe(false);
    expect(claimEndToEnd({
      flagOn: true,
      myKeyCustody: 'server',
      members: [{ keyCustody: 'client' }],
    })).toBe(false);
    expect(claimEndToEnd({
      flagOn: true,
      myKeyCustody: 'client',
      members: [{ keyCustody: 'server' }],
    })).toBe(false);
    expect(claimEndToEnd({
      flagOn: true,
      myKeyCustody: 'client',
      members: [],
    })).toBe(false);

    const off = buildAnonSendPayload({
      clientHeld: false,
      conversationId: 'dm1',
      draft: 'hello server',
      sealedSender: false,
      envelopes: null,
    });
    expect(off.content).toBe('hello server');
  });

  it('says end-to-end only when the flag claim is on, and the request payload has no plaintext', async () => {
    const claim = claimEndToEnd({
      flagOn: true,
      myKeyCustody: 'client',
      members: [{ keyCustody: 'client' }, { keyCustody: 'client' }],
    });
    expect(claim).toBe(true);
    const notice = anonEncryptionNotice(claim);
    expect(notice.body.toLowerCase()).toContain('end-to-end');
    expect(notice.badge?.toLowerCase()).toContain('end-to-end');

    const alice = await createClientKeyPair();
    const bob = await createClientKeyPair();
    const secret = 'secret hello from the browser';
    const envelopes = await sealEnvelopes(
      alice.privateKeyPkcs8B64,
      [
        { anonId: 'aid-alice', publicKey: alice.publicKeySpkiB64 },
        { anonId: 'aid-bob', publicKey: bob.publicKeySpkiB64 },
      ],
      secret,
    );
    const payload = buildAnonSendPayload({
      clientHeld: true,
      conversationId: 'dm-client',
      draft: secret,
      sealedSender: false,
      envelopes,
    });

    expect(payload).not.toHaveProperty('content');
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain(secret);
    expect(wire).not.toContain(alice.privateKeyPkcs8B64);
    expect(wire).not.toContain(bob.privateKeyPkcs8B64);

    const identityBody = buildIdentityParams(true, alice);
    expect(identityBody).toEqual({ publicKey: alice.publicKeySpkiB64 });
    expect(JSON.stringify(identityBody)).not.toContain(alice.privateKeyPkcs8B64);

    expect(await openSealed(bob.privateKeyPkcs8B64, alice.publicKeySpkiB64, envelopes['aid-bob'])).toBe(secret);
    expect(await openSealed(alice.privateKeyPkcs8B64, alice.publicKeySpkiB64, envelopes['aid-alice'])).toBe(secret);
  });
});
