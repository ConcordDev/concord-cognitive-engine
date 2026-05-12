// @env-config-ok: export URL templates with brand domain
'use client';

import React, { useState, useCallback } from 'react';

interface ExportHistoryEntry {
  id: string;
  format: string;
  size: string;
  date: string;
  url?: string;
}

interface ExportEmbedProps {
  dtuId: string;
  dtuName: string;
  onExport?: (format: string, options: Record<string, unknown>) => void;
  exportHistory?: ExportHistoryEntry[];
}

type ExportFormat = 'gltf' | 'pdf' | 'embed' | 'link' | 'stl' | 'obj';
type Quality = 'low' | 'med' | 'high';

const FORMAT_LABELS: Record<ExportFormat, string> = {
  gltf: '3D Model (glTF)',
  pdf: 'Technical PDF',
  embed: 'Web Embed',
  link: 'Share Link',
  stl: 'STL',
  obj: 'OBJ',
};

const FORMAT_ICONS: Record<ExportFormat, string> = {
  gltf: '🧊',
  pdf: '📄',
  embed: '🌐',
  link: '🔗',
  stl: '⚙️',
  obj: '📐',
};

const PDF_SECTIONS = ['overview', 'structure', 'validation', 'materials', 'citations'] as const;

export default function ExportEmbed({ dtuId, dtuName, onExport, exportHistory = [] }: ExportEmbedProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('gltf');
  const [quality, setQuality] = useState<Quality>('high');
  const [includeValidation, setIncludeValidation] = useState(true);
  const [includeCitations, setIncludeCitations] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [pdfSections, setPdfSections] = useState<Set<string>>(new Set(PDF_SECTIONS));
  const [embedWidth, setEmbedWidth] = useState(640);
  const [embedHeight, setEmbedHeight] = useState(480);
  const [embedTheme, setEmbedTheme] = useState<'dark' | 'light'>('dark');
  const [autoRotate, setAutoRotate] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ url: string; size: string; embedCode: string; shareLink: string } | null>(null);
  const [shareCount] = useState(42);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const togglePdfSection = (section: string) => {
    setPdfSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const handleExport = useCallback(() => {
    setExporting(true);
    setProgress(0);
    setResult(null);

    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          setExporting(false);
          setResult({
            url: `https://concordia.world/dtu/${dtuId}/export/${selectedFormat}`,
            size: quality === 'high' ? '24.7 MB' : quality === 'med' ? '12.3 MB' : '4.1 MB',
            embedCode: `<iframe src="https://concordia.world/embed/${dtuId}" width="${embedWidth}" height="${embedHeight}" frameborder="0"></iframe>`,
            shareLink: `https://concordia.world/dtu/${dtuId}`,
          });
          return 100;
        }
        return p + 5;
      });
    }, 80);

    onExport?.(selectedFormat, { quality, includeValidation, includeCitations, includeMetadata, pdfSections: Array.from(pdfSections) });
  }, [selectedFormat, quality, includeValidation, includeCitations, includeMetadata, pdfSections, embedWidth, embedHeight, dtuId, onExport]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const panelStyle = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl">
      {/* Header */}
      <div className={`${panelStyle} p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Export &amp; Share</h2>
            <p className="text-sm text-white/50">DTU: {dtuName}</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/40">
            <span>Every export is marketing</span>
            <span className="text-amber-400 font-semibold">{shareCount} shares</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Format Selector & Options */}
        <div className={`${panelStyle} p-4 flex flex-col gap-4`}>
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Export Format</h3>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setSelectedFormat(fmt)}
                className={`p-3 rounded-lg border text-center text-sm transition-all ${
                  selectedFormat === fmt
                    ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-300'
                    : 'border-white/10 bg-white/5 text-white/60 hover:border-white/20'
                }`}
              >
                <div className="text-lg mb-1">{FORMAT_ICONS[fmt]}</div>
                {FORMAT_LABELS[fmt]}
              </button>
            ))}
          </div>

          {/* Quality */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider">Quality</label>
            <div className="flex gap-2 mt-1">
              {(['low', 'med', 'high'] as Quality[]).map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`px-4 py-1.5 rounded text-sm capitalize transition-all ${
                    quality === q
                      ? 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40'
                      : 'bg-white/5 text-white/50 border border-white/10 hover:border-white/20'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Include Options */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-white/50 uppercase tracking-wider">Include</label>
            {[
              { label: 'Validation Data', value: includeValidation, setter: setIncludeValidation },
              { label: 'Citations', value: includeCitations, setter: setIncludeCitations },
              { label: 'Metadata', value: includeMetadata, setter: setIncludeMetadata },
            ].map(({ label, value, setter }) => (
              <label key={label} className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={() => setter(!value)}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 accent-cyan-400"
                />
                {label}
              </label>
            ))}
          </div>

          {/* PDF Sections (visible when PDF selected) */}
          {selectedFormat === 'pdf' && (
            <div className="flex flex-col gap-2">
              <label className="text-xs text-white/50 uppercase tracking-wider">PDF Sections</label>
              {PDF_SECTIONS.map((section) => (
                <label key={section} className="flex items-center gap-2 text-sm text-white/70 cursor-pointer capitalize">
                  <input
                    type="checkbox"
                    checked={pdfSections.has(section)}
                    onChange={() => togglePdfSection(section)}
                    className="w-4 h-4 rounded border-white/20 bg-white/5 accent-cyan-400"
                  />
                  {section}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Embed Preview */}
        <div className={`${panelStyle} p-4 flex flex-col gap-4`}>
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Embed Preview</h3>

          <div
            className="rounded-lg border border-white/10 overflow-hidden flex items-center justify-center"
            style={{ width: '100%', height: 240, background: embedTheme === 'dark' ? '#111' : '#f0f0f0' }}
          >
            <div className={`text-center ${embedTheme === 'dark' ? 'text-white/40' : 'text-black/40'}`}>
              <div className="text-3xl mb-2">🧊</div>
              <div className="text-xs">Live Preview — {embedWidth}x{embedHeight}</div>
              <div className="text-xs mt-1">{dtuName}</div>
              {autoRotate && <div className="text-xs mt-1 animate-spin inline-block">↻</div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50">Width</label>
              <input
                type="number"
                value={embedWidth}
                onChange={(e) => setEmbedWidth(Number(e.target.value))}
                className="w-full mt-1 px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-white/50">Height</label>
              <input
                type="number"
                value={embedHeight}
                onChange={(e) => setEmbedHeight(Number(e.target.value))}
                className="w-full mt-1 px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white text-sm"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-white/50">Theme</label>
              <select
                value={embedTheme}
                onChange={(e) => setEmbedTheme(e.target.value as 'dark' | 'light')}
                className="w-full mt-1 px-3 py-1.5 rounded bg-white/5 border border-white/10 text-white text-sm"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <label className="flex items-end gap-2 text-sm text-white/60 cursor-pointer pb-1.5">
              <input type="checkbox" checked={autoRotate} onChange={() => setAutoRotate(!autoRotate)} className="accent-cyan-400" />
              Auto-Rotate
            </label>
            <label className="flex items-end gap-2 text-sm text-white/60 cursor-pointer pb-1.5">
              <input type="checkbox" checked={showControls} onChange={() => setShowControls(!showControls)} className="accent-cyan-400" />
              Controls
            </label>
          </div>

          {/* oEmbed Preview */}
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wider">oEmbed Preview</label>
            <div className="mt-2 p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex gap-3 items-start">
                <div className="w-16 h-16 rounded bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center text-2xl">
                  🧊
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{dtuName}</p>
                  <p className="text-xs text-white/40 mt-0.5">concordia.world</p>
                  <p className="text-xs text-white/50 mt-1 line-clamp-2">
                    A validated Digital Twin Unit on Concordia — explore in 3D.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Generate */}
      <div className={`${panelStyle} p-4`}>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full py-3 rounded-lg font-semibold text-sm transition-all bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? 'Exporting...' : `Generate ${FORMAT_LABELS[selectedFormat]}`}
        </button>
        {exporting && (
          <div className="mt-3 w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-100 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className={`${panelStyle} p-4 flex flex-col gap-3`}>
          <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider">Export Complete</h3>
          <div className="flex items-center justify-between text-sm">
            <a href={result.url} className="text-cyan-400 underline hover:text-cyan-300 truncate" target="_blank" rel="noreferrer">
              {result.url}
            </a>
            <span className="text-white/40 ml-2 shrink-0">{result.size}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => copyToClipboard(result.embedCode, 'embed')}
              className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/70 hover:bg-white/20 transition-all"
            >
              {copiedField === 'embed' ? '✓ Copied' : 'Copy Embed Code'}
            </button>
            <button
              onClick={() => copyToClipboard(result.shareLink, 'share')}
              className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/70 hover:bg-white/20 transition-all"
            >
              {copiedField === 'share' ? '✓ Copied' : 'Copy Share Link'}
            </button>
          </div>

          {/* Share Targets */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
            <button
              onClick={() => copyToClipboard(result.shareLink, 'link')}
              className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/70 hover:bg-white/20"
            >
              {copiedField === 'link' ? '✓ Copied' : '🔗 Copy Link'}
            </button>
            <a
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(result.shareLink)}&text=${encodeURIComponent(`Check out "${dtuName}" on Concordia!`)}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/70 hover:bg-white/20"
            >
              𝕏 Twitter/X
            </a>
            <button
              onClick={() => copyToClipboard(result.embedCode, 'portfolio')}
              className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/70 hover:bg-white/20"
            >
              {copiedField === 'portfolio' ? '✓ Copied' : '💼 Portfolio Embed'}
            </button>
          </div>
        </div>
      )}

      {/* Export History */}
      {exportHistory.length > 0 && (
        <div className={`${panelStyle} p-4`}>
          <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-3">Export History</h3>
          <div className="flex flex-col gap-2">
            {exportHistory.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-sm py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{FORMAT_ICONS[entry.format as ExportFormat] ?? '📦'}</span>
                  <span className="text-white/70 uppercase text-xs font-medium">{entry.format}</span>
                </div>
                <div className="flex items-center gap-4 text-white/40 text-xs">
                  <span>{entry.size}</span>
                  <span>{entry.date}</span>
                  {entry.url && (
                    <a href={entry.url} className="text-cyan-400 hover:underline" target="_blank" rel="noreferrer">
                      Download
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
