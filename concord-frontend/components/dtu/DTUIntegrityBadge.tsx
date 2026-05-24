'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronUp, Archive, FileCheck } from 'lucide-react';
import type { IntegrityStatus, IntegrityReport } from '../../lib/types/canonical';

interface DTUIntegrityBadgeProps {
  dtuId: string;
  status: IntegrityStatus;
  contentHash?: string;
  compressionRatio?: number;
  compressionAlgorithm?: string;
  originalSize?: number;
  compressedSize?: number;
  verifiedAt?: string;
  integrityReport?: IntegrityReport | null;
  onVerify?: (dtuId: string) => void;
  compact?: boolean;
}

const statusConfig: Record<IntegrityStatus, {
  Icon: typeof Shield;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  description: string;
}> = {
  verified: {
    Icon: ShieldCheck,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    label: 'Verified',
    description: 'Content integrity confirmed. Hash and signature match.',
  },
  unverified: {
    Icon: ShieldAlert,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    label: 'Unverified',
    description: 'Integrity has not been checked. Click to verify.',
  },
  tampered: {
    Icon: ShieldX,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    label: 'Tampered',
    description: 'Content has been modified. Hash does not match original.',
  },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function DTUIntegrityBadgeInner({
  dtuId,
  status,
  contentHash,
  compressionRatio,
  compressionAlgorithm,
  originalSize,
  compressedSize,
  verifiedAt,
  integrityReport,
  onVerify,
  compact = false,
}: DTUIntegrityBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[status];
  const StatusIcon = config.Icon;

  const handleClick = useCallback(() => {
    if (status === 'unverified' && onVerify) {
      onVerify(dtuId);
    } else {
      setExpanded(prev => !prev);
    }
  }, [status, onVerify, dtuId]);

  const savingsPercent = useMemo(() => {
    if (compressionRatio === undefined || compressionRatio === null) return null;
    return ((1 - compressionRatio) * 100).toFixed(1);
  }, [compressionRatio]);

  const storageSaved = useMemo(() => {
    if (originalSize === undefined || compressedSize === undefined) return null;
    return originalSize - compressedSize;
  }, [originalSize, compressedSize]);

  // Compact badge: just the icon and status
  if (compact) {
    return (
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${config.bgColor} ${config.borderColor} border transition-colors hover:opacity-80`}
        title={`${config.label}: ${config.description}`}
      >
        <StatusIcon className={`w-3 h-3 ${config.color}`} />
        <span className={config.color}>{config.label}</span>
        {savingsPercent !== null && (
          <span className="text-gray-400 ml-1">
            {savingsPercent}% saved
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} overflow-hidden`}>
      {/* Badge header */}
      <button
        onClick={handleClick}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-4 h-4 ${config.color}`} />
          <span className={`text-sm font-medium ${config.color}`}>
            {config.label}
          </span>
          {verifiedAt && (
            <span className="text-xs text-gray-400">
              {formatTimeAgo(verifiedAt)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Compression ratio badge */}
          {savingsPercent !== null && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Archive className="w-3 h-3" />
              {savingsPercent}% saved
            </span>
          )}

          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded report */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/5">
          {/* Status description */}
          <p className="text-xs text-gray-400 pt-2">{config.description}</p>

          {/* Content hash */}
          {contentHash && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <FileCheck className="w-3 h-3" />
                <span>Content Hash (SHA-256)</span>
              </div>
              <code className="block text-xs text-gray-300 bg-black/30 px-2 py-1 rounded font-mono break-all">
                {contentHash}
              </code>
            </div>
          )}

          {/* Compression details */}
          {(compressionAlgorithm || storageSaved !== null) && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <Archive className="w-3 h-3" />
                <span>Compression</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {compressionAlgorithm && (
                  <div className="bg-black/20 px-2 py-1 rounded">
                    <span className="text-gray-400">Algorithm: </span>
                    <span className="text-gray-300">{compressionAlgorithm.toUpperCase()}</span>
                  </div>
                )}
                {compressionRatio !== undefined && (
                  <div className="bg-black/20 px-2 py-1 rounded">
                    <span className="text-gray-400">Ratio: </span>
                    <span className="text-gray-300">{(compressionRatio * 100).toFixed(1)}%</span>
                  </div>
                )}
                {originalSize !== undefined && (
                  <div className="bg-black/20 px-2 py-1 rounded">
                    <span className="text-gray-400">Original: </span>
                    <span className="text-gray-300">{formatBytes(originalSize)}</span>
                  </div>
                )}
                {compressedSize !== undefined && (
                  <div className="bg-black/20 px-2 py-1 rounded">
                    <span className="text-gray-400">Stored: </span>
                    <span className="text-gray-300">{formatBytes(compressedSize)}</span>
                  </div>
                )}
              </div>
              {storageSaved !== null && storageSaved > 0 && (
                <div className="text-xs text-green-400/80">
                  Saving {formatBytes(storageSaved)} of storage
                </div>
              )}
            </div>
          )}

          {/* Integrity report details */}
          {integrityReport && (
            <div className="space-y-1">
              <div className="text-xs text-gray-400">Layer Checksums</div>
              <div className="space-y-1">
                {Object.entries(integrityReport.layerChecksums).map(([layer, checksum]) => (
                  <div key={layer} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-20 truncate">{layer}:</span>
                    <code className="text-gray-400 font-mono truncate flex-1">
                      {checksum.slice(0, 16)}...
                    </code>
                  </div>
                ))}
              </div>

              {integrityReport.signedBy && (
                <div className="text-xs text-gray-400 pt-1">
                  Signed by: <span className="text-gray-300">{integrityReport.signedBy}</span>
                  {integrityReport.signedAt && (
                    <span className="text-gray-400"> ({formatTimeAgo(integrityReport.signedAt)})</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Verify button for unverified DTUs */}
          {status === 'unverified' && onVerify && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVerify(dtuId);
              }}
              className="w-full text-xs px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors border border-yellow-500/30"
            >
              Verify Integrity Now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const DTUIntegrityBadge = React.memo(DTUIntegrityBadgeInner);
