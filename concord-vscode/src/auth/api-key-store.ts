// concord-vscode/src/auth/api-key-store.ts
//
// Persists the user's Concord API key in `vscode.SecretStorage` (OS
// keychain on macOS, Credential Manager on Windows, libsecret on Linux).
// Never logs the key. `concord.logout` deletes the entry.

import * as vscode from "vscode";

const KEY = "concord.apiKey";

export class ApiKeyStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(): Promise<string | undefined> {
    return this.secrets.get(KEY);
  }

  async set(rawKey: string): Promise<void> {
    if (!rawKey || !rawKey.startsWith("csk_")) {
      throw new Error("invalid_key_format");
    }
    await this.secrets.store(KEY, rawKey);
  }

  async clear(): Promise<void> {
    await this.secrets.delete(KEY);
  }
}
