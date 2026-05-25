// server/lib/code-liveshare-bus.js
//
// Live Share extension layer: pub-sub bus for shared debugger awareness
// + shared terminal I/O.
//
// The server is purely a relay. It does NOT run debuggers or PTYs; it
// forwards events between every client in the same `code:liveshare:${code}`
// room so participants see each other's breakpoints, current execution
// line, and terminal traffic in real time. This mirrors the VS Code Live
// Share "shared task" / "shared debug session" model, scoped to what's
// honestly implementable without a language-server-protocol stack.
//
// Events on the main Socket.IO connection:
//   liveshare:debug:breakpoint-set    { code, path, line, peerId? }
//   liveshare:debug:breakpoint-cleared{ code, path, line }
//   liveshare:debug:current-line      { code, path, line }   ← "I am paused here"
//   liveshare:debug:state             { code, state: 'running'|'paused'|'stopped' }
//   liveshare:terminal:input          { code, terminalId, data }
//   liveshare:terminal:output         { code, terminalId, data }
//   liveshare:terminal:resize         { code, terminalId, cols, rows }
//
// All events require `code` (the session code). The server stamps
// `fromPeerId: socket.id` on every relayed event so receivers can
// distinguish their own echoes from peer events.
//
// A small in-memory state per session tracks active breakpoints so
// late-joining clients can request `liveshare:debug:state-request` and
// receive the current breakpoint set as `liveshare:debug:state-snapshot`.
// Terminal state is NOT persisted — late joiners get a fresh view; the
// historical scrollback lives on each client.

// session code → { breakpoints: Set<"path:line">, currentLine: { path, line, peerId } | null }
const STATE = new Map();

function getState(code) {
  let s = STATE.get(code);
  if (!s) {
    s = { breakpoints: new Set(), currentLine: null };
    STATE.set(code, s);
  }
  return s;
}

/** Drop a session's bus state — call when a Live Share session ends. */
export function disposeSession(code) {
  STATE.delete(code);
}

/** Diagnostics. */
export function stats() {
  const out = {};
  for (const [code, s] of STATE) {
    out[code] = { breakpoints: s.breakpoints.size, currentLine: s.currentLine };
  }
  return out;
}

/**
 * Wire the debug + terminal bus into the existing Socket.IO `io` instance.
 * Idempotent — safe to call once at boot.
 */
export function attachLiveShareBus(io) {
  if (!io || typeof io.on !== "function") return;
  io.on("connection", (socket) => {
    const roomFor = (code) => `code:liveshare:${code}`;

    // ── Debugger awareness ────────────────────────────────────────────
    socket.on("liveshare:debug:breakpoint-set", ({ code, path, line } = {}) => {
      if (!code || !path || typeof line !== "number") return;
      const s = getState(String(code));
      s.breakpoints.add(`${path}:${line}`);
      socket.to(roomFor(code)).emit("liveshare:debug:breakpoint-set", {
        code, path, line, fromPeerId: socket.id,
      });
    });
    socket.on("liveshare:debug:breakpoint-cleared", ({ code, path, line } = {}) => {
      if (!code || !path || typeof line !== "number") return;
      const s = getState(String(code));
      s.breakpoints.delete(`${path}:${line}`);
      socket.to(roomFor(code)).emit("liveshare:debug:breakpoint-cleared", {
        code, path, line, fromPeerId: socket.id,
      });
    });
    socket.on("liveshare:debug:current-line", ({ code, path, line } = {}) => {
      if (!code || typeof line !== "number") return;
      const s = getState(String(code));
      s.currentLine = { path: String(path || ""), line, peerId: socket.id };
      socket.to(roomFor(code)).emit("liveshare:debug:current-line", {
        code, path, line, fromPeerId: socket.id,
      });
    });
    socket.on("liveshare:debug:state", ({ code, state } = {}) => {
      if (!code || !state) return;
      socket.to(roomFor(code)).emit("liveshare:debug:state", {
        code, state, fromPeerId: socket.id,
      });
    });
    socket.on("liveshare:debug:state-request", ({ code } = {}) => {
      if (!code) return;
      const s = getState(String(code));
      // Translate the Set of "path:line" strings into structured rows so
      // the client can render directly without re-parsing.
      const breakpoints = [];
      for (const key of s.breakpoints) {
        const idx = key.lastIndexOf(":");
        if (idx < 0) continue;
        const path = key.slice(0, idx);
        const line = Number(key.slice(idx + 1));
        if (Number.isFinite(line)) breakpoints.push({ path, line });
      }
      socket.emit("liveshare:debug:state-snapshot", {
        code, breakpoints, currentLine: s.currentLine,
      });
    });

    // ── Terminal sharing ──────────────────────────────────────────────
    // The server is a pure relay: it doesn't spawn PTYs. The "host" of
    // the terminal runs the process locally and broadcasts output;
    // participants broadcast input back. This matches Live Share's
    // shared-terminal model.
    socket.on("liveshare:terminal:input", ({ code, terminalId, data } = {}) => {
      if (!code || !terminalId || typeof data !== "string") return;
      socket.to(roomFor(code)).emit("liveshare:terminal:input", {
        code, terminalId, data, fromPeerId: socket.id,
      });
    });
    socket.on("liveshare:terminal:output", ({ code, terminalId, data } = {}) => {
      if (!code || !terminalId || typeof data !== "string") return;
      socket.to(roomFor(code)).emit("liveshare:terminal:output", {
        code, terminalId, data, fromPeerId: socket.id,
      });
    });
    socket.on("liveshare:terminal:resize", ({ code, terminalId, cols, rows } = {}) => {
      if (!code || !terminalId) return;
      socket.to(roomFor(code)).emit("liveshare:terminal:resize", {
        code, terminalId,
        cols: Number(cols) || 80,
        rows: Number(rows) || 24,
        fromPeerId: socket.id,
      });
    });
  });
}
