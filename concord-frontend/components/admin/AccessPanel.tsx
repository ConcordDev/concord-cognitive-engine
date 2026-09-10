'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useRunArtifact, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useUIStore } from '@/store/ui';
import { ds } from '@/lib/design-system';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  AlertCircle,
  Building,
  CheckCircle,
  ChevronRight,
  Grid3X3,
  Key,
  Loader2,
  Users,
  XCircle,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';

export function AccessPanel() {
  return (
    <div className="space-y-8">
      <ApiKeysSection />
      <OrgsSection />
      <PermissionMatrixSection />
    </div>
  );
}

function ApiKeysSection() {
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: keysData, refetch, isError, error } = useQuery({
    queryKey: ['admin-api-keys'],
    queryFn: () => api.get('/api/v1/keys').then((r) => r.data),
  });

  const handleCreate = useCallback(async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const data = await api.post('/api/v1/keys/create', { name: newKeyName.trim() }).then((r) => r.data);
      setCreatedKey(data?.key || data?.apiKey || null);
      setNewKeyName('');
      void refetch();
    } catch (e) {
      console.error('[Admin] Failed to create API key:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to create API key' });
    } finally {
      setCreating(false);
    }
  }, [newKeyName, refetch]);

  const handleRevoke = useCallback(
    async (keyId: string) => {
      await api.delete(`/api/v1/keys/${keyId}`).then((r) => r.data);
      void refetch();
    },
    [refetch],
  );

  const keys = keysData?.keys || [];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Key className="w-4 h-4" /> API keys
      </h2>
      {isError && (
        <ErrorState
          variant="inline"
          message={error instanceof Error ? error.message : 'Failed to list API keys'}
          onRetry={() => void refetch()}
        />
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
          placeholder="Key name…"
          className={ds.input}
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating || !newKeyName.trim()}
          className={ds.btnPrimary}
        >
          Create
        </button>
      </div>
      {createdKey && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <p className="text-xs text-green-400 mb-1">New API key (copy now):</p>
          <code className="text-sm text-white break-all">{createdKey}</code>
        </div>
      )}
      {keys.length === 0 ? (
        <EmptyState title="No API keys" description="Create a named key to call the public API." compact />
      ) : (
        <div className="space-y-2">
          {keys.map((k: { id: string; name: string; prefix?: string }) => (
            <div
              key={k.id}
              className="flex items-center justify-between p-3 rounded-lg border border-lattice-border bg-lattice-deep"
            >
              <div>
                <p className="text-sm text-white font-medium">{k.name}</p>
                <p className="text-xs text-gray-400 font-mono">
                  {k.prefix ? `${k.prefix}…` : k.id.slice(0, 8)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRevoke(k.id)}
                className={ds.btnDanger}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OrgsSection() {
  const { data: orgsData, isError, error, refetch } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api.get('/api/org/list').then((r) => r.data),
    refetchInterval: 60000,
    retry: false,
  });

  const orgs = orgsData?.orgs || [];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <Building className="w-4 h-4" /> Organizations
      </h2>
      {isError && (
        <ErrorState
          variant="inline"
          message={error instanceof Error ? error.message : 'Failed to list organizations'}
          onRetry={() => void refetch()}
        />
      )}
      {orgs.length === 0 ? (
        <EmptyState title="No organizations" description="/api/org/list returned none." compact />
      ) : (
        <div className="space-y-2">
          {orgs.map((org: { id: string; name: string; memberCount?: number }) => (
            <div
              key={org.id}
              className="flex items-center justify-between p-3 rounded-lg border border-lattice-border bg-lattice-deep"
            >
              <div>
                <p className="text-sm text-white font-medium">{org.name}</p>
                {org.memberCount !== undefined && (
                  <p className="text-xs text-gray-400">{org.memberCount} members</p>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  api
                    .post(`/api/org/${org.id}/promote`, { dtuId: '' })
                    .then((r) => r.data)
                    .catch((e) => {
                      console.error('[Admin] Failed to promote org:', e);
                      useUIStore.getState().addToast({ type: 'error', message: 'Failed to promote organization' });
                    })
                }
                className={ds.btnSecondary}
              >
                Promote
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PermissionMatrixSection() {
  const runAction = useRunArtifact('admin');
  const createArtifact = useCreateArtifact('admin');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const live = await api
        .get<{
          ok: boolean;
          roles: Array<{ name: string; permissions: string[] }>;
          users: Array<{ userId: string; roles: string[] }>;
          sodRules: Array<{ name: string; conflicting: string[] }>;
        }>('/api/admin/permission-matrix/data')
        .then((r) => r.data);
      if (!live?.ok) throw new Error('Failed to load permission matrix data');
      const created = await createArtifact.mutateAsync({
        type: 'PermSnapshot',
        title: `Permission Matrix ${new Date().toLocaleString()}`,
        data: { roles: live.roles, users: live.users, sodRules: live.sodRules } as Record<string, unknown>,
      });
      const res = await runAction.mutateAsync({
        id: created.artifact.id,
        action: 'permissionMatrix',
      });
      if (res.ok === false) {
        setResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error('[Admin] Permission matrix action failed:', e);
      setErr(e instanceof Error ? e.message : 'Permission matrix analysis failed');
    } finally {
      setLoading(false);
    }
  }, [createArtifact, runAction]);

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Grid3X3 className="w-4 h-4" /> Permission matrix
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">admin.permissionMatrix</span>
          </h2>
          <p className={ds.textMuted}>
            Live roles + SoD rules from /api/admin/permission-matrix/data, then the analysis macro.
          </p>
        </div>
        <button type="button" onClick={() => void handleRun()} disabled={loading} className={ds.btnPrimary}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid3X3 className="w-4 h-4" />}
          {loading ? 'Analyzing…' : 'Run analysis'}
        </button>
      </div>
      {err && (
        <ErrorState variant="inline" message={err} onRetry={() => void handleRun()} />
      )}
      {result && <PermissionMatrixResult result={result} />}
    </section>
  );
}

function PermissionMatrixResult({ result }: { result: Record<string, unknown> }) {
  const reduceMotion = useReducedMotion();
  const matrix = (result.matrix || {}) as Record<string, Record<string, boolean>>;
  const summary = (result.summary || {}) as Record<string, number>;
  const overPrivilegedRoles = (result.overPrivilegedRoles || []) as Array<Record<string, unknown>>;
  const redundantRoles = (result.redundantRoles || []) as Array<Record<string, unknown>>;
  const sodViolations = (result.sodViolations || []) as Array<Record<string, unknown>>;
  const unknownRoles = (result.unknownRoles || []) as Array<Record<string, unknown>>;
  const usersWithNoRoles = (result.usersWithNoRoles || []) as string[];
  const roleNames = Object.keys(matrix);
  const permNames = roleNames.length > 0 ? Object.keys(matrix[roleNames[0]]) : [];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric n={result.totalRoles as number} label="Roles" />
        <Metric n={result.totalPermissions as number} label="Permissions" />
        <Metric n={summary.overPrivilegedCount || 0} label="Over-privileged" warn={(summary.overPrivilegedCount || 0) > 0} />
        <Metric n={summary.sodViolationCount || 0} label="SoD violations" warn={(summary.sodViolationCount || 0) > 0} />
        <Metric n={result.totalUsers as number} label="Users" />
      </div>

      {roleNames.length > 0 && permNames.length > 0 && (
        <div className="p-4 rounded-lg bg-black/30 border border-lattice-border overflow-x-auto">
          <p className="text-xs font-medium text-gray-400 mb-3">Role × permission</p>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left p-1.5 text-gray-400 font-medium sticky left-0 bg-black/30">Role</th>
                {permNames.map((p) => (
                  <th key={p} className="p-1.5 text-gray-400 font-medium text-center whitespace-nowrap">
                    <span className="inline-block -rotate-45 origin-bottom-left translate-y-1">{p}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roleNames.map((role) => (
                <tr key={role} className="border-t border-white/5">
                  <td className="p-1.5 text-white font-medium sticky left-0 bg-black/30 whitespace-nowrap">{role}</td>
                  {permNames.map((perm) => (
                    <td key={perm} className="p-1.5 text-center">
                      {matrix[role][perm] ? (
                        <span className="inline-block w-5 h-5 rounded bg-white/10 border border-white/20 leading-5 text-white font-bold">
                          ✓
                        </span>
                      ) : (
                        <span className="inline-block w-5 h-5 rounded bg-white/5 border border-white/10 leading-5 text-gray-700">
                          -
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {overPrivilegedRoles.map((r, i) => (
        <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-orange-500/5 border border-orange-500/15">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-orange-400" />
            <span className="text-sm text-white font-medium">{r.role as string}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-400">{r.permCount as number} permissions</span>
            <span className="text-orange-400 font-medium">{r.ratio as number}% coverage</span>
          </div>
        </div>
      ))}

      {redundantRoles.map((r, i) => (
        <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/15 text-xs">
          <span className="text-white font-medium">{r.subset as string}</span>
          <ChevronRight className="w-3 h-3 text-gray-400" />
          <span className="text-white font-medium">{r.superset as string}</span>
          <span className="text-gray-400 ml-auto">
            {r.subsetSize as number} vs {r.supersetSize as number} perms
          </span>
        </div>
      ))}

      {sodViolations.map((v, i) => (
        <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-red-500/5 border border-red-500/15">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-white">{v.userId as string}</span>
            <span className="text-xs text-gray-400">Rule: {v.rule as string}</span>
          </div>
          <span className="text-xs text-red-400 font-mono">
            {((v.conflictingPermissions as string[]) || []).join(' + ')}
          </span>
        </div>
      ))}

      <div className="flex gap-4 flex-wrap">
        {unknownRoles.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/5 border border-yellow-500/15 text-xs text-yellow-400">
            <AlertCircle className="w-3 h-3" />
            {unknownRoles.length} unknown role reference{unknownRoles.length !== 1 ? 's' : ''}
          </div>
        )}
        {usersWithNoRoles.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-400">
            <Users className="w-3 h-3" />
            {usersWithNoRoles.length} user{usersWithNoRoles.length !== 1 ? 's' : ''} with no roles
          </div>
        )}
      </div>

      {overPrivilegedRoles.length === 0 &&
        sodViolations.length === 0 &&
        redundantRoles.length === 0 &&
        unknownRoles.length === 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <div>
              <p className="text-sm text-green-400 font-medium">Permission model is clean</p>
              <p className="text-xs text-gray-400">No over-privileged roles, redundancies, or SoD violations detected.</p>
            </div>
          </div>
        )}
    </motion.div>
  );
}

function Metric({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-lattice-deep border border-lattice-border text-center">
      <p className={`text-xl font-mono tabular-nums ${warn ? 'text-orange-400' : 'text-white'}`}>{n ?? 0}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
