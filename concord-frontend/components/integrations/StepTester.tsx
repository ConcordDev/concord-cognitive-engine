'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Live tester for workflow step primitives: field-level data mapping,
// conditional/filter expressions, formatter transforms, and code steps.
// Each tab calls a real integrations domain macro against sample input.

import { useState } from 'react';
import { FlaskConical, ArrowRight, Wand2, Code, Filter, Loader2, Map as MapIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type TesterTab = 'map' | 'condition' | 'formatter' | 'code';

const SAMPLE = `{
  "data": { "title": "New deal", "amount": 240, "tag": "urgent" },
  "trigger": { "event": "dtu.created" }
}`;

const FORMATTER_OPS = ['uppercase', 'lowercase', 'trim', 'capitalize', 'default', 'number',
  'round', 'split', 'join', 'replace', 'truncate', 'iso_date', 'json_parse', 'json_stringify'];

export function StepTester() {
  const [tab, setTab] = useState<TesterTab>('map');
  const [sample, setSample] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  // map
  const [mapping, setMapping] = useState('{\n  "channel": "$.data.tag",\n  "text": "$.data.title",\n  "label": "deal"\n}');
  // condition
  const [condition, setCondition] = useState('data.amount > 100 && data.tag contains "urgent"');
  // formatter
  const [fmtOp, setFmtOp] = useState('uppercase');
  const [fmtValue, setFmtValue] = useState('hello world');
  // code
  const [expression, setExpression] = useState('concat($.data.title, " — ", $.data.tag)');

  const parsed = (() => { try { return JSON.parse(sample); } catch { return null; } })();

  const run = async () => {
    setBusy(true);
    setErr(null);
    setOutput(null);
    try {
      let r;
      if (tab === 'map') {
        let m: Record<string, unknown>;
        try { m = JSON.parse(mapping); } catch { setErr('Mapping is not valid JSON'); setBusy(false); return; }
        r = await lensRun('integrations', 'previewFieldMap', { mapping: m, sample: parsed || {} });
      } else if (tab === 'condition') {
        r = await lensRun('integrations', 'evalCondition', { condition, data: parsed || {} });
      } else if (tab === 'formatter') {
        r = await lensRun('integrations', 'runFormatter', { op: fmtOp, value: fmtValue });
      } else {
        r = await lensRun('integrations', 'runCodeStep', { expression, data: parsed || {} });
      }
      if (r.data.ok === false) setErr(r.data.error || 'Macro returned an error');
      else setOutput(r.data.result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Tester failed');
    } finally {
      setBusy(false);
    }
  };

  const TABS: Array<{ id: TesterTab; label: string; icon: React.ReactNode }> = [
    { id: 'map', label: 'Field Map', icon: <MapIcon className="w-3.5 h-3.5" /> },
    { id: 'condition', label: 'Condition', icon: <Filter className="w-3.5 h-3.5" /> },
    { id: 'formatter', label: 'Formatter', icon: <Wand2 className="w-3.5 h-3.5" /> },
    { id: 'code', label: 'Code', icon: <Code className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-neon-cyan" />
        <h3 className="font-semibold text-sm">Step Tester</h3>
        <span className="text-xs text-gray-400">— validate mapping, conditions and transforms against sample data</span>
      </div>

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setOutput(null); setErr(null); }}
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
              tab === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-lattice-surface text-gray-400'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wide text-gray-400">Sample input (JSON)</label>
          <textarea
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            rows={6}
            className={`w-full px-2 py-1.5 bg-lattice-deep border rounded text-xs font-mono ${
              parsed ? 'border-lattice-border' : 'border-red-500/50'
            }`}
          />
          {!parsed && <p className="text-[10px] text-red-400">Sample is not valid JSON.</p>}
        </div>
        <div className="space-y-2">
          {tab === 'map' && (
            <>
              <label className="block text-[10px] uppercase tracking-wide text-gray-400">Mapping ($.path or literal)</label>
              <textarea value={mapping} onChange={(e) => setMapping(e.target.value)} rows={6}
                className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
            </>
          )}
          {tab === 'condition' && (
            <>
              <label className="block text-[10px] uppercase tracking-wide text-gray-400">Condition expression</label>
              <input type="text" value={condition} onChange={(e) => setCondition(e.target.value)}
                className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
              <p className="text-[10px] text-gray-400">Ops: == != &gt; &lt; &gt;= &lt;= contains exists · joins: &amp;&amp; ||</p>
            </>
          )}
          {tab === 'formatter' && (
            <>
              <label className="block text-[10px] uppercase tracking-wide text-gray-400">Formatter op + value</label>
              <select value={fmtOp} onChange={(e) => setFmtOp(e.target.value)}
                className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs">
                {FORMATTER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <input type="text" value={fmtValue} onChange={(e) => setFmtValue(e.target.value)}
                className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
            </>
          )}
          {tab === 'code' && (
            <>
              <label className="block text-[10px] uppercase tracking-wide text-gray-400">Code expression</label>
              <input type="text" value={expression} onChange={(e) => setExpression(e.target.value)}
                className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
              <p className="text-[10px] text-gray-400">Intrinsics: concat / sum / len / upper / lower</p>
            </>
          )}
        </div>
      </div>

      <button onClick={run} disabled={busy} className="btn-secondary text-xs flex items-center gap-1">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />} Run test
      </button>

      {err && <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-1.5">{err}</p>}
      {output != null && (
        <pre className="bg-lattice-deep rounded p-3 text-[11px] text-neon-green overflow-auto max-h-48">
{JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  );
}
