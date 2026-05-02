'use client';

/**
 * PromoteDialog — Choose between Concord Global and Creative Global
 * for DTU scope promotion.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Globe, Palette, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface PromoteDialogProps {
  dtuId: string;
  onComplete: () => void;
  onCancel?: () => void;
}

function PromoteDialog({ dtuId, onComplete, onCancel }: PromoteDialogProps) {
  const [selectedScope, setSelectedScope] = useState<string | null>(null);

  const promoteMutation = useMutation({
    mutationFn: async (scope: string) => {
      const { data } = await api.post('/api/scope/promote', {
        dtuId,
        targetScope: scope,
      });
      return data as {
        ok: boolean;
        scope?: string;
        votes?: Record<string, number>;
        error?: string;
        reason?: string;
      };
    },
    onSuccess: (data) => {
      if (data.ok) onComplete();
    },
  });

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-lg mx-auto">
      <h2 className="text-lg font-semibold text-white mb-4">Share to Global</h2>

      <div className="space-y-3">
        <button
          className={`w-full text-left p-4 rounded-lg border transition-colors ${
            selectedScope === 'global'
              ? 'border-neon-cyan bg-neon-cyan/10'
              : 'border-gray-700 hover:border-gray-500'
          }`}
          onClick={() => setSelectedScope('global')}
        >
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-5 h-5 text-neon-cyan" />
            <h3 className="font-semibold text-white">Concord Global</h3>
          </div>
          <p className="text-sm text-gray-400 mb-1">Academic &amp; Instructional</p>
          <p className="text-xs text-gray-500">
            Strict review. Claims verified. High authority. For knowledge that needs to be accurate
            and trustworthy.
          </p>
          <p className="text-xs text-neon-cyan/70 mt-2">70% council approval required</p>
        </button>

        <button
          className={`w-full text-left p-4 rounded-lg border transition-colors ${
            selectedScope === 'creative_global'
              ? 'border-neon-green bg-neon-green/10'
              : 'border-gray-700 hover:border-gray-500'
          }`}
          onClick={() => setSelectedScope('creative_global')}
        >
          <div className="flex items-center gap-2 mb-1">
            <Palette className="w-5 h-5 text-neon-green" />
            <h3 className="font-semibold text-white">Creative Concord Global</h3>
          </div>
          <p className="text-sm text-gray-400 mb-1">Creative Commons</p>
          <p className="text-xs text-gray-500">
            Citation review only. Artistic freedom. For music, art, code, and creative work that
            others can remix and build on.
          </p>
          <p className="text-xs text-neon-green/70 mt-2">
            50% council approval &middot; Citations verified
          </p>
        </button>
      </div>

      {selectedScope && (
        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-3">
            {selectedScope === 'creative_global'
              ? "Your work will be available for others to discover, remix, and build on. You'll receive automatic royalties when derivatives sell."
              : 'Your knowledge will be reviewed for accuracy and added to the global knowledge infrastructure.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => promoteMutation.mutate(selectedScope)}
              disabled={promoteMutation.isPending}
              className="flex-1 px-4 py-2 bg-neon-green/20 text-neon-green border border-neon-green/30 rounded hover:bg-neon-green/30 transition-colors disabled:opacity-50 text-sm"
            >
              {promoteMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </span>
              ) : (
                'Submit for Review'
              )}
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-400 border border-gray-600 rounded hover:bg-gray-800 transition-colors text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {promoteMutation.isSuccess && promoteMutation.data?.ok && (
        <div className="mt-3 flex items-center gap-2 text-neon-green text-sm">
          <CheckCircle className="w-4 h-4" />
          <span>
            Promoted to{' '}
            {promoteMutation.data.scope === 'creative_global'
              ? 'Creative Global'
              : 'Concord Global'}
            {promoteMutation.data.votes &&
              ` (${promoteMutation.data.votes.approve}/${promoteMutation.data.votes.total} votes)`}
          </span>
        </div>
      )}

      {promoteMutation.isSuccess && !promoteMutation.data?.ok && (
        <div className="mt-3 flex items-start gap-2 text-red-400 text-sm">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {promoteMutation.data?.reason || promoteMutation.data?.error || 'Promotion rejected.'}
          </span>
        </div>
      )}

      {promoteMutation.isError && (
        <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
          <XCircle className="w-4 h-4" />
          <span>Submission failed. Check citation integrity.</span>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedPromoteDialog = withErrorBoundary(PromoteDialog);
export { _WrappedPromoteDialog as PromoteDialog };
