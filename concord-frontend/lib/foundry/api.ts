// concord-frontend/lib/foundry/api.ts
//
// Foundry lens — typed client for the foundry.* macro surface.
// Every call goes through POST /api/lens/run { domain:'foundry', name, input }.
// Mirrors server/lib/foundry/{system-registry,worldspec,compiler}.js +
// server/domains/foundry.js.

import { api } from '@/lib/api/client';

// ── Registry types (mirror server/lib/foundry/system-registry.js) ───────────

export type SystemCategory = 'world' | 'character' | 'combat' | 'npc' | 'economy' | 'social';
export type WorldScope = 'world' | 'global' | 'player';
export type SystemStatus = 'available' | 'stub';

export interface ConfigField {
  type: 'enum' | 'number' | 'bool' | 'text' | 'range';
  label: string;
  default: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
}
export type ConfigSchema = Record<string, ConfigField>;

export interface SystemEntry {
  id: string;
  category: SystemCategory;
  displayName: string;
  description: string;
  worldScope: WorldScope;
  status: SystemStatus;
  activation: { kind: string; key?: string };
  dependsOn: string[];
  conflictsWith: string[];
  configSchema: ConfigSchema;
}

export interface CategoryGroup {
  label: string;
  systems: SystemEntry[];
}

// ── Worldspec types (mirror server/lib/foundry/worldspec.js) ────────────────

export interface WorldspecSystem {
  id: string;
  config: Record<string, unknown>;
}
export interface Worldspec {
  version: number;
  template: string | null;
  theme: { universeType: string; displayName: string; palette: Record<string, unknown> | null };
  systems: WorldspecSystem[];
  rules: unknown[];
}
export interface FoundryWorld {
  id: string;
  creatorId: string;
  name: string;
  description: string;
  worldspec: Worldspec;
  status: 'draft' | 'published';
  publishedWorldId: string | null;
  previewWorldId: string | null;
  promoted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalized?: Worldspec;
  resolved?: WorldspecSystem[];
}

// ── Macro caller ────────────────────────────────────────────────────────────

async function foundryCall<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const { data } = await api.post('/api/lens/run', { domain: 'foundry', name, input });
  // /api/lens/run returns either { ok, result } (lens-action) or the
  // macro's own object directly (canonical macro path — foundry's case).
  const payload = (data && typeof data === 'object' && 'result' in data && data.result)
    ? data.result
    : data;
  return payload as T;
}

// ── Phase 1 — registry ──────────────────────────────────────────────────────

export function fetchSystems(category?: SystemCategory) {
  return foundryCall<{
    ok: boolean; count: number; total: number;
    categories: Record<SystemCategory, CategoryGroup>; systems: SystemEntry[];
  }>('systems', category ? { category } : {});
}

export function fetchSystemSchema(id: string) {
  return foundryCall<{ ok: boolean } & Partial<SystemEntry>>('system_schema', { id });
}

export function validateSystems(systems: WorldspecSystem[]) {
  return foundryCall<ValidationResult>('validate_systems', { systems });
}

// ── Phase 2 — worldspec persistence ─────────────────────────────────────────

export function createWorld(name: string, description?: string, worldspec?: Partial<Worldspec>) {
  return foundryCall<{ ok: boolean; world?: FoundryWorld; reason?: string }>('create', {
    name, description, worldspec,
  });
}
export function updateWorld(
  id: string,
  patch: { name?: string; description?: string; worldspec?: Partial<Worldspec> },
) {
  return foundryCall<{ ok: boolean; world?: FoundryWorld; reason?: string }>('update', { id, ...patch });
}
export function getWorld(id: string) {
  return foundryCall<{ ok: boolean; world?: FoundryWorld; reason?: string }>('get', { id });
}
export function listWorlds(limit = 50) {
  return foundryCall<{ ok: boolean; count: number; worlds: FoundryWorld[] }>('list', { limit });
}
export function deleteWorld(id: string) {
  return foundryCall<{ ok: boolean; deleted?: string; reason?: string }>('delete', { id });
}
export function validateWorld(arg: { id: string } | { worldspec: Partial<Worldspec> }) {
  return foundryCall<ValidationResult>('validate', arg as Record<string, unknown>);
}

// ── Phase 3 — publish pipeline ──────────────────────────────────────────────

export function publishWorld(id: string) {
  return foundryCall<{
    ok: boolean; reason?: string; publishedWorldId?: string;
    world?: FoundryWorld; activatedSystems?: string[]; skippedStubs?: string[];
    contentSeeds?: string[]; errors?: string[];
  }>('publish', { id });
}
export function unpublishWorld(id: string) {
  return foundryCall<{
    ok: boolean; reason?: string; disposition?: string;
    formerWorldId?: string; world?: FoundryWorld;
  }>('unpublish', { id });
}

// ── Phase 5 — live 3D preview ───────────────────────────────────────────────

export function previewWorld(id: string) {
  return foundryCall<{
    ok: boolean; reason?: string; previewWorldId?: string;
    universeType?: string; activatedSystems?: string[]; skippedStubs?: string[];
  }>('preview', { id });
}
export function endPreview(id: string) {
  return foundryCall<{ ok: boolean; reason?: string }>('preview_end', { id });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A blank worldspec — mirror of server emptyWorldspec(). */
export function emptyWorldspec(): Worldspec {
  return {
    version: 1,
    template: null,
    theme: { universeType: 'fantasy', displayName: '', palette: null },
    systems: [],
    rules: [],
  };
}

/** Build a default config object from a system's schema. */
export function defaultConfig(schema: ConfigSchema): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const [field, desc] of Object.entries(schema)) cfg[field] = desc.default;
  return cfg;
}
