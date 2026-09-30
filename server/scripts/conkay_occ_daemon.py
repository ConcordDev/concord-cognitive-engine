#!/usr/bin/env python3
"""ConKay OCC daemon — long-lived warm OpenCascade process.

Concurrency Refactor Phase 2 (audit finding: OCC execFile 60s stacking).

`occ-bridge.js` used to `execFile(python, [conkay_occ_cli.py, cmd, json])` per
request — a cold Python + `import OCP` (~0.7s) on every call, and under a burst
of feature-rebuilds those processes STACK (fork storm + memory) because nothing
serialises them and OpenCascade is not reentrant.

This daemon imports `conkay_occ_cli` ONCE, then serves its `COMMANDS` table over
a Unix-domain-socket HTTP API. All OCC work runs under a single lock (OCC is not
thread-safe) with a per-job timeout. Node talks to it via the same fail-soft
pattern as the Go sidecar; if the daemon is down Node falls back to the cold
`execFile` path unchanged.

  POST /v1/occ      {"cmd": "...", "payload": {...}, "timeoutMs": 60000}  -> command result dict
  GET  /v1/health   -> {"ok": true, "commands": [...], "busy": bool, "served": N}

Socket: $CONCORD_OCC_DAEMON_SOCK
        (default /Users/dutch/concord/run/concord-occ-daemon.sock)
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingUnixStreamServer

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

import conkay_occ_cli as occ  # noqa: E402  (pays the OCP import cost once, at boot)

DEFAULT_SOCK = "/Users/dutch/concord/run/concord-occ-daemon.sock"
SOCK = os.environ.get("CONCORD_OCC_DAEMON_SOCK", DEFAULT_SOCK)
MAX_TIMEOUT_MS = 300_000
DEFAULT_TIMEOUT_MS = 60_000

# OpenCascade is not reentrant — every job runs single-file through this executor.
_occ_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="occ")
_stats_lock = threading.Lock()
_stats = {"served": 0, "errors": 0, "busy": False, "started_at": time.time()}


def _run_command(cmd: str, payload: dict) -> dict:
    fn = occ.COMMANDS.get(cmd)
    if not fn:
        return {"ok": False, "reason": "unknown_command", "command": cmd,
                "commands": sorted(set(occ.COMMANDS))}
    try:
        return fn(payload or {})
    except Exception as e:  # mirror the CLI's own cli_exception shape
        return {"ok": False, "reason": "cli_exception", "error": str(e),
                "trace": traceback.format_exc()[-1200:]}


def dispatch(cmd: str, payload: dict, timeout_ms: int) -> dict:
    timeout_ms = max(1_000, min(int(timeout_ms or DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS))
    with _stats_lock:
        _stats["busy"] = True
    t0 = time.time()
    try:
        fut = _occ_pool.submit(_run_command, cmd, payload)
        result = fut.result(timeout=timeout_ms / 1000.0)
    except FutureTimeout:
        # the worker thread keeps running (Python can't kill it); the next job
        # queues behind it. launchd KeepAlive restarts us if the box wedges.
        result = {"ok": False, "reason": "occ_daemon_timeout", "command": cmd,
                  "timeoutMs": timeout_ms}
    except Exception as e:
        result = {"ok": False, "reason": "occ_daemon_dispatch_error", "error": str(e)}
    finally:
        with _stats_lock:
            _stats["busy"] = False
            _stats["served"] += 1
            if not (isinstance(result, dict) and result.get("ok")):
                _stats["errors"] += 1
    if isinstance(result, dict):
        result.setdefault("_daemon", {})["ms"] = round((time.time() - t0) * 1000)
    return result


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_a):  # quiet; launchd captures stderr for real errors
        pass

    def _send(self, status: int, obj: dict) -> None:
        body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/v1/health":
            with _stats_lock:
                st = dict(_stats)
            self._send(200, {
                "ok": True,
                "service": "concord-occ-daemon",
                "uptimeSec": int(time.time() - st["started_at"]),
                "served": st["served"],
                "errors": st["errors"],
                "busy": st["busy"],
                "commands": sorted(set(occ.COMMANDS)),
            })
            return
        self._send(404, {"ok": False, "reason": "not_found"})

    def do_POST(self):
        if self.path != "/v1/occ":
            self._send(404, {"ok": False, "reason": "not_found"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            msg = json.loads(raw or b"{}")
        except Exception as e:
            self._send(400, {"ok": False, "reason": "bad_json", "error": str(e)})
            return
        cmd = msg.get("cmd") or msg.get("command") or "probe"
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        timeout_ms = msg.get("timeoutMs") or DEFAULT_TIMEOUT_MS
        result = dispatch(cmd, payload, timeout_ms)
        self._send(200, result)


def main() -> int:
    os.makedirs(os.path.dirname(SOCK), exist_ok=True)
    try:
        os.unlink(SOCK)
    except FileNotFoundError:
        pass

    class Server(ThreadingUnixStreamServer):
        daemon_threads = True
        allow_reuse_address = True

    httpd = Server(SOCK, Handler)
    try:
        os.chmod(SOCK, 0o600)
    except OSError:
        pass

    # warm the kernel so the first real request isn't the one paying import cost
    try:
        occ.probe()
    except Exception:
        pass

    print(f"concord-occ-daemon listening on unix:{SOCK} "
          f"({len(set(occ.COMMANDS))} commands)", file=sys.stderr, flush=True)
    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.shutdown()
        _occ_pool.shutdown(wait=False, cancel_futures=True)
        try:
            os.unlink(SOCK)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
