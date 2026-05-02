'use client';

import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Calculator,
  Ruler,
  Atom,
  FlaskConical,
  CheckCircle,
  XCircle,
  ArrowRight,
  Info,
} from 'lucide-react';

function EmpiricalGatesPanel() {
  const [mathInput, setMathInput] = useState('');
  const [convertFrom, setConvertFrom] = useState('');
  const [convertTo, setConvertTo] = useState('');
  const [convertValue, setConvertValue] = useState('');
  const [scanInput, setScanInput] = useState('');

  // Gate info
  const { data: gateInfoRes } = useQuery({
    queryKey: ['empirical-info'],
    queryFn: () => apiHelpers.empirical.info(),
    staleTime: 300000,
  });

  // Math evaluation
  const mathMutation = useMutation({
    mutationFn: (expr: string) => apiHelpers.empirical.math(expr),
  });

  // Unit conversion
  const convertMutation = useMutation({
    mutationFn: (data: { value: number; from: string; to: string }) =>
      apiHelpers.empirical.convertUnits(data),
  });

  // Text scanning
  const scanMutation = useMutation({
    mutationFn: (text: string) => apiHelpers.empirical.scanText(text),
  });

  const gateInfo = gateInfoRes?.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FlaskConical className="w-6 h-6 text-neon-green" />
        <h2 className="text-xl font-bold text-gray-100">Empirical Gates</h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green border border-neon-green/20">
          Math + Units + Constants
        </span>
      </div>

      {/* Math Evaluator */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-neon-blue" />
          Math Expression Evaluator
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={mathInput}
            onChange={(e) => setMathInput(e.target.value)}
            placeholder="e.g. sqrt(9) + 2^3, sin(pi/4), log(100)"
            className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-blue/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && mathInput.trim()) {
                mathMutation.mutate(mathInput.trim());
              }
            }}
          />
          <button
            onClick={() => mathInput.trim() && mathMutation.mutate(mathInput.trim())}
            disabled={!mathInput.trim() || mathMutation.isPending}
            className="px-4 py-2 bg-neon-blue/10 text-neon-blue border border-neon-blue/20 rounded-lg text-sm hover:bg-neon-blue/20 disabled:opacity-50 transition-colors"
          >
            Evaluate
          </button>
        </div>
        {mathMutation.data?.data && (
          <div className="mt-3 px-4 py-3 bg-lattice-deep rounded-lg">
            {mathMutation.data.data.ok ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-neon-green" />
                <span className="text-sm text-gray-300">Result:</span>
                <span className="text-lg font-mono text-neon-cyan">
                  {mathMutation.data.data.result}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-neon-orange" />
                <span className="text-sm text-neon-orange">{mathMutation.data.data.error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unit Converter */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Ruler className="w-4 h-4 text-neon-purple" />
          Unit Converter (SI Dimensional Analysis)
        </h3>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Value</label>
            <input
              type="number"
              value={convertValue}
              onChange={(e) => setConvertValue(e.target.value)}
              placeholder="100"
              className="w-24 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-purple/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">From</label>
            <input
              type="text"
              value={convertFrom}
              onChange={(e) => setConvertFrom(e.target.value)}
              placeholder="km/h"
              className="w-28 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-purple/50"
            />
          </div>
          <ArrowRight className="w-4 h-4 text-gray-500 mb-2" />
          <div>
            <label className="text-xs text-gray-400 block mb-1">To</label>
            <input
              type="text"
              value={convertTo}
              onChange={(e) => setConvertTo(e.target.value)}
              placeholder="m/s"
              className="w-28 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-purple/50"
            />
          </div>
          <button
            onClick={() => {
              const val = parseFloat(convertValue);
              if (!isNaN(val) && convertFrom && convertTo) {
                convertMutation.mutate({ value: val, from: convertFrom, to: convertTo });
              }
            }}
            disabled={!convertValue || !convertFrom || !convertTo || convertMutation.isPending}
            className="px-4 py-2 bg-neon-purple/10 text-neon-purple border border-neon-purple/20 rounded-lg text-sm hover:bg-neon-purple/20 disabled:opacity-50 transition-colors"
          >
            Convert
          </button>
        </div>
        {convertMutation.data?.data && (
          <div className="mt-3 px-4 py-3 bg-lattice-deep rounded-lg">
            {convertMutation.data.data.ok ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-neon-green" />
                <span className="text-sm text-gray-300">
                  {convertValue} {convertFrom} =
                </span>
                <span className="text-lg font-mono text-neon-cyan">
                  {convertMutation.data.data.result?.toFixed?.(6) ??
                    convertMutation.data.data.result}
                </span>
                <span className="text-sm text-gray-300">{convertTo}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-neon-orange" />
                <span className="text-sm text-neon-orange">{convertMutation.data.data.error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Text Scanner */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Atom className="w-4 h-4 text-neon-yellow" />
          Claim Scanner (Validate Text for Empirical Content)
        </h3>
        <textarea
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          placeholder="Paste text containing claims, e.g.: The speed of light is approximately 3e8 m/s. The mass is 5.2 kg and the force is 51 N."
          className="w-full h-24 bg-lattice-deep border border-lattice-border rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-yellow/50 resize-none"
        />
        <button
          onClick={() => scanInput.trim() && scanMutation.mutate(scanInput.trim())}
          disabled={!scanInput.trim() || scanMutation.isPending}
          className="mt-2 px-4 py-2 bg-neon-yellow/10 text-neon-yellow border border-neon-yellow/20 rounded-lg text-sm hover:bg-neon-yellow/20 disabled:opacity-50 transition-colors"
        >
          Scan Text
        </button>

        {scanMutation.data?.data?.ok && (
          <div className="mt-4 space-y-3">
            {/* Numeric Claims */}
            {scanMutation.data.data.numericClaims?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1">Numeric Claims Found:</p>
                {scanMutation.data.data.numericClaims.map(
                  (c: { value: number; unit?: string; context?: string }, i: number) => (
                    <div
                      key={i}
                      className="text-xs bg-lattice-deep rounded px-3 py-1.5 mb-1 flex items-center gap-2"
                    >
                      <span className="text-neon-cyan font-mono">{c.value}</span>
                      {c.unit && <span className="text-neon-purple">{c.unit}</span>}
                      {c.context && <span className="text-gray-500 truncate">{c.context}</span>}
                    </div>
                  )
                )}
              </div>
            )}

            {/* Math Expressions */}
            {scanMutation.data.data.mathExpressions?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1">Math Expressions:</p>
                {scanMutation.data.data.mathExpressions.map(
                  (e: { expression: string; result?: number }, i: number) => (
                    <div
                      key={i}
                      className="text-xs bg-lattice-deep rounded px-3 py-1.5 mb-1 flex items-center gap-2"
                    >
                      <span className="font-mono text-gray-300">{e.expression}</span>
                      {e.result !== undefined && (
                        <>
                          <span className="text-gray-500">=</span>
                          <span className="text-neon-green font-mono">{e.result}</span>
                        </>
                      )}
                    </div>
                  )
                )}
              </div>
            )}

            {/* Constant References */}
            {scanMutation.data.data.constantReferences?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1">
                  Physical Constant References:
                </p>
                {scanMutation.data.data.constantReferences.map(
                  (
                    c: {
                      key: string;
                      citedValue?: number;
                      constant?: { value: number; unit: string };
                    },
                    i: number
                  ) => (
                    <div
                      key={i}
                      className="text-xs bg-lattice-deep rounded px-3 py-1.5 mb-1 flex items-center gap-2"
                    >
                      <Atom className="w-3 h-3 text-neon-yellow" />
                      <span className="text-gray-300">{c.key}</span>
                      {c.citedValue !== undefined && (
                        <span className="text-neon-orange font-mono">cited: {c.citedValue}</span>
                      )}
                      {c.constant && (
                        <span className="text-neon-green font-mono">
                          actual: {c.constant.value} {c.constant.unit}
                        </span>
                      )}
                    </div>
                  )
                )}
              </div>
            )}

            {scanMutation.data.data.numericClaims?.length === 0 &&
              scanMutation.data.data.mathExpressions?.length === 0 &&
              scanMutation.data.data.constantReferences?.length === 0 && (
                <p className="text-xs text-gray-500 italic">
                  No empirical content detected in this text.
                </p>
              )}
          </div>
        )}
      </div>

      {/* Physical Constants Reference */}
      {gateInfo?.constants && (
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Info className="w-4 h-4 text-neon-cyan" />
            Physical Constants Database
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(gateInfo.constants).map(([key, val]: [string, unknown]) => {
              const c = val as { value: number; unit: string; name: string };
              return (
                <div key={key} className="px-3 py-2 rounded bg-lattice-deep">
                  <p className="text-xs font-medium text-neon-cyan">{c.name || key}</p>
                  <p className="text-xs font-mono text-gray-300">
                    {c.value} {c.unit}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedEmpiricalGatesPanel = withErrorBoundary(EmpiricalGatesPanel);
export { _WrappedEmpiricalGatesPanel as EmpiricalGatesPanel };
export default _WrappedEmpiricalGatesPanel;
