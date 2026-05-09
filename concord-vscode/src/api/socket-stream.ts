// concord-vscode/src/api/socket-stream.ts
//
// Subscribe to the /dx Socket.IO namespace. The plugin connects, joins
// `codebase:${id}` rooms, and dispatches detector + repair events to
// the diagnostics provider + sidebar.

import { io as createSocket, type Socket } from "socket.io-client";

export type StreamEvent =
  | { kind: "detector:run.started";  payload: { runId: string; codebaseId: string; detectorIds?: string[]; consumer?: string | null } }
  | { kind: "detector:run.complete"; payload: { runId: string; codebaseId: string; durationMs?: number; summary?: unknown; totals?: unknown } }
  | { kind: "detector:finding.added"; payload: { runId: string; codebaseId: string; finding: Finding; detectorId?: string } }
  | { kind: "detector:finding.resolved"; payload: { runId: string; codebaseId: string; findingId: string } }
  | { kind: "repair:prophet.proposed"; payload: { repairId: string; codebaseId: string; finding: Finding; fix: unknown } }
  | { kind: "repair:surgeon.applied";  payload: { repairId: string; codebaseId: string; ok: boolean; refs?: unknown } }
  | { kind: "repair:decision.recorded"; payload: { repairId: string; codebaseId: string; decision: string } }
  | { kind: "codebase:evo_state_changed"; payload: { codebaseId: string; detectorId: string; ruleId: string; weight: number } };

export interface Finding {
  id: string;
  category?: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  message?: string;
  location?: string;
  subject?: { kind?: string; file?: string; line?: number };
  fixHint?: string | null;
}

export type StreamHandler = (ev: StreamEvent) => void;

export class DxSocketStream {
  private socket: Socket | null = null;
  private subscribed = new Set<string>();

  constructor(
    private readonly serverUrl: string,
    private readonly path: string,
    private readonly apiKey: string,
    private readonly onEvent: StreamHandler,
    private readonly onStatus: (status: { connected: boolean; reason?: string }) => void,
  ) {}

  connect(): void {
    if (this.socket) return;
    this.socket = createSocket(`${this.serverUrl}${this.path}`, {
      transports: ["websocket"],
      auth: { apiKey: this.apiKey },
      extraHeaders: { "x-api-key": this.apiKey },
    });

    this.socket.on("connect", () => {
      this.onStatus({ connected: true });
      // Re-join previously-subscribed codebases on reconnect.
      for (const codebaseId of this.subscribed) {
        this.socket?.emit("subscribe.codebase", { codebaseId });
      }
    });
    this.socket.on("disconnect", (reason) => this.onStatus({ connected: false, reason }));
    this.socket.on("connect_error", (err) => this.onStatus({ connected: false, reason: err.message }));

    const wire = (eventName: StreamEvent["kind"]) => {
      this.socket?.on(eventName, (payload: unknown) => {
        this.onEvent({ kind: eventName, payload } as StreamEvent);
      });
    };
    wire("detector:run.started");
    wire("detector:run.complete");
    wire("detector:finding.added");
    wire("detector:finding.resolved");
    wire("repair:prophet.proposed");
    wire("repair:surgeon.applied");
    wire("repair:decision.recorded");
    wire("codebase:evo_state_changed");
  }

  subscribeCodebase(codebaseId: string): void {
    this.subscribed.add(codebaseId);
    this.socket?.emit("subscribe.codebase", { codebaseId });
  }

  unsubscribeCodebase(codebaseId: string): void {
    this.subscribed.delete(codebaseId);
    this.socket?.emit("unsubscribe.codebase", { codebaseId });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.subscribed.clear();
  }
}
