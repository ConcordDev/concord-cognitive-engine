// concord-vscode/src/api/concord-client.ts
//
// REST client for the Concord macro endpoint. Mirrors the shape of the
// existing `concord-mobile/src/api/macro-client.ts` so server-side
// changes propagate without per-platform forks.
//
// All calls flow through `POST /api/lens/run` with
// `{ domain, name, input }`. The API key is sent as `x-api-key` header.

export interface MacroResult<T = unknown> {
  ok: boolean;
  reason?: string;
  [key: string]: unknown;
  __asT?: T; // type-only field; never sent on wire
}

export class ConcordClient {
  constructor(
    private readonly serverUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Call any (domain, name) macro. Throws on transport errors; returns
   * the server's `{ok: boolean, ...}` envelope on logical errors.
   */
  async run<T = unknown>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<MacroResult<T>> {
    const r = await fetch(`${this.serverUrl}/api/lens/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ domain, name, input }),
    });
    if (!r.ok) {
      throw new Error(`macro_http_${r.status}`);
    }
    return (await r.json()) as MacroResult<T>;
  }

  // ── Convenience wrappers for the macros the plugin actually calls ──

  async registerCodebase(repoRoot: string, detectorVersion?: string) {
    return this.run<{ codebaseId: string; created: boolean }>(
      "dx", "register_codebase",
      { repoRoot, detectorVersion },
    );
  }

  async upsertShadow(codebaseId: string, path: string, content: string, tags: string[] = []) {
    return this.run<{ id: string; deduped: boolean; contentHash: string }>(
      "dx", "upsert_shadow",
      { codebaseId, path, content, tags },
    );
  }

  async runDetector(id: string, codebaseId?: string, opts: Record<string, unknown> = {}) {
    return this.run<{ report: unknown; runId: string }>(
      "detectors", "run",
      { id, codebaseId, opts },
    );
  }

  async runAllDetectors(codebaseId?: string, consumer?: string) {
    return this.run<{ report: unknown; runId: string }>(
      "detectors", "runAll",
      { codebaseId, consumer },
    );
  }

  async recordFixDecision(args: {
    codebaseId: string;
    repairId?: string;
    detectorId: string;
    ruleId: string;
    decision: "accepted" | "rejected" | "ignored";
    detectorVersion?: string;
  }) {
    return this.run("dx", "record_fix_decision", args);
  }

  async getCurrentQuota() {
    return this.run<{ quotas: Array<{ domain: string; macroName: string; remaining: number; limit: number }> }>(
      "billing", "getCurrentQuota", {},
    );
  }

  async getBalance() {
    return this.run<{ balance: number }>("billing", "balance", {});
  }
}
