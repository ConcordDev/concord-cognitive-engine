'use client';

import { useState, useRef, useEffect, useCallback, KeyboardEvent, FormEvent } from 'react';
import { api } from '@/lib/api/client';

interface LogEntry {
  type: 'input' | 'output' | 'error' | 'system' | 'success';
  text: string;
  timestamp: string;
}

interface PulseData {
  dtus?: { total?: number };
  process?: { rss?: string; heapUsed?: string; uptimeHuman?: string };
}

const HELP_TEXT = `Available commands:

  DTU Operations:
    create <content>       — Create sovereign DTU
    promote <id> [tier]    — Promote DTU tier
    modify <id> <json>     — Modify DTU fields
    delete <id>            — Delete DTU
    inspect <id>           — Inspect DTU
    search <query>         — Search all DTUs
    count                  — DTU count

  System:
    pulse / status / ps    — System overview
    freeze                 — Freeze all autonomous jobs
    thaw                   — Thaw frozen jobs
    pipeline               — Force autogen pipeline
    dream [seed]           — Force dream synthesis
    gc                     — Force garbage collection
    broadcast <msg>        — Broadcast to lattice
    config <key> <val>     — Set config value
    toggle <job> [off]     — Toggle job on/off
    eval <js> / js <code>  — Evaluate JS in server context
    audit [n] / history    — View sovereign audit trail

  Qualia:
    qualia <id>            — View entity qualia state
    qualia-summary         — All entities qualia overview
    activate-os <id> <os>  — Activate OS for entity
    deactivate-os <id> <os> — Deactivate OS for entity
    inject-qualia <id> <ch> <val> — Set qualia channel

  Council:
    council-voices [dtuId] — All voices / vote analysis for DTU
    voice <voiceId>        — Voice definition (skeptic/socratic/opposer/idealist/pragmatist)

  Species:
    species [entityId]     — Classify entity or list all
    species-all            — Full census with species breakdown

  Reproduction:
    reproduce <e1> <e2>    — Attempt reproduction between entities
    reproduction-policy <enable|disable> — Toggle autonomous reproduction
    lineage <entityId>     — Show full ancestry tree
    lineage-tree           — Show all entities with parent relationships

  Simulation:
    simulate <id> [json]   — Run dual-path simulation (human vs concordos)
    simulations [n]        — List recent simulations
    sim-compare <simId>    — Detailed comparison

  Safety:
    vulnerability <msg>    — Detect emotional vulnerability in text

  Meta:
    help / ?               — Show this help
    clear / cls            — Clear log`;

function SovereignRequired() {
  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center space-y-4 p-8 bg-lattice-surface rounded-xl border border-red-500/20">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
          <span className="text-3xl">⛔</span>
        </div>
        <h2 className="text-xl font-bold text-white">Sovereign Access Required</h2>
        <p className="text-sm text-gray-400">
          The Developer Console is restricted to the sovereign account. Regular users cannot access
          system-level controls.
        </p>
      </div>
    </div>
  );
}

export default function DevConsolePage() {
  const [accessChecked, setAccessChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([
    {
      type: 'system',
      text: '◆ SOVEREIGN DEV CONSOLE — authority: 1.0',
      timestamp: new Date().toISOString(),
    },
    {
      type: 'system',
      text: 'Type "help" for available commands.',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pulse, setPulse] = useState<PulseData | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // Focus input on mount
  useEffect(() => {
    if (hasAccess) inputRef.current?.focus();
  }, [hasAccess]);

  // Check sovereign access, then fetch pulse on mount
  useEffect(() => {
    api
      .get('/api/sovereign/pulse')
      .then((r) => {
        setHasAccess(true);
        setAccessChecked(true);
        setPulse(r.data);
      })
      .catch(() => {
        setHasAccess(false);
        setAccessChecked(true);
      });

    const interval = setInterval(() => {
      api
        .get('/api/sovereign/pulse')
        .then((r) => setPulse(r.data))
        .catch((e) => console.error('[Dev] Failed to fetch pulse:', e));
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const addLog = useCallback((type: LogEntry['type'], text: string) => {
    setLog((prev) => [...prev, { type, text, timestamp: new Date().toISOString() }]);
  }, []);

  const executeCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;

      addLog('input', `sovereign > ${trimmed}`);
      setHistory((prev) => [trimmed, ...prev.slice(0, 99)]);
      setHistoryIndex(-1);
      setExecuting(true);

      try {
        // Local commands
        if (trimmed === 'help' || trimmed === '?') {
          addLog('system', HELP_TEXT);
          setExecuting(false);
          return;
        }

        if (trimmed === 'clear' || trimmed === 'cls') {
          setLog([]);
          setExecuting(false);
          return;
        }

        // Parse command
        const parts = trimmed.split(/\s+/);
        const command = parts[0].toLowerCase();
        const rest = trimmed.slice(command.length).trim();

        let response;

        // Route to API
        if (command === 'pulse' || command === 'status' || command === 'ps') {
          response = await api.get('/api/sovereign/pulse');
          if (response.data) setPulse(response.data);
        } else if (command === 'audit' || command === 'history') {
          const limit = parts[1] ? parseInt(parts[1], 10) : 50;
          response = await api.get('/api/sovereign/audit', { params: { limit } });
        } else if (command === 'eval' || command === 'js') {
          response = await api.post('/api/sovereign/eval', { code: rest });
        } else if (command === 'create') {
          response = await api.post('/api/sovereign/decree', {
            action: 'create-dtu',
            data: { content: rest },
          });
        } else if (command === 'promote') {
          const id = parts[1];
          const tier = parts[2];
          response = await api.post('/api/sovereign/decree', {
            action: 'promote-dtu',
            target: id,
            data: tier ? { tier } : undefined,
          });
        } else if (command === 'modify') {
          const id = parts[1];
          const jsonStr = trimmed.slice(trimmed.indexOf(parts[2] || ''));
          let parsed;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            parsed = { content: jsonStr };
          }
          response = await api.post('/api/sovereign/decree', {
            action: 'modify-dtu',
            target: id,
            data: parsed,
          });
        } else if (command === 'delete') {
          response = await api.post('/api/sovereign/decree', {
            action: 'delete-dtu',
            target: parts[1],
          });
        } else if (command === 'inspect') {
          response = await api.post('/api/sovereign/decree', {
            action: 'inspect',
            target: parts[1],
          });
        } else if (command === 'search') {
          response = await api.post('/api/sovereign/decree', {
            action: 'search',
            data: { query: rest },
          });
        } else if (command === 'count') {
          response = await api.post('/api/sovereign/decree', { action: 'count' });
        } else if (command === 'freeze') {
          response = await api.post('/api/sovereign/decree', { action: 'freeze' });
        } else if (command === 'thaw') {
          response = await api.post('/api/sovereign/decree', { action: 'thaw' });
        } else if (command === 'pipeline') {
          response = await api.post('/api/sovereign/decree', { action: 'force-pipeline' });
        } else if (command === 'dream') {
          response = await api.post('/api/sovereign/decree', {
            action: 'force-dream',
            data: rest ? { seed: rest } : undefined,
          });
        } else if (command === 'gc') {
          response = await api.post('/api/sovereign/decree', { action: 'gc' });
        } else if (command === 'broadcast') {
          response = await api.post('/api/sovereign/decree', {
            action: 'broadcast',
            data: { message: rest },
          });
        } else if (command === 'config') {
          const key = parts[1];
          const value = parts.slice(2).join(' ');
          let parsed;
          try {
            parsed = JSON.parse(value);
          } catch {
            parsed = value;
          }
          response = await api.post('/api/sovereign/decree', {
            action: 'set-config',
            data: { key, value: parsed },
          });
        } else if (command === 'toggle') {
          const job = parts[1];
          const enabled = parts[2] !== 'off';
          response = await api.post('/api/sovereign/decree', {
            action: 'toggle-job',
            target: job,
            data: { enabled },
          });
        } else if (command === 'qualia') {
          response = await api.post('/api/sovereign/decree', {
            action: 'qualia',
            target: parts[1],
          });
        } else if (command === 'qualia-summary') {
          response = await api.post('/api/sovereign/decree', { action: 'qualia-summary' });
        } else if (command === 'activate-os') {
          response = await api.post('/api/sovereign/decree', {
            action: 'activate-os',
            target: parts[1],
            data: { osKey: parts[2] },
          });
        } else if (command === 'deactivate-os') {
          response = await api.post('/api/sovereign/decree', {
            action: 'deactivate-os',
            target: parts[1],
            data: { osKey: parts[2] },
          });
        } else if (command === 'inject-qualia') {
          response = await api.post('/api/sovereign/decree', {
            action: 'inject-qualia',
            target: parts[1],
            data: { channel: parts[2], value: parseFloat(parts[3]) },
          });
          // ── Council Voices ──
        } else if (command === 'council-voices') {
          response = await api.post('/api/sovereign/decree', {
            action: 'council-voices',
            target: parts[1] || undefined,
          });
        } else if (command === 'voice') {
          response = await api.post('/api/sovereign/decree', {
            action: 'council-voices',
          });
          // ── Species ──
        } else if (command === 'species') {
          response = await api.post('/api/sovereign/decree', {
            action: 'species',
            target: parts[1] || undefined,
          });
        } else if (command === 'species-all') {
          response = await api.post('/api/sovereign/decree', { action: 'species-all' });
          // ── Reproduction ──
        } else if (command === 'reproduce') {
          response = await api.post('/api/sovereign/decree', {
            action: 'reproduce',
            target: parts[1],
            data: { entity2: parts[2] },
          });
        } else if (command === 'reproduction-policy') {
          const enable = parts[1] !== 'disable';
          response = await api.post('/api/sovereign/decree', {
            action: 'reproduction-policy',
            target: enable ? 'enable' : 'disable',
            data: { enabled: enable },
          });
        } else if (command === 'lineage') {
          response = await api.post('/api/sovereign/decree', {
            action: 'lineage',
            target: parts[1],
          });
        } else if (command === 'lineage-tree') {
          response = await api.post('/api/sovereign/decree', { action: 'lineage-tree' });
          // ── Simulation ──
        } else if (command === 'simulate') {
          let params;
          try {
            params = JSON.parse(parts.slice(2).join(' '));
          } catch {
            params = {};
          }
          response = await api.post('/api/sovereign/decree', {
            action: 'simulate',
            target: parts[1],
            data: { params },
          });
        } else if (command === 'simulations') {
          response = await api.post('/api/sovereign/decree', {
            action: 'simulations',
            target: parts[1] || undefined,
          });
        } else if (command === 'sim-compare') {
          response = await api.post('/api/sovereign/decree', {
            action: 'sim-compare',
            target: parts[1],
          });
          // ── Vulnerability ──
        } else if (command === 'vulnerability') {
          response = await api.post('/api/sovereign/decree', {
            action: 'vulnerability',
            target: rest,
          });
        } else {
          addLog('error', `Unknown command: ${command}. Type "help" for available commands.`);
          setExecuting(false);
          return;
        }

        // Display response
        const data = response?.data;
        if (data) {
          const isError = data.ok === false;
          const formatted = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
          addLog(isError ? 'error' : 'success', formatted);
        }
      } catch (err: unknown) {
        const axErr = err as {
          response?: { status?: number; data?: { error?: string } };
          message?: string;
        };
        if (axErr?.response?.status === 403) {
          addLog('error', 'Access denied. Sovereign credentials required.');
        } else {
          addLog('error', axErr?.response?.data?.error || axErr?.message || 'Command failed');
        }
      } finally {
        setExecuting(false);
      }
    },
    [addLog]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!executing && input.trim()) {
      executeCommand(input);
      setInput('');
    }
  };

  const colorMap: Record<LogEntry['type'], string> = {
    input: 'text-purple-400',
    output: 'text-gray-300',
    error: 'text-red-400',
    system: 'text-cyan-400',
    success: 'text-emerald-400',
  };

  if (!accessChecked) return null;
  if (!hasAccess) return <SovereignRequired />;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: '#0a0a0f',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: '13px',
      }}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 bg-[#0d0d14]">
        <div className="flex items-center gap-3">
          <span className="text-purple-400 font-bold text-sm">◆ SOVEREIGN</span>
          <span className="text-gray-500 text-xs">dev console</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {pulse?.dtus?.total !== undefined && (
            <span className="text-gray-400">
              DTUs: <span className="text-white">{pulse.dtus.total.toLocaleString()}</span>
            </span>
          )}
          {pulse?.process?.heapUsed && (
            <span className="text-gray-400">
              mem: <span className="text-white">{pulse.process.heapUsed}</span>
            </span>
          )}
          {pulse?.process?.uptimeHuman && (
            <span className="text-gray-400">
              up: <span className="text-white">{pulse.process.uptimeHuman}</span>
            </span>
          )}
          <span className="text-amber-400">authority: 1.0</span>
        </div>
      </div>

      {/* Log Display */}
      <div className="flex-1 overflow-auto p-4 space-y-1">
        {log.map((entry, i) => (
          <div key={i} className={`${colorMap[entry.type]} whitespace-pre-wrap break-all`}>
            {entry.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Command Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-4 py-3 border-t border-gray-800/50 bg-[#0d0d14]"
      >
        <span className="text-purple-400 font-bold select-none">sovereign &gt;</span>
        {executing ? (
          <span className="text-gray-500 animate-pulse">⟳ executing</span>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-gray-200 outline-none caret-purple-400 placeholder-gray-600"
            placeholder="Enter command..."
            autoFocus
            disabled={executing}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </form>
    </div>
  );
}
