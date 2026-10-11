#!/usr/bin/env node
// Generate an Ed25519 keypair for ConKay receipt signatures.
//
//   node scripts/generate-receipt-signing-key.mjs <path-to-private-key.pem>
//
// Writes a PKCS#8 PEM private key to the path you choose (mode 0600) and
// prints only the key id and the raw public key (base64). The private key
// is never printed. Do not commit the file.
//
//   CONCORD_RECEIPT_SIGNING_KEY_PATH=/secure/receipt-signing-key.pem
//
// Pass --force to replace an existing file.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2).filter((a) => a !== "--force");
const force = process.argv.includes("--force");
const dest = args[0];

if (!dest || dest.startsWith("-")) {
  console.error("usage: node scripts/generate-receipt-signing-key.mjs <path-to-private-key.pem> [--force]");
  process.exit(2);
}

const file = path.resolve(dest);
if (fs.existsSync(file) && !force) {
  console.error(`refusing to overwrite ${file} (pass --force)`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, pem, { mode: 0o600 });
fs.chmodSync(file, 0o600);

const der = publicKey.export({ format: "der", type: "spki" });
const raw = Buffer.from(der.subarray(der.length - 32));
const keyId = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);

const say = (line) => process.stdout.write(`${line}\n`);
say(`keyId: ${keyId}`);
say(`publicKey: ${raw.toString("base64")}`);
say(`wrote private key to ${file} (mode 0600)`);
say("Set CONCORD_RECEIPT_SIGNING_KEY_PATH to that path. Do not commit the file.");

const ignore = spawnSync("git", ["check-ignore", "-q", file], { encoding: "utf8" });
if (ignore.status !== 0) {
  say("warning: git is not ignoring this path. Keep the private key outside the repo.");
}
