'use client';

import React, { useState } from 'react';
import { Copy, ExternalLink, ShieldCheck, FileText } from 'lucide-react';
import type { Citation } from '../../lib/types/atlas';
import { LicenseBadge } from './AtlasStatusBadge';

// ── Citation Card ───────────────────────────────────────────────────────

interface CitationCardProps {
  citation: Citation;
  compact?: boolean;
  onCopy?: (text: string) => void;
}

function CitationCardInner({ citation, compact = false, onCopy }: CitationCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = citation.citation_text;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy?.(text);
    });
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-elevated border border-lattice-border text-sm">
        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="flex-1 truncate text-gray-300">{citation.title}</span>
        <LicenseBadge licenseType={citation.license} size="sm" />
        <button
          onClick={handleCopy}
          className="text-gray-400 hover:text-white transition-colors"
          title="Copy citation"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-lattice-elevated border border-lattice-border p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-neon-blue" />
          <h4 className="text-sm font-medium text-white">{citation.title}</h4>
        </div>
        <LicenseBadge licenseType={citation.license} />
      </div>

      {/* Author + Date */}
      <div className="flex items-center gap-3 text-xs text-gray-400 mb-3">
        <span>by {citation.author}</span>
        <span>{new Date(citation.created_at).toLocaleDateString()}</span>
      </div>

      {/* Citation Text */}
      <div className="bg-lattice-deep rounded p-3 mb-3 border border-lattice-border">
        <p className="text-sm text-gray-300 font-mono leading-relaxed">
          {citation.citation_text}
        </p>
      </div>

      {/* Content Hash */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
        <ShieldCheck className="w-3 h-3" />
        <span className="font-mono truncate">{citation.content_hash}</span>
      </div>

      {/* Attribution notice */}
      {citation.attribution_required && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-400/80 bg-yellow-500/5 rounded px-2 py-1 mb-3">
          Attribution required when citing this work
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-neon-blue/10 text-neon-blue hover:bg-neon-blue/20 transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? 'Copied!' : 'Copy Citation'}
        </button>
      </div>
    </div>
  );
}

export const CitationCard = React.memo(CitationCardInner);

// ── Inline Citation Reference ───────────────────────────────────────────

interface InlineCitationProps {
  artifactId: string;
  title: string;
  verified?: boolean;
  onClick?: (id: string) => void;
}

export function InlineCitation({ artifactId, title, verified = false, onClick }: InlineCitationProps) {
  return (
    <button
      onClick={() => onClick?.(artifactId)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neon-blue/10 text-neon-blue text-xs hover:bg-neon-blue/20 transition-colors"
      title={`View: ${title}`}
    >
      {verified && <ShieldCheck className="w-3 h-3 text-green-400" />}
      <ExternalLink className="w-3 h-3" />
      <span className="max-w-[150px] truncate">{title}</span>
    </button>
  );
}
