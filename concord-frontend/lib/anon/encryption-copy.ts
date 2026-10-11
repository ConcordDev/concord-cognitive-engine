/**
 * User-facing encryption claims for the Anonymous lens.
 *
 * The default path is server-readable: Concord generates the X25519 keypair,
 * stores the private key, and receives plaintext before sealing it. The
 * "end-to-end" sentence is returned only when `clientE2E` is true, which the
 * messenger sets only for a thread whose keys all stay on participants'
 * devices and whose send payload carries ciphertext, not plaintext.
 */

export const SERVER_READABLE_NOTICE =
  "Encrypted in transit and stored encrypted on Concord's server; Concord can technically read these";

export function anonEncryptionNotice(clientE2E: boolean): { badge: string | null; body: string } {
  if (clientE2E) {
    return {
      badge: "End-to-end",
      body: "Messages are X25519 + AES-256-GCM end-to-end encrypted. Your private key stays in this browser; Concord stores only public keys and ciphertext.",
    };
  }
  return { badge: null, body: SERVER_READABLE_NOTICE };
}

export function claimEndToEnd(opts: {
  flagOn: boolean;
  myKeyCustody: "client" | "server" | null;
  members: { keyCustody?: string | null }[];
}): boolean {
  if (!opts.flagOn) return false;
  if (opts.myKeyCustody !== "client") return false;
  if (!opts.members.length) return false;
  return opts.members.every((m) => m.keyCustody === "client");
}
