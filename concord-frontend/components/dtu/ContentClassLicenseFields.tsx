'use client';

/**
 * ContentClassLicenseFields — shared content-class select + license-scope
 * multi-checkbox for DTU create UIs (QuickCreate, SaveAsDtuButton).
 *
 * Server (dtu.create) reads:
 *   contentClass ← input.contentClass || input.class || meta.contentClass
 *   license      ← defaultLicenseForCreate({ scopes: input.scopes || input.license?.scopes })
 * REST validate("dtuCreate") does not strip req.body unknown keys, so top-level
 * fields reach the macro. We still mirror contentClass into meta for safety.
 */

export const CONTENT_CLASSES = [
  'knowledge',
  'media',
  'formula',
  'dataset',
  'software',
  'world_asset',
  'generic',
] as const;

export type ContentClass = (typeof CONTENT_CLASSES)[number];

export const LICENSE_SCOPES = [
  'private',
  'public_listen',
  'public_view',
  'social_post',
  'marketplace_sale',
  'commercial',
] as const;

export type LicenseScope = (typeof LICENSE_SCOPES)[number];

const CLASS_LABELS: Record<ContentClass, string> = {
  knowledge: 'Knowledge',
  media: 'Media',
  formula: 'Formula',
  dataset: 'Dataset',
  software: 'Software',
  world_asset: 'World asset',
  generic: 'Generic',
};

const SCOPE_LABELS: Record<LicenseScope, string> = {
  private: 'Private',
  public_listen: 'Public listen',
  public_view: 'Public view',
  social_post: 'Social post',
  marketplace_sale: 'Marketplace sale',
  commercial: 'Commercial',
};

export interface ContentClassLicenseFieldsProps {
  contentClass: ContentClass | string;
  onContentClassChange: (value: ContentClass) => void;
  licenseScopes: string[];
  onLicenseScopesChange: (scopes: string[]) => void;
  /** Visual density: lattice (QuickCreate) vs compact zinc (SaveAs modal). */
  variant?: 'lattice' | 'compact';
  idPrefix?: string;
}

function toggleScope(current: string[], scope: string): string[] {
  if (current.includes(scope)) {
    const next = current.filter((s) => s !== scope);
    return next.length > 0 ? next : ['private'];
  }
  // Selecting a public/commercial scope: keep private if already set (creator
  // can still own private + grant public_*). No forced exclusivity.
  return [...current, scope];
}

export function ContentClassLicenseFields({
  contentClass,
  onContentClassChange,
  licenseScopes,
  onLicenseScopesChange,
  variant = 'lattice',
  idPrefix = 'dtu-ccl',
}: ContentClassLicenseFieldsProps) {
  const labelClass =
    variant === 'lattice'
      ? 'block text-sm font-medium text-gray-400 mb-1'
      : 'mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-400';
  const selectClass =
    variant === 'lattice'
      ? 'w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white focus:outline-none focus:border-neon-cyan/50'
      : 'w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-white focus:border-cyan-500/40 focus:outline-none';
  const helperClass =
    variant === 'lattice' ? 'mt-1 text-[11px] text-gray-500' : 'mt-1 text-[11px] text-zinc-500';
  const boxClass =
    variant === 'lattice'
      ? 'rounded-lg border border-lattice-border bg-lattice-deep/60 p-3 space-y-2'
      : 'rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5 space-y-1.5';
  const checkLabelClass =
    variant === 'lattice'
      ? 'flex items-center gap-2 cursor-pointer text-sm text-gray-300'
      : 'flex items-center gap-2 cursor-pointer text-xs text-zinc-300';

  const elevated =
    licenseScopes.includes('marketplace_sale') || licenseScopes.includes('social_post');

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-class`} className={labelClass}>
          Content class
        </label>
        <select
          id={`${idPrefix}-class`}
          value={contentClass}
          onChange={(e) => onContentClassChange(e.target.value as ContentClass)}
          className={selectClass}
        >
          {CONTENT_CLASSES.map((c) => (
            <option key={c} value={c}>
              {CLASS_LABELS[c]}
            </option>
          ))}
        </select>
        <p className={helperClass}>
          Media/songs use a lighter admission bar than papers
        </p>
      </div>

      <div>
        <div className={labelClass}>License scopes</div>
        <div className={boxClass} role="group" aria-label="License scopes">
          {LICENSE_SCOPES.map((scope) => {
            const id = `${idPrefix}-scope-${scope}`;
            return (
              <label key={scope} htmlFor={id} className={checkLabelClass}>
                <input
                  id={id}
                  type="checkbox"
                  checked={licenseScopes.includes(scope)}
                  onChange={() =>
                    onLicenseScopesChange(toggleScope(licenseScopes, scope))
                  }
                  className={
                    variant === 'lattice'
                      ? 'rounded border-lattice-border bg-lattice-deep'
                      : 'rounded border-zinc-700 bg-zinc-900'
                  }
                />
                <span>{SCOPE_LABELS[scope]}</span>
                <span className="text-[10px] font-mono text-gray-600">{scope}</span>
              </label>
            );
          })}
        </div>
        {elevated && (
          <p className={helperClass}>
            Marketplace sale / social post may raise council or public admission bars
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Build the create-payload fields the server actually stamps.
 * Always send contentClass top-level + meta; map licenseScopes → scopes
 * (and license.scopes) because dtuDefaultLicense reads scopes / license.scopes,
 * not licenseScopes.
 */
export function buildContentLicensePayload(
  contentClass: string,
  licenseScopes: string[],
  existingMeta?: Record<string, unknown>,
): {
  contentClass: string;
  licenseScopes: string[];
  scopes: string[];
  license: { scopes: string[] };
  meta: Record<string, unknown>;
} {
  const scopes =
    Array.isArray(licenseScopes) && licenseScopes.length > 0
      ? [...licenseScopes]
      : ['private'];
  return {
    contentClass,
    licenseScopes: scopes,
    scopes,
    license: { scopes },
    meta: {
      ...(existingMeta || {}),
      contentClass,
    },
  };
}

/**
 * Wrap a dtu.create input with contentClass + license scopes.
 * Preserves existing title/tags/source/meta; merges contentClass into meta.
 */
export function withContentLicense<T extends Record<string, unknown>>(
  input: T,
  contentClass: string,
  licenseScopes: string[],
): T {
  const payload = buildContentLicensePayload(
    contentClass,
    licenseScopes,
    (input.meta as Record<string, unknown>) || undefined,
  );
  return {
    ...input,
    contentClass: payload.contentClass,
    licenseScopes: payload.licenseScopes,
    scopes: payload.scopes,
    license: payload.license,
    meta: payload.meta,
  } as T;
}

