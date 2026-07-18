'use client';

// ObsidianVaultExport — the real multi-file "Obsidian vault" export.
//
// The backend macro `export.obsidian` (server/server.js) is genuine: it
// walks the live DTU set and returns one { filename, content } pair per
// DTU, each a real Markdown note with YAML frontmatter (id/tier/tags/
// created) and a `[[wikilink]]`-style Lineage section. What was missing
// was purely a frontend that packs those files into a real .zip a user
// can drop straight into an Obsidian vault folder — no server round-trip
// beyond the one macro call, everything else happens in-browser.
//
// fflate is not a new/unreviewed dependency: it already ships in this
// app's bundle today as a transitive dependency of @react-three/drei
// (via three-stdlib) and @types/three (see concord-frontend/package.json
// and package-lock.json — pinned to the exact version already resolved,
// 0.6.10). This component is the first place it's imported directly.

import { useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import { Loader2, FolderArchive, Download, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ObsidianFile {
  filename: string;
  content: string;
}

interface ObsidianExportResult {
  ok?: boolean;
  format?: string;
  files?: ObsidianFile[];
  count?: number;
  error?: string;
}

type Status = 'idle' | 'fetching' | 'zipping' | 'done' | 'empty' | 'error';

// Purely informational — export.obsidian has no server-side cap (verified
// by reading the macro: it maps every DTU in STATE.dtus with no slice/
// limit), so this never truncates anything. It only decides whether we
// show a heads-up that zipping is happening client-side and may take a
// beat, so a large vault doesn't read as a frozen button.
const LARGE_VAULT_NOTE_THRESHOLD = 500;

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Obsidian vaults are just a folder of .md files — no manifest required.
// The macro can hand back duplicate filenames when two DTUs share a
// title (both get truncated the same way); zipSync's input is a flat
// { path: bytes } record, so a raw duplicate key would silently drop
// one note on the floor. Dedupe defensively before zipping.
export function dedupeFilenames(files: ObsidianFile[]): ObsidianFile[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const priorCount = seen.get(f.filename) ?? 0;
    seen.set(f.filename, priorCount + 1);
    if (priorCount === 0) return f;
    const dot = f.filename.lastIndexOf('.');
    const base = dot === -1 ? f.filename : f.filename.slice(0, dot);
    const ext = dot === -1 ? '' : f.filename.slice(dot);
    return { ...f, filename: `${base} (${priorCount})${ext}` };
  });
}

export function ObsidianVaultExport() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [zippingCount, setZippingCount] = useState<number | null>(null);

  const busy = status === 'fetching' || status === 'zipping';

  const handleExportVault = async () => {
    setStatus('fetching');
    setMessage(null);
    setZippingCount(null);
    try {
      const res = await lensRun<ObsidianExportResult>('export', 'obsidian', {});
      const result = res.data.result;

      if (res.data.ok === false || !result || result.ok === false) {
        setStatus('error');
        setMessage(`Export failed: ${res.data.error || result?.error || 'unknown error'}`);
        return;
      }

      const files = Array.isArray(result.files) ? result.files : [];
      if (files.length === 0) {
        setStatus('empty');
        setMessage('No DTUs to export yet — create or import some knowledge first, then come back.');
        return;
      }

      setStatus('zipping');
      setZippingCount(files.length);

      const deduped = dedupeFilenames(files);
      const zipInput: Record<string, Uint8Array> = {};
      for (const f of deduped) zipInput[f.filename] = strToU8(f.content);
      const zipped = zipSync(zipInput, { level: 6 });

      const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });
      const filename = `concord-obsidian-vault-${Date.now()}.zip`;
      triggerBlobDownload(blob, filename);

      // Best-effort history log, mirroring the bulk-export flow on this
      // page. No payload retained — a binary zip has no honest string
      // representation for the JSON history record, unlike the text
      // formats, so we log real metadata only and skip the payload field
      // rather than fabricate one.
      try {
        await lensRun('export', 'record-run', {
          format: 'obsidian-zip',
          itemCount: deduped.length,
          byteLength: zipped.byteLength,
          dataSources: ['dtus'],
          trigger: 'manual',
          filename,
        });
      } catch {
        /* history logging is best-effort */
      }

      setStatus('done');
      setMessage(`Downloaded ${deduped.length} note${deduped.length === 1 ? '' : 's'} as ${filename}`);
    } catch (e) {
      setStatus('error');
      setMessage(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  return (
    <div className="panel p-4" data-testid="obsidian-vault-export">
      <h2 className="font-semibold mb-1 flex items-center gap-2">
        <FolderArchive className="w-4 h-4 text-neon-purple" />
        Obsidian Vault Export
      </h2>
      <p className="text-sm text-gray-400 mb-4">
        Every DTU as its own Markdown note with YAML frontmatter and{' '}
        <code className="text-[11px] px-1 py-0.5 rounded bg-black/30">[[wikilink]]</code> lineage,
        packed into a real <code className="text-[11px] px-1 py-0.5 rounded bg-black/30">.zip</code> you can
        unzip straight into an Obsidian vault folder.
      </p>

      <button
        onClick={handleExportVault}
        disabled={busy}
        className="btn-neon purple py-3 px-4 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {status === 'fetching'
          ? 'Fetching notes...'
          : status === 'zipping'
            ? zippingCount && zippingCount > LARGE_VAULT_NOTE_THRESHOLD
              ? `Building zip (${zippingCount} notes — this may take a moment)...`
              : `Building zip (${zippingCount ?? ''} notes)...`
            : 'Download as Obsidian Vault (.zip)'}
      </button>

      {message && (
        <p
          className={`mt-3 text-xs flex items-start gap-1.5 ${
            status === 'error' ? 'text-red-400' : status === 'empty' ? 'text-gray-400' : 'text-neon-green'
          }`}
        >
          {status === 'error' && <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          {message}
        </p>
      )}
    </div>
  );
}
