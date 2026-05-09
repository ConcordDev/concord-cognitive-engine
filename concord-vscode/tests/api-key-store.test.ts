// concord-vscode/tests/api-key-store.test.ts
//
// Smoke tests for the API key store. Uses an in-memory SecretStorage
// shim — VS Code's actual SecretStorage is provided by the host. We
// don't need @vscode/test-electron for this layer.
//
// Run from concord-vscode/: `npx tsx tests/api-key-store.test.ts`
// (or wire up @vscode/test-electron later for the full integration suite).

import assert from "node:assert/strict";
import { ApiKeyStore } from "../src/auth/api-key-store";

class InMemorySecretStorage {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.map.get(key); }
  async store(key: string, value: string): Promise<void> { this.map.set(key, value); }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  // VS Code SecretStorage also has onDidChange; not required for these tests.
  onDidChange = (() => ({ dispose() { /* noop */ } })) as never;
}

async function run(): Promise<void> {
  const secrets = new InMemorySecretStorage() as unknown as import("vscode").SecretStorage;
  const store = new ApiKeyStore(secrets);

  // get() returns undefined when no key set
  assert.equal(await store.get(), undefined);

  // set() rejects bad format
  await assert.rejects(() => store.set("bogus_key"), /invalid_key_format/);
  await assert.rejects(() => store.set(""), /invalid_key_format/);

  // set() accepts csk_* keys
  await store.set("csk_abc123");
  assert.equal(await store.get(), "csk_abc123");

  // set() overwrites
  await store.set("csk_new456");
  assert.equal(await store.get(), "csk_new456");

  // clear() deletes
  await store.clear();
  assert.equal(await store.get(), undefined);

  console.log("ok ApiKeyStore");
}

run().catch((err) => { console.error(err); process.exit(1); });
