// FIX-app-maker-001 S3 — the parent-side handler for preview bridge
// messages. The preview frame runs the platform runtime under an opaque
// origin (sandbox="allow-scripts", no allow-same-origin): it holds no
// credentials and can only ask. This handler is the entire trust surface:
//
//  - a message is considered ONLY when its source is the preview frame's
//    own contentWindow — anything else is not ours and is dropped silently;
//  - the payload must match the strict am-bridge schema (kind, version,
//    requestId, the previewed project's id, an allowlisted table action,
//    a bounded table name and config);
//  - valid requests are forwarded to the server previewBridge action,
//    which re-validates everything under the owner's own session;
//  - every outcome is answered with an am-bridge-reply so the runtime can
//    speak it in the preview instead of failing silently.

export type PreviewBridgeRun = (
  name: string,
  params: Record<string, unknown>,
) => Promise<{ ok: boolean; result: unknown; error: string | null }>;

export interface PreviewBridgeReply {
  kind: "am-bridge-reply";
  v: 1;
  requestId: string;
  ok: boolean;
  error?: string;
  table?: string;
  rows?: unknown[];
}

export const PREVIEW_BRIDGE_ACTIONS = ["create_row", "update_row", "delete_row"] as const;
const MAX_TABLE_CHARS = 120;
const MAX_CONFIG_CHARS = 16384;

interface BridgeMessage {
  kind?: unknown;
  v?: unknown;
  requestId?: unknown;
  projectId?: unknown;
  action?: unknown;
  table?: unknown;
  config?: unknown;
}

export async function handlePreviewBridgeMessage(args: {
  source: unknown;
  frameWindow: unknown;
  data: unknown;
  projectId: string;
  sessionId: string;
  run: PreviewBridgeRun;
  reply: (r: PreviewBridgeReply) => void;
}): Promise<boolean> {
  const { source, frameWindow, data, projectId, sessionId, run, reply } = args;
  if (!frameWindow || source !== frameWindow) return false;
  if (!data || typeof data !== "object") return false;
  const d = data as BridgeMessage;
  if (d.kind !== "am-bridge" || d.v !== 1) return false;
  if (typeof d.requestId !== "string" || !d.requestId) return false;
  if (d.projectId !== projectId) return false;
  if (typeof d.table !== "string" || !d.table || d.table.length > MAX_TABLE_CHARS) return false;
  if (typeof d.action !== "string" || !(PREVIEW_BRIDGE_ACTIONS as readonly string[]).includes(d.action)) return false;
  const config = d.config && typeof d.config === "object" && !Array.isArray(d.config)
    ? (d.config as Record<string, unknown>)
    : {};
  if (JSON.stringify(config).length > MAX_CONFIG_CHARS) {
    reply({ kind: "am-bridge-reply", v: 1, requestId: d.requestId, ok: false, error: "bridge request too large" });
    return true;
  }
  try {
    const res = await run("previewBridge", {
      projectId,
      sessionId,
      action: d.action,
      table: d.table,
      config,
    });
    if (res?.ok) {
      const rows = (res.result as { rows?: unknown[] } | null)?.rows;
      reply({ kind: "am-bridge-reply", v: 1, requestId: d.requestId, ok: true, table: d.table, ...(Array.isArray(rows) ? { rows } : {}) });
    } else {
      reply({ kind: "am-bridge-reply", v: 1, requestId: d.requestId, ok: false, error: res?.error || "preview data store unavailable" });
    }
  } catch {
    reply({ kind: "am-bridge-reply", v: 1, requestId: d.requestId, ok: false, error: "preview data store unavailable" });
  }
  return true;
}
