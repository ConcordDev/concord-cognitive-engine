/**
 * Concordia server-authority combat + quest helpers.
 *
 * Preferred online path: WS `combat:attack` → `combat:attack:ack` via `/unity-ws`
 * (see ConcordClient.SendAttack). HTTP helpers below are the REST bind when WS
 * is down but kitchen HTTP is up — and for Web/test harnesses.
 *
 * Offline without gateway stays honest `{ ok:false, reason:'no_gateway' }`.
 */

export type CombatAuthorityProbe = {
  ok: true;
  authority: 'server';
  userId: string;
  presence: { cityId: string | null; x?: number; y?: number; z?: number } | null;
  gateways: {
    godotWs: string;
    unityWs: string;
    combatEvt: string;
    combatAck: string;
  };
  http: {
    hit: string;
    death: string;
    recent: string;
    worldsAttack: string;
    questsActive: string;
    questsInteract?: string;
  };
  note: string;
  ts: string;
};

export type CombatAuthorityProbeFail = {
  ok: false;
  error?: string;
  reason?: string;
  status?: number;
};

export type CombatHitResult = {
  ok: true;
  authority?: string;
  damage: number;
  hpBefore: number | null;
  hpAfter: number | null;
  targetHealth?: number | null;
  targetKilled?: boolean;
  refused?: boolean;
  reason?: string;
  weapon?: string;
  targetId?: string;
  worldId?: string;
};

export type CombatHitFail = {
  ok: false;
  error?: string;
  reason?: string;
  status?: number;
  refused?: boolean;
  damage?: number;
};

export type QuestInteractResult = {
  ok: true;
  authority: 'server';
  questId: string;
  title: string;
  text: string;
  options?: Array<{ id: string; trigger?: string | null; consequence?: string }>;
  optionId?: string;
  consequence?: string;
  source?: string;
};

export type QuestInteractFail = {
  ok: false;
  error?: string;
  reason?: string;
  status?: number;
};

function failFromResponse(
  res: Response,
  body: Record<string, unknown> | null,
  fallback: string,
): CombatAuthorityProbeFail {
  return {
    ok: false,
    status: res.status,
    error: (body && typeof body.error === 'string' && body.error) || res.statusText || fallback,
    reason: (body && typeof body.reason === 'string' && body.reason) || undefined,
  };
}

/**
 * GET /api/combat/probe with credentials (cookie or Bearer via api client).
 */
export async function probeCombatAuthority(
  fetchImpl: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<CombatAuthorityProbe | CombatAuthorityProbeFail> {
  try {
    const res = await fetchImpl('/api/combat/probe', {
      method: 'GET',
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });
    const body = (await res.json().catch(() => null)) as
      | CombatAuthorityProbe
      | CombatAuthorityProbeFail
      | null;
    if (!res.ok) {
      return failFromResponse(res, body as Record<string, unknown> | null, 'probe_failed');
    }
    if (body && body.ok === true && 'authority' in body) return body;
    return { ok: false, error: 'malformed_probe', status: res.status };
  } catch (e) {
    return {
      ok: false,
      error: 'no_gateway',
      reason: e instanceof Error ? e.message : 'fetch_failed',
    };
  }
}

/**
 * POST /api/combat/hit — server HP authority.
 * Returns authoritative { damage, hpBefore, hpAfter } when kitchen is up.
 */
export async function postCombatHit(
  input: {
    victimId: string;
    damage: number;
    weapon?: string;
    worldId?: string;
    isCrit?: boolean;
    targetId?: string;
  },
  fetchImpl: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<CombatHitResult | CombatHitFail> {
  try {
    const res = await fetchImpl('/api/combat/hit', {
      method: 'POST',
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      body: JSON.stringify({
        victimId: input.victimId,
        targetId: input.targetId || input.victimId,
        damage: input.damage,
        weapon: input.weapon || 'sword',
        worldId: input.worldId || 'concordia-hub',
        isCrit: !!input.isCrit,
      }),
    });
    // Parsed JSON is a loose bag of optional fields; the union members have a
    // conflicting `ok` literal so an intersection collapses to `never`.
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (body && body.error) || res.statusText || 'hit_failed',
        reason: body?.reason,
        refused: body?.refused,
        damage: body?.damage,
      };
    }
    if (body && body.ok === true) {
      return {
        ok: true,
        authority: body.authority,
        damage: Number(body.damage) || 0,
        hpBefore: body.hpBefore ?? null,
        hpAfter: body.hpAfter ?? body.targetHealth ?? null,
        targetHealth: body.targetHealth ?? body.hpAfter ?? null,
        targetKilled: body.targetKilled,
        refused: body.refused,
        reason: body.reason,
        weapon: body.weapon,
        targetId: body.targetId,
        worldId: body.worldId,
      };
    }
    return { ok: false, error: 'malformed_hit', status: res.status };
  } catch (e) {
    return {
      ok: false,
      error: 'no_gateway',
      reason: e instanceof Error ? e.message : 'fetch_failed',
    };
  }
}

/**
 * POST /api/quests/interact — authored branching text from server store.
 */
export async function postQuestInteract(
  input: {
    questId?: string;
    title?: string;
    targetId?: string;
    optionId?: string;
    worldId?: string;
  },
  fetchImpl: typeof fetch = fetch,
  init: RequestInit = {},
): Promise<QuestInteractResult | QuestInteractFail> {
  try {
    const res = await fetchImpl('/api/quests/interact', {
      method: 'POST',
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      body: JSON.stringify({
        questId: input.questId || input.targetId || input.title,
        title: input.title,
        targetId: input.targetId,
        optionId: input.optionId,
        worldId: input.worldId || 'concordia-hub',
      }),
    });
    const body = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (body && body.error) || res.statusText || 'quest_interact_failed',
        reason: body?.reason,
      };
    }
    if (body && body.ok === true && body.text) {
      return {
        ok: true,
        authority: 'server',
        questId: body.questId,
        title: body.title,
        text: body.text,
        options: body.options,
        optionId: body.optionId,
        consequence: body.consequence,
        source: body.source,
      };
    }
    return { ok: false, error: 'malformed_quest_interact', status: res.status };
  } catch (e) {
    return {
      ok: false,
      error: 'no_gateway',
      reason: e instanceof Error ? e.message : 'fetch_failed',
    };
  }
}
