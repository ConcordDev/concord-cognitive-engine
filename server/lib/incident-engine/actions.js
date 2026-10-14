// Bounded recovery + telegram — async so they don't hold a sync slice.
// Mirrors execute_recovery / send_telegram in incident-engine.py.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const ALERT_TELEGRAM_CHAT =
  process.env.CONCORD_OPS_CHAT_ID || "6776710732";

function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({ ok: false, code: -1, stdout, stderr, detail: "recovery_timeout" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: -1,
        stdout,
        stderr,
        detail: e.code === "ENOENT" ? `${cmd}_not_found` : e.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code: code ?? -1, stdout, stderr, detail: null });
    });
  });
}

export async function sendTelegram(message) {
  const r = await runCmd(
    "imsg",
    ["send", "--chat-id", ALERT_TELEGRAM_CHAT, "--text", message],
    15_000,
  );
  return r.ok;
}

export async function executeRecovery(recoveryAction, signal, _traceId) {
  const start = Date.now();
  try {
    if (recoveryAction === "re_run_browser_organ") {
      const script = "/Users/dutch/.hermes/dila-tools/scripts/browser_organ_tick.sh";
      if (!existsSync(script)) {
        return {
          ok: false,
          detail: "browser_organ_tick_script_missing",
          duration_ms: Date.now() - start,
          verified: false,
          verify_detail: "script_missing",
        };
      }
      const r = await runCmd(script, [], 120_000);
      return {
        ok: r.ok,
        detail: `exit=${r.code} stdout=${(r.stdout || "").slice(0, 200)}`,
        duration_ms: Date.now() - start,
        verified: r.ok,
        verify_detail: r.ok ? "script_ok" : "script_failed",
      };
    }
    if (recoveryAction === "retry_telegram") {
      const message = signal?.message || "Incident retry test";
      const sent = await sendTelegram(`🔁 [Incident/retry] ${message}`);
      return {
        ok: sent,
        detail: sent ? "exit=0" : "send_failed",
        duration_ms: Date.now() - start,
        verified: sent,
        verify_detail: sent ? "telegram_message_sent" : "send_failed",
      };
    }
    if (recoveryAction === "restart_daemon") {
      const daemonName = signal?.daemon_name;
      if (!daemonName) {
        return {
          ok: false,
          detail: "missing_daemon_name",
          duration_ms: Date.now() - start,
          verified: false,
          verify_detail: "missing_daemon_name",
        };
      }
      const plist = `/Users/dutch/Library/LaunchAgents/${daemonName}.plist`;
      await runCmd("launchctl", ["unload", plist], 10_000);
      const load = await runCmd("launchctl", ["load", plist], 10_000);
      return {
        ok: load.ok,
        detail: load.ok ? `restarted ${daemonName}` : `restart_failed`,
        duration_ms: Date.now() - start,
        verified: load.ok,
        verify_detail: load.ok ? "loaded" : "load_failed",
      };
    }
    return {
      ok: false,
      detail: `unknown_recovery: ${recoveryAction}`,
      duration_ms: Date.now() - start,
      verified: false,
      verify_detail: "unknown",
    };
  } catch (e) {
    return {
      ok: false,
      detail: `recovery_error: ${String(e?.message || e).slice(0, 200)}`,
      duration_ms: Date.now() - start,
      verified: false,
      verify_detail: "error",
    };
  }
}
