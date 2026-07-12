'use client';

/**
 * PortabilityPanel — Wave 4 gap-closure (dtus-capability-map.md §1c):
 * `dtu_portability` (export/validate/import corpus backup, Phase 6b,
 * `server/lib/dtu-portability.js` + `server/domains/dtu-portability.js`)
 * shipped with zero frontend callers anywhere in the codebase. This panel
 * is the first real UI for it — an Obsidian-vault-style "export my data /
 * bring a backup back in" surface, matching this lens's reference-app
 * parity target.
 *
 * Three real, honest actions:
 *   - Export  → `dtu_portability.export`   — downloads a real envelope
 *     (JSON file) built from the caller's own DTUs/citations/ledger rows.
 *   - Validate → `dtu_portability.validate` — pure integrity check (no DB
 *     writes) run automatically the moment a file is chosen, so a tampered
 *     or corrupted envelope is caught and shown BEFORE any import is
 *     possible — the Import action stays disabled until validation passes.
 *   - Import  → `dtu_portability.import`   — only reachable after a real,
 *     successful validate pass on the loaded file, and gated behind an
 *     explicit confirm() describing exactly what will be written and that
 *     it is idempotent per DTU id (safe to re-run, never double-imports).
 */

import { useCallback, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Archive, Download, Upload, Loader2, ShieldCheck, ShieldX, FileJson, CheckCircle2,
} from 'lucide-react';

interface ExportEnvelope {
  spec: string;
  exported_at: number;
  creator_id: string;
  instance_signature: string;
  dtus: unknown[];
  citations: unknown[];
  economy_ledger?: unknown[];
  attachments?: unknown[];
  hashes: Record<string, string>;
  counts: { dtus: number; citations: number; economy: number; attachments: number };
}

interface ValidateResult {
  ok: boolean;
  reason?: string;
  dtuCount?: number;
  citationCount?: number;
  economyCount?: number;
  attachmentCount?: number;
}

interface ImportResult {
  ok: boolean;
  imported?: { dtus: number; citations: number; economy: number; attachments: number; skipped: number };
  reason?: string;
}

const REASON_LABEL: Record<string, string> = {
  bad_spec: 'Not a Concord DTU-pack envelope (wrong or missing "spec" field).',
  no_creator_id: 'Envelope is missing its creator id.',
  dtus_missing: 'Envelope has no "dtus" array — it is malformed.',
  dtu_hash_mismatch: 'DTU content hash does not match — the file was modified or corrupted after export.',
  citation_hash_mismatch: 'Citation content hash does not match — the file was modified or corrupted after export.',
  attachment_hash_mismatch: 'Attachment content hash does not match — the file was modified or corrupted after export.',
};

function dl(filename: string, data: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PortabilityPanel() {
  // Export
  const [includeEconomy, setIncludeEconomy] = useState(true);
  const [includeAttachments, setIncludeAttachments] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportEnvelope['counts'] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Validate + import
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<ExportEnvelope | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult['imported'] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const runExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      const res = await lensRun<ExportEnvelope>('dtu_portability', 'export', {
        includeEconomy,
        includeAttachments,
      });
      if (res.data.ok && res.data.result) {
        const env = res.data.result;
        dl(`concord-dtu-export-${new Date(env.exported_at * 1000).toISOString().slice(0, 10)}.json`, JSON.stringify(env, null, 2), 'application/json');
        setExportResult(env.counts);
      } else {
        setExportError(res.data.error || 'Export failed');
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [includeEconomy, includeAttachments]);

  const resetImportState = useCallback(() => {
    setEnvelope(null);
    setValidation(null);
    setImportResult(null);
    setImportError(null);
    setParseError(null);
  }, []);

  const onFile = useCallback(async (file: File) => {
    resetImportState();
    setFileName(file.name);
    let parsed: ExportEnvelope;
    try {
      const text = await file.text();
      parsed = JSON.parse(text) as ExportEnvelope;
    } catch {
      setParseError('Not valid JSON — could not read this as a Concord DTU-pack envelope.');
      return;
    }
    setEnvelope(parsed);
    // Validate immediately — this is a pure, read-only integrity check
    // (no DB writes), so running it on file-select is safe and lets the
    // user see whether the file is trustworthy before Import ever
    // becomes clickable.
    setValidating(true);
    try {
      const res = await lensRun<ValidateResult>('dtu_portability', 'validate', { envelope: parsed });
      // On failure, lensRun() collapses the result to null and surfaces
      // the mirrored `error` string as the reason (see server/lib/dtu-
      // portability.js — every {ok:false} shape carries error === reason).
      if (res.data.ok && res.data.result) {
        setValidation(res.data.result);
      } else {
        setValidation({ ok: false, reason: res.data.error || 'validation_failed' });
      }
    } catch (e) {
      setValidation({ ok: false, reason: e instanceof Error ? e.message : 'validation_failed' });
    } finally {
      setValidating(false);
    }
  }, [resetImportState]);

  const runImport = useCallback(async () => {
    if (!envelope || !validation?.ok) return;
    const summary = `This will import ${validation.dtuCount ?? 0} DTU(s)`
      + (validation.citationCount ? ` and ${validation.citationCount} citation(s)` : '')
      + (validation.economyCount ? `, plus ${validation.economyCount} ledger row(s),` : '')
      + ' into your account.\n\nDTUs that already exist (matched by id) are safely skipped — this is idempotent and safe to re-run.\n\nContinue?';
    if (!window.confirm(summary)) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await lensRun<ImportResult>('dtu_portability', 'import', { envelope });
      if (res.data.ok && res.data.result?.imported) {
        setImportResult(res.data.result.imported);
      } else {
        setImportError(res.data.error || res.data.result?.reason || 'Import failed');
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [envelope, validation]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Your DTUs belong to you — export a full, hash-verified backup of your
        corpus, or bring one back in from another Concord instance. Nothing
        here requires this deployment.
      </p>

      {/* Export */}
      <div className="rounded-xl border border-lattice-border bg-lattice-deep p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Archive className="h-4 w-4 text-neon-cyan" /> Export my corpus
        </h3>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={includeEconomy}
              onChange={(e) => setIncludeEconomy(e.target.checked)}
              className="accent-neon-cyan"
            />
            Include economy ledger
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={includeAttachments}
              onChange={(e) => setIncludeAttachments(e.target.checked)}
              className="accent-neon-cyan"
            />
            Include file attachments (larger export)
          </label>
        </div>
        <button
          onClick={runExport}
          disabled={exporting}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-neon-cyan/20 px-3 py-1.5 text-xs text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export my corpus
        </button>
        {exportResult && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Downloaded — {exportResult.dtus} DTU(s), {exportResult.citations} citation(s)
            {exportResult.economy ? `, ${exportResult.economy} ledger row(s)` : ''}
            {exportResult.attachments ? `, ${exportResult.attachments} attachment(s)` : ''}.
          </p>
        )}
        {exportError && <p role="alert" className="mt-2 text-[11px] text-red-400">{exportError}</p>}
      </div>

      {/* Validate + import */}
      <div className="rounded-xl border border-lattice-border bg-lattice-deep p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Upload className="h-4 w-4 text-neon-purple" /> Import an envelope
        </h3>
        <p className="mt-1 text-[11px] text-gray-400">
          Choose a Concord DTU-pack file. It is validated immediately — nothing
          is written until you explicitly confirm the import below.
        </p>
        <div className="mt-3">
          <label className="flex flex-col gap-0.5 text-[10px] text-gray-400">
            Envelope file (.json)
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              className="w-72 rounded border border-lattice-border bg-lattice-surface px-2 py-1 text-xs text-white file:mr-2 file:rounded file:border-0 file:bg-lattice-border file:px-2 file:py-0.5 file:text-gray-300"
            />
          </label>
        </div>
        {fileName && <p className="mt-1 text-[10px] text-gray-500">Loaded: {fileName}</p>}
        {parseError && <p role="alert" className="mt-2 text-[11px] text-red-400">{parseError}</p>}

        {validating && (
          <p role="status" className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Validating…
          </p>
        )}

        {!validating && validation && (
          <div className={`mt-3 rounded-lg border p-3 ${validation.ok ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
            {validation.ok ? (
              <>
                <p className="flex items-center gap-1.5 text-xs font-medium text-green-400">
                  <ShieldCheck className="h-4 w-4" /> Envelope is valid — hashes match, ready to import.
                </p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <div className="rounded bg-lattice-surface p-2 text-center">
                    <p className="text-sm font-bold text-white">{validation.dtuCount ?? 0}</p>
                    <p className="text-[10px] text-gray-400">DTUs</p>
                  </div>
                  <div className="rounded bg-lattice-surface p-2 text-center">
                    <p className="text-sm font-bold text-white">{validation.citationCount ?? 0}</p>
                    <p className="text-[10px] text-gray-400">Citations</p>
                  </div>
                  <div className="rounded bg-lattice-surface p-2 text-center">
                    <p className="text-sm font-bold text-white">{validation.economyCount ?? 0}</p>
                    <p className="text-[10px] text-gray-400">Ledger rows</p>
                  </div>
                  <div className="rounded bg-lattice-surface p-2 text-center">
                    <p className="text-sm font-bold text-white">{validation.attachmentCount ?? 0}</p>
                    <p className="text-[10px] text-gray-400">Attachments</p>
                  </div>
                </div>
              </>
            ) : (
              <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-red-400">
                <ShieldX className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  Validation failed ({validation.reason}). {REASON_LABEL[validation.reason || ''] || 'This envelope cannot be trusted — do not import it.'}
                </span>
              </p>
            )}
          </div>
        )}

        <button
          onClick={runImport}
          disabled={!validation?.ok || importing}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-neon-purple/20 px-3 py-1.5 text-xs text-neon-purple hover:bg-neon-purple/30 disabled:opacity-40"
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
          Import validated envelope
        </button>

        {importResult && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Imported {importResult.dtus} DTU(s), {importResult.citations} citation(s)
            {importResult.attachments ? `, ${importResult.attachments} attachment(s)` : ''}.
            {importResult.skipped > 0 ? ` ${importResult.skipped} already present — skipped.` : ''}
          </p>
        )}
        {importError && <p role="alert" className="mt-2 text-[11px] text-red-400">{importError}</p>}
      </div>
    </div>
  );
}
