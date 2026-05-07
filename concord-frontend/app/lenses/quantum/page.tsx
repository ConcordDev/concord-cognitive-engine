'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Atom, Zap, Waves, RotateCcw, Play, Shuffle, Loader2, Layers, ChevronDown } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';
import { useMutation } from '@tanstack/react-query';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface SimResultData {
  qubits: number;
  result: string;
  gates: string[];
}

// Compute probability amplitudes from a measurement outcome
// For a uniform superposition, each basis state has equal probability 1/2^n
// We display the top amplitudes weighted toward the measured state
function computeAmplitudes(result: string, qubits: number): { state: string; prob: number; phase: number }[] {
  const totalStates = 2 ** qubits;
  const displayCount = Math.min(totalStates, 8);
  const amplitudes: { state: string; prob: number; phase: number }[] = [];
  const measuredVal = parseInt(result, 2);

  for (let i = 0; i < displayCount; i++) {
    const stateStr = i.toString(2).padStart(qubits, '0');
    const isMeasured = i === measuredVal;
    // Collapsed: measured state = 1.0, others = 0
    amplitudes.push({
      state: stateStr,
      prob: isMeasured ? 1.0 : 0.0,
      phase: isMeasured ? 0 : Math.random() * 360,
    });
  }
  return amplitudes;
}

// Pre-measurement: equal superposition
function computeSuperpositionAmplitudes(qubits: number): { state: string; prob: number }[] {
  const totalStates = 2 ** qubits;
  const displayCount = Math.min(totalStates, 8);
  const prob = 1 / totalStates;
  return Array.from({ length: displayCount }, (_, i) => ({
    state: i.toString(2).padStart(qubits, '0'),
    prob,
  }));
}

export default function QuantumLensPage() {
  useLensNav('quantum');
  const [qubits, setQubits] = useState(4);
  const [result, setResult] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('quantum');

  const { items: circuitItems, isLoading: circuitsLoading, isError: isError, error: error, refetch: refetch, create: saveResult } = useLensData<SimResultData>('quantum', 'sim-result', {
    seed: [],
  });

  const circuits = [
    { name: 'Hadamard', desc: 'Superposition gate', icon: '|H\u27E9' },
    { name: 'CNOT', desc: 'Entanglement gate', icon: '\u2295' },
    { name: 'Phase', desc: 'Rotation gate', icon: 'ei\u03B8' },
    { name: 'Measure', desc: 'Collapse state', icon: '\uD83D\uDCCA' },
  ];

  const runSimulation = useMutation({
    mutationFn: async () => {
      try {
        const { data } = await apiHelpers.chat.ask(
          `Simulate a ${qubits}-qubit quantum circuit with Hadamard and CNOT gates. Return a measurement outcome as a binary string of length ${qubits}.`,
          'quantum'
        );
        const reply = data?.reply || data?.response || '';
        // Extract a binary string from the response
        const binaryMatch = reply.match(/[01]{2,}/);
        if (binaryMatch) return binaryMatch[0].slice(0, qubits).padStart(qubits, '0');
      } catch {
        // Fallback to local simulation if backend unavailable
      }
      const outcomes = Array.from({ length: 2 ** qubits }, (_, i) =>
        i.toString(2).padStart(qubits, '0')
      );
      return outcomes[Math.floor(Math.random() * outcomes.length)];
    },
    onSuccess: (resultStr) => {
      setResult(resultStr);
      saveResult({
        title: `Sim ${new Date().toISOString().slice(0, 19)}`,
        data: { qubits, result: resultStr, gates: circuits.map((c) => c.name) },
      }).catch((err) => console.error('Failed to save simulation result:', err instanceof Error ? err.message : err));
    },
    onError: (err) => console.error('runSimulation failed:', err instanceof Error ? err.message : err),
  });

  const recentSims = circuitItems.slice(0, 5);


  if (circuitsLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-purple border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Initializing quantum circuits...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div data-lens-theme="quantum" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">\u269B\uFE0F</span>
        <div>
          <h1 className="text-xl font-bold">Quantum Lens</h1>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          <p className="text-sm text-gray-400">
            Quantum computing simulations and circuit builder
          </p>
        </div>
      </header>


      <RealtimeDataPanel domain="quantum" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="quantum" data={{}} compact />

      {/* AI Actions */}
      <UniversalActions domain="quantum" artifactId={circuitItems[0]?.id} compact />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Atom className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{qubits}</p>
          <p className="text-sm text-gray-400">Qubits</p>
        </div>
        <div className="lens-card">
          <Waves className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{2 ** qubits}</p>
          <p className="text-sm text-gray-400">States</p>
        </div>
        <div className="lens-card">
          <Shuffle className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{circuits.length}</p>
          <p className="text-sm text-gray-400">Gates</p>
        </div>
        <div className="lens-card">
          <Zap className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{runSimulation.isPending ? '...' : 'Ready'}</p>
          <p className="text-sm text-gray-400">Status</p>
        </div>
      </div>

      {/* Circuit Builder */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Atom className="w-4 h-4 text-neon-purple" />
          Quantum Circuit
        </h2>
        <div className="flex gap-2 mb-4">
          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Qubits:</span>
            <input
              type="range"
              min="1"
              max="8"
              value={qubits}
              onChange={(e) => { setQubits(Number(e.target.value)); setResult(null); }}
              className="w-32"
            />
            <span className="font-mono">{qubits}</span>
          </label>
        </div>

        {/* Text-based circuit diagram */}
        <div className="mb-4 p-3 bg-black/40 rounded-lg border border-white/10 font-mono text-xs overflow-x-auto">
          <p className="text-gray-500 mb-2 text-[10px] uppercase tracking-wider">Circuit Diagram</p>
          {Array.from({ length: qubits }, (_, qi) => (
            <div key={qi} className="flex items-center gap-0 text-gray-300 mb-1 whitespace-nowrap">
              <span className="text-neon-purple w-10 shrink-0">q[{qi}]:</span>
              <span className="text-gray-600">─</span>
              <span className="px-1 py-0 border border-neon-purple/50 rounded text-neon-purple bg-neon-purple/10">H</span>
              <span className="text-gray-600">────</span>
              {qi < qubits - 1 ? (
                <>
                  <span className="text-neon-cyan">●</span>
                  <span className="text-gray-600">──</span>
                </>
              ) : (
                <>
                  <span className="text-neon-cyan px-0.5 border border-neon-cyan/50 rounded bg-neon-cyan/10">⊕</span>
                  <span className="text-gray-600">──</span>
                </>
              )}
              <span className="px-1 py-0 border border-yellow-500/50 rounded text-yellow-400 bg-yellow-500/10">M</span>
              <span className="text-gray-600">─▶</span>
              <span className="text-gray-500 ml-1">c[{qi}]</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {circuits.map((gate) => (
            <div key={gate.name} className="lens-card text-center p-3">
              <span className="text-2xl font-mono">{gate.icon}</span>
              <p className="text-xs font-medium mt-1">{gate.name}</p>
              <p className="text-xs text-gray-500">{gate.desc}</p>
            </div>
          ))}
        </div>

        {/* Pre-measurement amplitude bars (superposition) */}
        {!result && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Probability Amplitudes (pre-measurement)</p>
            <div className="space-y-1">
              {computeSuperpositionAmplitudes(qubits).map(({ state, prob }) => (
                <div key={state} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-gray-400 w-12 shrink-0">|{state}⟩</span>
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-neon-purple/70 rounded-full"
                      style={{ width: `${Math.round(prob * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-neon-purple w-10 text-right">
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => runSimulation.mutate()}
            disabled={runSimulation.isPending}
            className="btn-neon purple flex-1"
          >
            {runSimulation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 inline animate-spin" />Simulating...</>
            ) : (
              <><Play className="w-4 h-4 mr-2 inline" />Run Circuit</>
            )}
          </button>
          <button onClick={() => setResult(null)} className="btn-neon">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Result + Post-measurement amplitudes */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="panel p-6 space-y-5"
          >
            {/* Measurement outcome */}
            <div className="text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Measurement Result</p>
              <motion.p
                key={result}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-4xl font-mono text-neon-cyan tracking-widest"
              >
                |{result}⟩
              </motion.p>
              <p className="text-sm text-gray-500 mt-2">
                Wavefunction collapsed — {qubits}-qubit register measured
              </p>
            </div>

            {/* Post-collapse amplitude bars */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Post-Measurement Amplitudes</p>
              <div className="space-y-1.5">
                {computeAmplitudes(result, qubits).map(({ state, prob }) => {
                  const isMeasured = state === result;
                  return (
                    <div key={state} className="flex items-center gap-2">
                      <span className={`font-mono text-[11px] w-12 shrink-0 ${isMeasured ? 'text-neon-cyan' : 'text-gray-600'}`}>
                        |{state}⟩
                      </span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${prob * 100}%` }}
                          transition={{ duration: 0.4, delay: 0.1 }}
                          className={`h-full rounded-full ${isMeasured ? 'bg-neon-cyan' : 'bg-gray-700'}`}
                        />
                      </div>
                      <span className={`font-mono text-[11px] w-12 text-right ${isMeasured ? 'text-neon-cyan' : 'text-gray-600'}`}>
                        {(prob * 100).toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bit-by-bit breakdown */}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Qubit Readout</p>
              <div className="flex gap-2 flex-wrap">
                {result.split('').map((bit, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-gray-500">q[{idx}]</span>
                    <span className={`font-mono text-lg font-bold px-2 py-1 rounded border ${
                      bit === '1'
                        ? 'text-neon-cyan border-neon-cyan/40 bg-neon-cyan/10'
                        : 'text-gray-400 border-gray-600/40 bg-gray-800/30'
                    }`}>
                      {bit}
                    </span>
                    <span className="text-[10px] text-gray-500">{bit === '1' ? '|1⟩' : '|0⟩'}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent Simulations */}
      {recentSims.length > 0 && (
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-green" />
            Recent Simulations
          </h2>
          <div className="space-y-2">
            {recentSims.map((sim) => (
              <div key={sim.id} className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg">
                <div>
                  <span className="font-mono text-neon-cyan">|{sim.data.result}\u27E9</span>
                  <span className="text-xs text-gray-500 ml-2">{sim.data.qubits} qubits</span>
                </div>
                <span className="text-xs text-gray-500">{new Date(sim.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="quantum" />
          </div>
        )}
      </div>
    </div>
  );
}
