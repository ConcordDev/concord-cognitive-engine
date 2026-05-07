"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { showToast } from '@/components/common/Toasts';

interface ArtifactInfo {
  type: string;
  filename: string;
  sizeBytes: number;
  multipart: boolean;
  parts?: { filename: string; type: string; sizeBytes: number }[];
  hasThumbnail?: boolean;
  hasPreview?: boolean;
}

interface ArtifactRendererProps {
  dtuId: string;
  artifact: ArtifactInfo;
  mode?: "inline" | "full" | "thumbnail" | "preview";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function DownloadButton({ url, filename, label }: { url: string; filename?: string; label?: string }) {
  return (
    <a
      href={url}
      download={filename}
      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
    >
      {label || "Download"}
    </a>
  );
}

function WaveformDisplay({ dtuId }: { dtuId: string }) {
  const [peaks, setPeaks] = useState<number[]>([]);

  // Fetch waveform data on mount
  useEffect(() => {
    fetch(`/api/artifact/${dtuId}/thumbnail`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPeaks(data); })
      .catch(err => { console.error('[ArtifactRenderer] Failed to load waveform:', err); showToast('error', 'Failed to load content'); });
  }, [dtuId]);

  if (!peaks.length) return <div className="h-12 bg-zinc-900 rounded animate-pulse" />;

  return (
    <svg viewBox={`0 0 ${peaks.length} 100`} className="w-full h-12 text-emerald-500" preserveAspectRatio="none">
      {peaks.map((p, i) => (
        <rect key={i} x={i} y={50 - p * 50} width={1} height={Math.max(1, p * 100)} fill="currentColor" opacity={0.8} />
      ))}
    </svg>
  );
}

export function ArtifactRenderer({ dtuId, artifact, mode = "inline" }: ArtifactRendererProps) {
  const streamUrl = `/api/artifact/${dtuId}/stream`;
  const downloadUrl = `/api/artifact/${dtuId}/download`;
  const zipUrl = `/api/artifact/${dtuId}/zip`;

  // Audio
  if (artifact.type.startsWith("audio/")) {
    if (mode === "thumbnail") return <WaveformDisplay dtuId={dtuId} />;
    return (
      <div className="space-y-2">
        <WaveformDisplay dtuId={dtuId} />
        <audio controls preload="metadata" src={streamUrl} className="w-full" />
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>{artifact.filename} — {formatSize(artifact.sizeBytes)}</span>
          <div className="flex gap-2">
            <DownloadButton url={downloadUrl} filename={artifact.filename} />
            <DownloadButton url={zipUrl} filename={`${artifact.filename}.zip`} label="ZIP" />
          </div>
        </div>
      </div>
    );
  }

  // Image
  if (artifact.type.startsWith("image/")) {
    if (mode === "thumbnail") {
      return <Image src={streamUrl} className="w-full h-32 object-cover rounded" alt={artifact.filename} width={400} height={128} unoptimized />;
    }
    return (
      <div className="space-y-2">
        <Image src={streamUrl} alt={artifact.filename} className="w-full rounded-lg max-h-96 object-contain bg-zinc-900" width={800} height={384} unoptimized />
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>{artifact.filename} — {formatSize(artifact.sizeBytes)}</span>
          <DownloadButton url={downloadUrl} filename={artifact.filename} />
        </div>
      </div>
    );
  }

  // Video
  if (artifact.type.startsWith("video/")) {
    return (
      <div className="space-y-2">
        <video controls preload="metadata" src={streamUrl} className="w-full rounded-lg max-h-96" />
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>{artifact.filename} — {formatSize(artifact.sizeBytes)}</span>
          <DownloadButton url={downloadUrl} filename={artifact.filename} />
        </div>
      </div>
    );
  }

  // PDF
  if (artifact.type.includes("pdf")) {
    return (
      <div className="space-y-2">
        <iframe src={streamUrl} className="w-full h-96 rounded-lg border border-zinc-700" />
        <DownloadButton url={downloadUrl} filename={artifact.filename} />
      </div>
    );
  }

  // MEGA SPEC: MIDI preview
  if (artifact.type === "audio/midi" || artifact.filename?.endsWith(".mid") || artifact.filename?.endsWith(".midi")) {
    return <MidiPreview dtuId={dtuId} filename={artifact.filename} downloadUrl={downloadUrl} />;
  }

  // MEGA SPEC: CSV table preview
  if (artifact.type === "text/csv" || artifact.filename?.endsWith(".csv")) {
    return <CSVTablePreview dtuId={dtuId} filename={artifact.filename} downloadUrl={downloadUrl} />;
  }

  // MEGA SPEC: SVG inline preview
  if (artifact.type === "image/svg+xml" || artifact.filename?.endsWith(".svg")) {
    return (
      <div className="space-y-2">
        <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 flex items-center justify-center">
          <Image src={streamUrl} alt={artifact.filename} className="max-w-full max-h-96" width={800} height={384} unoptimized />
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>{artifact.filename} — {formatSize(artifact.sizeBytes)}</span>
          <DownloadButton url={downloadUrl} filename={artifact.filename} />
        </div>
      </div>
    );
  }

  // MEGA SPEC: Calendar event preview (ICS)
  if (artifact.type === "text/calendar" || artifact.filename?.endsWith(".ics")) {
    return <CalendarEventPreview dtuId={dtuId} filename={artifact.filename} downloadUrl={downloadUrl} />;
  }

  // MEGA SPEC: Markdown preview
  if (artifact.type === "text/markdown" || artifact.filename?.endsWith(".md")) {
    return <MarkdownPreview dtuId={dtuId} filename={artifact.filename} sizeBytes={artifact.sizeBytes} downloadUrl={downloadUrl} />;
  }

  // MEGA SPEC: HTML sandboxed preview.
  // SECURITY: sandbox is empty — NO scripts, NO same-origin, NO form
  // submission, NO popups. HTML DTUs can come from any user, and
  // `sandbox="allow-scripts"` would let a malicious upload execute JS
  // in every viewer's browser. The preview renders the raw document as
  // static HTML/CSS only; users who want the full rendered experience
  // can click the Download button and open the file locally.
  if (artifact.type === "text/html" || artifact.filename?.endsWith(".html")) {
    return (
      <div className="space-y-2">
        <iframe
          src={streamUrl}
          className="w-full h-96 rounded-lg border border-zinc-700 bg-white"
          sandbox=""
          referrerPolicy="no-referrer"
          title={`HTML preview: ${artifact.filename || 'artifact'}`}
        />
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>{artifact.filename} — {formatSize(artifact.sizeBytes)}</span>
          <DownloadButton url={downloadUrl} filename={artifact.filename} />
        </div>
      </div>
    );
  }

  // Text/Code
  if (artifact.type.startsWith("text/") || artifact.type.includes("json") || artifact.type.includes("javascript")) {
    return <TextViewer dtuId={dtuId} filename={artifact.filename} sizeBytes={artifact.sizeBytes} downloadUrl={downloadUrl} />;
  }

  // Multipart
  if (artifact.multipart && artifact.parts) {
    return (
      <div className="space-y-2 p-3 rounded-lg bg-zinc-900 border border-zinc-700">
        <h4 className="text-sm font-medium text-zinc-200">Project: {artifact.parts.length} files</h4>
        <ul className="space-y-1">
          {artifact.parts.map((part, i) => (
            <li key={i} className="flex items-center justify-between text-xs text-zinc-400">
              <span>{part.filename}</span>
              <span>{formatSize(part.sizeBytes)}</span>
            </li>
          ))}
        </ul>
        <DownloadButton url={zipUrl} label="Download All (ZIP)" />
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-700">
      <span className="text-sm text-zinc-300">{artifact.filename} — {formatSize(artifact.sizeBytes)}</span>
      <DownloadButton url={downloadUrl} filename={artifact.filename} />
    </div>
  );
}

function TextViewer({ dtuId, filename, sizeBytes, downloadUrl }: { dtuId: string; filename: string; sizeBytes: number; downloadUrl: string }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/artifact/${dtuId}/stream`)
      .then(r => r.text())
      .then(text => setContent(text.slice(0, 5000)))
      .catch(() => setContent("Error loading file"));
  }, [dtuId]);

  return (
    <div className="space-y-2">
      <pre className="p-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-300 overflow-auto max-h-64 font-mono">
        {content || "Loading..."}
      </pre>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{filename} — {formatSize(sizeBytes)}</span>
        <DownloadButton url={downloadUrl} filename={filename} />
      </div>
    </div>
  );
}

// MEGA SPEC: CSV Table Preview
function CSVTablePreview({ dtuId, filename, downloadUrl }: { dtuId: string; filename: string; downloadUrl: string }) {
  const [rows, setRows] = useState<string[][]>([]);

  useEffect(() => {
    fetch(`/api/artifact/${dtuId}/stream`)
      .then(r => r.text())
      .then(text => {
        const parsed = text.split("\n").filter(Boolean).map(line =>
          line.split(",").map(cell => cell.replace(/^"|"$/g, "").trim())
        );
        setRows(parsed.slice(0, 100));
      })
      .catch(err => { console.error('[ArtifactRenderer] Failed to load CSV data:', err); showToast('error', 'Failed to load content'); });
  }, [dtuId]);

  if (!rows.length) return <div className="h-32 bg-zinc-900 rounded animate-pulse" />;

  const headers = rows[0];
  const data = rows.slice(1);

  return (
    <div className="space-y-2">
      <div className="overflow-auto max-h-96 rounded-lg border border-zinc-700">
        <table className="w-full text-xs">
          <thead className="bg-zinc-800 sticky top-0">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-zinc-400 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-800/50">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 text-zinc-300 whitespace-nowrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{filename} — {data.length} rows</span>
        <DownloadButton url={downloadUrl} filename={filename} />
      </div>
    </div>
  );
}

// MEGA SPEC: MIDI Preview
function MidiPreview({ dtuId, filename, downloadUrl }: { dtuId: string; filename: string; downloadUrl: string }) {
  const [midiData, setMidiData] = useState<{ notes?: { pitch: number; time: number; duration: number }[]; duration?: number } | null>(null);

  useEffect(() => {
    fetch(`/api/artifact/${dtuId}/stream`)
      .then(r => r.json())
      .then(data => setMidiData(data))
      .catch(() => setMidiData(null));
  }, [dtuId]);

  return (
    <div className="space-y-2 p-3 rounded-lg bg-zinc-900 border border-zinc-700">
      <div className="flex items-center gap-2">
        <span className="text-neon-purple text-lg">{'\u266B'}</span>
        <span className="text-sm text-zinc-200">{filename}</span>
        {midiData?.duration && (
          <span className="text-xs text-zinc-500">{Math.round(midiData.duration)}s</span>
        )}
      </div>
      <div className="h-24 bg-zinc-800 rounded overflow-hidden relative">
        {midiData?.notes && midiData.notes.length > 0 ? (
          <svg viewBox="0 0 200 100" className="w-full h-full" preserveAspectRatio="none">
            {midiData.notes.slice(0, 500).map((note, i) => {
              const maxTime = midiData.duration || 1;
              const x = (note.time / maxTime) * 200;
              const w = Math.max(1, (note.duration / maxTime) * 200);
              const y = 100 - ((note.pitch - 21) / 87) * 100;
              return (
                <rect key={i} x={x} y={y} width={w} height={2} fill="#a855f7" opacity={0.7} />
              );
            })}
          </svg>
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-zinc-500">
            MIDI piano roll preview
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <DownloadButton url={downloadUrl} filename={filename} />
      </div>
    </div>
  );
}

// MEGA SPEC: Calendar Event Preview (ICS)
function CalendarEventPreview({ dtuId, filename, downloadUrl }: { dtuId: string; filename: string; downloadUrl: string }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/artifact/${dtuId}/stream`)
      .then(r => r.text())
      .then(text => setContent(text.slice(0, 2000)))
      .catch(() => setContent(null));
  }, [dtuId]);

  const summary = content?.match(/SUMMARY:(.*)/)?.[1]?.trim() || filename;
  const dtStart = content?.match(/DTSTART[^:]*:(.*)/)?.[1]?.trim() || "";
  const location = content?.match(/LOCATION:(.*)/)?.[1]?.trim() || "";

  return (
    <div className="space-y-2 p-3 rounded-lg bg-zinc-900 border border-zinc-700">
      <div className="flex items-center gap-2">
        <span className="text-neon-cyan text-lg">{'\uD83D\uDCC5'}</span>
        <div>
          <p className="text-sm font-medium text-zinc-200">{summary}</p>
          {dtStart && <p className="text-xs text-zinc-400">{dtStart}</p>}
          {location && <p className="text-xs text-zinc-500">{location}</p>}
        </div>
      </div>
      <DownloadButton url={downloadUrl} filename={filename} label="Add to Calendar" />
    </div>
  );
}

// MEGA SPEC: Markdown Preview
function MarkdownPreview({ dtuId, filename, sizeBytes, downloadUrl }: { dtuId: string; filename: string; sizeBytes: number; downloadUrl: string }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/artifact/${dtuId}/stream`)
      .then(r => r.text())
      .then(text => setContent(text.slice(0, 10000)))
      .catch(() => setContent("Error loading file"));
  }, [dtuId]);

  return (
    <div className="space-y-2">
      <div className="p-4 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 overflow-auto max-h-96 prose prose-invert prose-sm max-w-none">
        <pre className="whitespace-pre-wrap font-sans">{content || "Loading..."}</pre>
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{filename} — {formatSize(sizeBytes)}</span>
        <DownloadButton url={downloadUrl} filename={filename} />
      </div>
    </div>
  );
}

export default ArtifactRenderer;
