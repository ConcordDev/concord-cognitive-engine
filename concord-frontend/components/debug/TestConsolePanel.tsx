'use client';

import { Terminal, Copy, Trash2 } from 'lucide-react';
import { useDebugDesk } from '@/components/debug/useDebugDesk';
import { CmdButton } from '@/components/debug/debug-helpers';

export function TestConsolePanel() {
  const {
    debugCmd, customCmd, setCustomCmd, handleCustomCmd,
    debugOutput, copyConsole, clearConsole, consoleEndRef,
  } = useDebugDesk();

  return (
<div className="panel p-4">
  <h2 className="font-semibold mb-4 flex items-center gap-2">
    <Terminal className="w-4 h-4 text-neon-green" />
    Test Console
  </h2>
  <div className="space-y-4">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <CmdButton
        label="Tick Kernel"
        color="neon-green"
        onClick={() => debugCmd.mutate('tick')}
        disabled={debugCmd.isPending}
      />
      <CmdButton
        label="Check Organs"
        color="neon-blue"
        onClick={() => debugCmd.mutate('organs')}
        disabled={debugCmd.isPending}
      />
      <CmdButton
        label="Verify Invariants"
        color="neon-purple"
        onClick={() => debugCmd.mutate('invariants')}
        disabled={debugCmd.isPending}
      />
      <CmdButton
        label="Sim Growth"
        color="neon-cyan"
        onClick={() => debugCmd.mutate('growth')}
        disabled={debugCmd.isPending}
      />
      <CmdButton
        label="DB Status"
        color="neon-blue"
        onClick={() => debugCmd.mutate('db-status')}
        disabled={debugCmd.isPending}
      />
      <CmdButton
        label="Redis Stats"
        color="neon-pink"
        onClick={() => debugCmd.mutate('redis-stats')}
        disabled={debugCmd.isPending}
      />
      <CmdButton
        label="Perf Metrics"
        color="neon-cyan"
        onClick={() => debugCmd.mutate('perf')}
        disabled={debugCmd.isPending}
      />
      <CmdButton
        label="Run GC"
        color="neon-green"
        onClick={() => debugCmd.mutate('gc')}
        disabled={debugCmd.isPending}
      />
    </div>

    {/* Custom Command */}
    <div className="flex gap-2">
      <input
        className="flex-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-mono focus:border-neon-green outline-none"
        placeholder="Enter custom endpoint (e.g., 'status')..."
        value={customCmd}
        onChange={(e) => setCustomCmd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleCustomCmd();
        }}
      />
      <button
        className="btn-neon text-sm"
        disabled={!customCmd.trim() || debugCmd.isPending}
        onClick={handleCustomCmd}
      >
        Run
      </button>
    </div>

    {/* Console Output */}
    <div className="relative">
      <div className="absolute top-2 right-2 flex gap-1 z-10">
        <button
          onClick={copyConsole}
          className="p-1 text-gray-400 hover:text-white"
          title="Copy"
        >
          <Copy className="w-3 h-3" />
        </button>
        <button
          onClick={clearConsole}
          className="p-1 text-gray-400 hover:text-white"
          title="Clear"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="bg-lattice-void p-4 rounded-lg h-64 font-mono text-sm text-gray-400 overflow-y-auto">
        {debugOutput.map((line, i) => (
          <p
            key={i}
            className={
              line.startsWith('$')
                ? 'text-neon-green'
                : line.startsWith('Error')
                  ? 'text-red-400'
                  : ''
            }
          >
            {line}
          </p>
        ))}
        <p className="animate-pulse">_</p>
        <div ref={consoleEndRef} />
      </div>
    </div>
  </div>
</div>

  );
}
