'use client';

/**
 * PluginInstallConsent — the "what is this plugin asking for" disclosure
 * moment. Enumerates the plugin's real `declaredCapabilities` (the SAME
 * macro-domain grant list `installFromGallery` forwards to the sandbox as
 * its manifest — see `server/lib/plugin-gallery.js`'s `publishPlugin` /
 * `installFromGallery` comments) and the honest `trustDescription` BEFORE
 * calling `POST /api/plugins/gallery/:id/install`.
 *
 * A validation/install failure renders verbatim from the real API response
 * (`error` / `reason` / `validation.errors`) — never a fabricated success,
 * never a generic "something went wrong."
 */

import { useState } from 'react';
import { ShieldAlert, ShieldCheck, X, Loader2 } from 'lucide-react';
import type { GalleryPlugin, InstallResponse } from './types';

export interface PluginInstallConsentProps {
  plugin: GalleryPlugin;
  onCancel: () => void;
  onInstalled: (result: InstallResponse, plugin: GalleryPlugin) => void;
}

function describeFailure(result: Extract<InstallResponse, { ok: false }>): string {
  const parts: string[] = [result.error];
  if (result.reason) parts.push(result.reason);
  return parts.join(' — ');
}

export function PluginInstallConsent({ plugin, onCancel, onInstalled }: PluginInstallConsentProps) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const capabilities = plugin.declaredCapabilities?.length ? plugin.declaredCapabilities : [];

  async function confirmInstall() {
    setInstalling(true);
    setError(null);
    setValidationErrors([]);
    try {
      const res = await fetch(`/api/plugins/gallery/${encodeURIComponent(plugin.pluginId)}/install`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json().catch(() => null)) as InstallResponse | null;
      if (!body) {
        setError(`Install request failed (HTTP ${res.status})`);
        return;
      }
      if (!body.ok) {
        setError(describeFailure(body));
        setValidationErrors(Array.isArray(body.validation?.errors) ? body.validation!.errors! : []);
        return;
      }
      onInstalled(body, plugin);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Install ${plugin.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Install {plugin.name}</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">v{plugin.version} · by {plugin.authorId}</p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Cancel install"
            className="rounded-md p-1 text-slate-500 hover:bg-zinc-900 hover:text-slate-300"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div
          className={`mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] ${
            plugin.trusted
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          }`}
        >
          {plugin.trusted ? (
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{plugin.trustDescription}</span>
        </div>

        <div className="mb-3">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            This plugin is asking for
          </h3>
          {capabilities.length === 0 ? (
            <p className="text-[11px] text-slate-500">No macro-domain grants declared.</p>
          ) : (
            <ul className="space-y-1" aria-label="Requested capabilities">
              {capabilities.map((cap) => (
                <li
                  key={cap}
                  className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-[11px] text-slate-300"
                >
                  {cap}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
            <p className="font-medium">Install failed</p>
            <p className="mt-0.5 break-words">{error}</p>
            {validationErrors.length > 0 && (
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {validationErrors.map((v, i) => (
                  <li key={i} className="break-words">{v}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={installing}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-[12px] text-slate-300 hover:bg-zinc-900 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={confirmInstall}
            disabled={installing}
            className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
          >
            {installing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {installing ? 'Installing…' : 'Grant & Install'}
          </button>
        </div>
      </div>
    </div>
  );
}
