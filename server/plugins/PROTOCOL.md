# Concord Plugin Protocol

Plugins extend the platform with new macros, lifecycle hooks, and per-tick logic. They run inside a sandboxed context — they cannot reach raw `STATE` or arbitrary `require`. The loader (`server/plugins/loader.js`) enforces a four-gate validation pipeline before activation.

## Anatomy

A plugin is one ES module file with these exports:

| Export | Required | Purpose |
|---|---|---|
| `id` | yes | Globally unique identifier in `namespace.name` format. Reserved namespaces (`concord.`, `system.`, `core.`) are blocked. |
| `name` | yes | Human-readable name for UI surfaces |
| `version` | yes | SemVer string |
| `description` | yes | One-paragraph description |
| `init(ctx)` | yes | Called once on load. Receives the sandbox context. Return `{ ok: true }` to activate. |
| `destroy()` | yes | Called on unload. Clear timers/listeners. |
| `macros` | no | Map of `"domain.action"` → handler. Each macro is exposed as `runMacro("domain", "action", input, ctx)`. |
| `hooks` | no | Map of lifecycle hook names → handler. See [Hooks](#hooks) below. |
| `tick(ctx)` | no | Called on every governorTick if present. Must return within 100ms or it gets killed. |
| `author`, `license`, `homepage` | no | Metadata for the plugin gallery |

## Sandbox context

`init(ctx)` and `tick(ctx)` receive a context object. The context is **read-only on STATE** — plugins must mutate only through whitelisted helpers.

```ts
interface PluginContext {
  // Logging
  log(level: "info" | "warn" | "error", msg: string, meta?: object): void;

  // DTU operations (validated, hook-aware)
  createDTU(dtu: { title: string; body: string; domain: string; tags?: string[] }): Promise<{ ok: boolean; dtu?: DTU }>;
  readDTU(id: string): DTU | null;
  searchDTUs(query: string, opts?: { limit?: number; domain?: string }): DTU[];

  // LLM access (queued, rate-limited, billed to plugin author)
  llm: {
    chat(prompt: string, opts?: { system?: string; maxTokens?: number }): Promise<string>;
  };

  // Storage (per-plugin namespaced, persisted to data/plugins/<plugin-id>/)
  storage: {
    get(key: string): any;
    set(key: string, value: any): void;
    delete(key: string): void;
  };

  // Schedule deferred work (queued; one-shot or recurring)
  schedule: {
    once(delayMs: number, fn: () => void): string;
    every(intervalMs: number, fn: () => void): string;
    cancel(id: string): void;
  };

  // Read-only state views
  state: {
    listLenses(): string[];
    listDomains(): string[];
    getMetrics(): { dtuCount: number; userCount: number };
  };
}
```

Anything not listed here (raw `STATE`, `db`, `require`, `process`, `fs`) is unreachable.

## Hooks

| Hook | Fired when | Payload |
|---|---|---|
| `dtu:beforeCreate` | Right before a new DTU is persisted | `{ dtu, ctx }` — return `{ block: true, reason }` to abort |
| `dtu:afterCreate` | After a new DTU is committed | `{ dtu }` |
| `dtu:beforeUpdate` | Before an existing DTU mutates | `{ dtuId, patch }` |
| `dtu:afterUpdate` | After mutation committed | `{ dtu, prev }` |
| `dtu:beforeDelete` | Before tombstoning (DTUs are never hard-deleted) | `{ dtuId }` |
| `dtu:afterDelete` | After tombstone applied | `{ dtuId }` |
| `macro:beforeExecute` | Before any macro runs | `{ domain, name, input }` — return `{ block, reason }` to abort |
| `macro:afterExecute` | After any macro returns | `{ domain, name, result, durationMs }` |

Hook handlers run synchronously in the same heartbeat. Async work goes through `ctx.schedule`.

## Validation gates

Every plugin runs through `validator.js` before activation:

1. **Static analysis** — banned globals, no `eval`, no `Function` constructor.
2. **Namespace check** — reserved prefixes blocked.
3. **Surface check** — declared macros / hooks must exist in the catalog.
4. **Resource check** — declared `tick()` budget ≤ 100ms.

Failed validation = plugin rejected; loader writes a structured log entry.

## Author vs emergent plugins

* **Author plugins** live in `server/plugins/installed/<plugin-id>/index.js`. Loaded at server boot. Reload via `POST /api/plugins/reload`.
* **Emergent-generated plugins** are produced by the substrate itself when a recurring pattern emerges. They require a council governance vote before activation. Source code is persisted to `server/plugins/emergent-gen/<plugin-id>/index.js`.

## Distribution

Author plugins can be packaged as a single file plus a `manifest.json` and shared via the marketplace (DTU type `plugin`). Installation auto-runs validation. We do not yet support plugin signing — all installed plugins are subject to the same four gates.

## Calling the plugin API from a client

```ts
import ConcordClient from "@concord/sdk";
const client = new ConcordClient(process.env.CONCORD_API_KEY!);

// Run a plugin macro
const r = await client.lens.run("myplugin", "summarize", { text: "..." });

// List loaded plugins
const r2 = await fetch("/api/plugins").then(x => x.json());
```

## Example plugins

* `templates/basic-plugin.js` — minimal "Hello world"
* `templates/emergent-gen-plugin.js` — emergent-generated plugin format
* `installed/example-knowledge-weather/index.js` — uses the intelligence views to publish a daily DTU summarizing knowledge weather (see that file for a full working example)
