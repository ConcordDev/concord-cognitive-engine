'use client';

/**
 * ConcordDSLEditor — a scratch editor for Concord DSL source.
 *
 * Honest scope: there is no Concord DSL parser/compiler/validator/publisher
 * in this build. The previous version faked all four ("AST generated",
 * random "DTU-MAT-…" ids, coin-flip assertion results, "published to Concord
 * DTU Registry, replication factor 3") and booted pre-filled with a seeded
 * template library. Now the editor opens empty, highlights keywords, and says
 * plainly that running the code is not supported yet. Nothing is parsed,
 * compiled, validated, published, or saved.
 */

import React, { useState, useMemo } from 'react';

const DSL_KEYWORDS = [
  'material',
  'component',
  'structure',
  'validate',
  'publish',
  'for',
  'in',
  'assert',
];

export const DSL_NOT_SUPPORTED =
  'Running Concord DSL is not supported yet: this build has no DSL parser, compiler, validator, or publisher. Your code is not parsed, compiled, validated, published, or saved.';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function ConcordDSLEditor() {
  const [code, setCode] = useState('');
  const lines = useMemo(() => code.split('\n'), [code]);

  const highlightedLines = useMemo(() => {
    return lines.map((line) => {
      let html = escapeHtml(line);
      DSL_KEYWORDS.forEach((kw) => {
        const re = new RegExp(`\\b(${kw})\\b`, 'g');
        html = html.replace(re, `<span style="color:#c084fc;font-weight:600">$1</span>`);
      });
      html = html.replace(/(\/\/.*)$/, '<span style="color:#6b7280;font-style:italic">$1</span>');
      return html;
    });
  }, [lines]);

  return (
    <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl text-white overflow-hidden flex flex-col h-[700px]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400 text-sm font-bold">
            DSL
          </div>
          <div>
            <h2 className="text-sm font-semibold">Concord DSL Editor</h2>
            <p className="text-[11px] text-white/40">Scratch editor · keyword highlighting only</p>
          </div>
        </div>
        <button
          type="button"
          disabled
          data-testid="dsl-run-disabled"
          title={DSL_NOT_SUPPORTED}
          className="px-4 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-white/40 cursor-not-allowed"
        >
          Run — not supported yet
        </button>
      </div>

      <div role="note" data-testid="dsl-not-supported" className="px-5 py-2 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20">
        {DSL_NOT_SUPPORTED}
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <div className="w-12 flex-shrink-0 bg-white/[0.02] border-r border-white/5 overflow-hidden">
          <div className="py-3 px-1 text-right">
            {lines.map((_, i) => (
              <div key={i} className="text-[11px] font-mono leading-[20px] select-none text-white/20">{i + 1}</div>
            ))}
          </div>
        </div>
        <div className="flex-1 relative overflow-auto">
          <div className="absolute inset-0 py-3 px-4 pointer-events-none" aria-hidden="true">
            {highlightedLines.map((html, i) => (
              <div
                key={i}
                className="font-mono text-[13px] leading-[20px] whitespace-pre"
                dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }}
              />
            ))}
          </div>
          {code === '' && (
            <div className="absolute top-3 left-4 font-mono text-[13px] text-white/25 pointer-events-none">
              Type Concord DSL here…
            </div>
          )}
          <textarea
            aria-label="Concord DSL source"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="w-full h-full py-3 px-4 font-mono text-[13px] leading-[20px] bg-transparent text-transparent caret-purple-400 resize-none outline-none"
            style={{ WebkitTextFillColor: 'transparent' }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-1.5 border-t border-white/10 bg-white/[0.02] text-[10px] text-white/30">
        <div className="flex items-center gap-4">
          <span>Lines: {lines.length}</span>
          <span>Chars: {code.length}</span>
        </div>
        <span>Not saved</span>
      </div>
    </div>
  );
}
