'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Binary, AlertCircle, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface BitwiseResult {
  op: string;
  symbol: string;
  a: number;
  b: number | null;
  decimal: number;
  glyph: string;
  binary: string;
  base6: string;
  semantic: string;
}

const OPS: { id: string; label: string }[] = [
  { id: 'and', label: 'AND ∧' },
  { id: 'or', label: 'OR ∨' },
  { id: 'xor', label: 'XOR ⊕' },
  { id: 'shl', label: 'Shift ≪' },
  { id: 'shr', label: 'Shift ≫' },
  { id: 'mod', label: 'Modulo' },
  { id: 'not', label: 'NOT ¬' },
];

/* Bitwise / modular operations in the base-6 algebra — calls root.bitwise. */
export function BitwisePanel() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [op, setOp] = useState('and');
  const [result, setResult] = useState<BitwiseResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isUnary = op === 'not';

  const compute = useCallback(async () => {
    if (!a.trim()) { setError('Operand a is required'); return; }
    if (!isUnary && !b.trim()) { setError('Operand b is required'); return; }
    setBusy(true); setError('');
    const r = await lensRun<BitwiseResult>('root', 'bitwise', {
      a: a.trim(), b: isUnary ? undefined : b.trim(), op,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else { setResult(null); setError(r.data?.error || 'Could not compute'); }
  }, [a, b, op, isUnary]);

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Binary className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Bitwise &amp; Modular</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Bit-level and modular operators over the base-6 algebra. Operands accept decimals or glyphs.
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center mb-3">
        <input
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm"
          placeholder="a" value={a} onChange={(e) => setA(e.target.value)} />
        <select
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-gray-100 focus:outline-none text-sm"
          value={op} onChange={(e) => setOp(e.target.value)}>
          {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <input
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm disabled:opacity-40"
          placeholder={isUnary ? '— (unary)' : 'b'} value={b}
          disabled={isUnary}
          onChange={(e) => setB(e.target.value)} />
      </div>
      <button
        onClick={() => void compute()}
        disabled={busy}
        className="px-4 py-2 bg-violet-700/50 hover:bg-violet-700/70 border border-violet-700 rounded-lg text-violet-100 text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Binary className="w-4 h-4" />}
        Compute
      </button>
      {error && (
        <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />{error}
        </div>
      )}
      {result && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-2xl text-violet-300">{result.glyph}</span>
            <span className="text-sm text-emerald-300">= {result.decimal}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="bg-gray-800 rounded p-2">
              <div className="text-[10px] uppercase text-gray-500">binary</div>
              <div className="text-gray-200 truncate">{result.binary}</div>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <div className="text-[10px] uppercase text-gray-500">base-6</div>
              <div className="text-gray-200 truncate">{result.base6}</div>
            </div>
            <div className="bg-gray-800 rounded p-2">
              <div className="text-[10px] uppercase text-gray-500">operator</div>
              <div className="text-gray-200">{result.symbol}</div>
            </div>
          </div>
          <div className="text-xs text-violet-400 italic bg-violet-950/30 rounded-lg p-3 border border-violet-900/40">
            {result.semantic}
          </div>
        </motion.div>
      )}
    </section>
  );
}
