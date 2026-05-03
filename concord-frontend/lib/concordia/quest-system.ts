// Quest system — quests generate from the live DTU substrate.
// QuestGenerator.scan() reads district state and produces QuestSeeds which
// are narrated by the subconscious brain. QuestTracker ticks objective
// conditions against game events.

import { api } from '@/lib/api/client';
import type { DomainType } from './district-domains';
import { domainConfig } from './district-domains';

// ── Objective types ───────────────────────────────────────────────────

export type ObjectiveKind =
  | 'kill'          // eliminate N hostiles of a type
  | 'deliver'       // bring an item to an NPC
  | 'talk'          // complete dialogue with an NPC
  | 'reach'         // arrive at a world position
  | 'build'         // place a DTU matching a spec
  | 'create_dtu'    // publish a DTU with given tags
  | 'protect'       // keep an NPC alive for duration (seconds)
  | 'collect'       // gather N resource items
  | 'repair';       // raise district health by N points

export interface QuestObjective {
  id: string;
  kind: ObjectiveKind;
  description: string;
  progress: number;
  target: number;
  /** Payload specific to each kind */
  meta: Record<string, unknown>;
}

// ── Reward ────────────────────────────────────────────────────────────

export interface QuestReward {
  cc: number;                    // ConcordCoin
  xp: number;
  karmaBonus: number;            // applied to global karma
  factionId?: string;
  factionRep?: number;
  perkPoint?: boolean;           // rare — grants one perk selection
  dtuUnlock?: string;            // id of a DTU that becomes available
}

// ── Quest ─────────────────────────────────────────────────────────────

export type QuestStatus = 'available' | 'active' | 'completed' | 'failed';

export interface Quest {
  id: string;
  title: string;
  description: string;
  domain: DomainType;
  giverId: string;       // NPC id or 'world' for ambient quests
  giverName: string;
  status: QuestStatus;
  objectives: QuestObjective[];
  reward: QuestReward;
  timeLimit?: number;    // seconds; undefined = no timer
  startedAt?: number;
  completedAt?: number;
}

// ── Seed (pre-narration) ──────────────────────────────────────────────

interface QuestSeed {
  kind: 'combat' | 'delivery' | 'conversation' | 'creation' | 'repair' | 'exploration';
  domain: DomainType;
  districtId: string;
  districtHealth: number;
  /** DTU content excerpts that inspired this seed */
  inspirationSnippets: string[];
  giverId: string;
  giverName: string;
  reward: QuestReward;
}

// ── Generator ────────────────────────────────────────────────────────

export class QuestGenerator {
  /**
   * Scan a district and produce narrated quests.
   * Reads live DTUs from the substrate, combines with district health and
   * faction state, generates seeds, then narrates each via the subconscious brain.
   */
  static async scan(
    districtId: string,
    districtHealth: number,
    domain: DomainType,
    activeFactionId: string | null,
    maxQuests = 3,
  ): Promise<Quest[]> {
    // Pull recent DTUs from this district for inspiration
    let snippets: string[] = [];
    try {
      const avatarId = typeof window !== 'undefined' ? window.localStorage.getItem('concordia:activeAvatarId') : null;
      const { data } = await api.get('/api/personal-locker/dtus', {
        params: { lens: districtId, limit: 10, ...(avatarId ? { avatarId } : {}) },
      });
      const dtus = Array.isArray(data) ? data : (data?.dtus ?? []);
      snippets = dtus
        .map((d: { content?: string; title?: string }) => d.content ?? d.title ?? '')
        .filter(Boolean)
        .slice(0, 5);
    } catch {
      // Substrate unavailable — generate from domain flavor alone
    }

    const seeds = QuestGenerator._makeSeeds(
      districtId, districtHealth, domain, activeFactionId, snippets, maxQuests,
    );

    const quests = await Promise.all(seeds.map(seed => QuestGenerator._narrate(seed)));
    return quests.filter((q): q is Quest => q !== null);
  }

  private static _makeSeeds(
    districtId: string,
    health: number,
    domain: DomainType,
    factionId: string | null,
    snippets: string[],
    max: number,
  ): QuestSeed[] {
    const seeds: QuestSeed[] = [];
    const cfg = domainConfig(domain);

    // Low health → combat / repair quests
    if (health < 50 && seeds.length < max) {
      seeds.push({
        kind: 'combat',
        domain,
        districtId,
        districtHealth: health,
        inspirationSnippets: snippets,
        giverId: factionId ?? 'militia-captain',
        giverName: `${cfg.hostileVocab.factionName} Warden`,
        reward: { cc: 80, xp: 120, karmaBonus: 15, factionId: factionId ?? undefined, factionRep: 20 },
      });
      seeds.push({
        kind: 'repair',
        domain,
        districtId,
        districtHealth: health,
        inspirationSnippets: snippets,
        giverId: 'district-council',
        giverName: 'District Council',
        reward: { cc: 60, xp: 80, karmaBonus: 10, perkPoint: health < 20 },
      });
    }

    // DTU snippets available → creation / delivery quest
    if (snippets.length > 0 && seeds.length < max) {
      seeds.push({
        kind: 'creation',
        domain,
        districtId,
        districtHealth: health,
        inspirationSnippets: snippets,
        giverId: 'master-artisan',
        giverName: 'Master Artisan',
        reward: { cc: 120, xp: 100, karmaBonus: 5, dtuUnlock: snippets[0]?.slice(0, 20) },
      });
    }

    // Always seed an exploration / conversation quest
    if (seeds.length < max) {
      seeds.push({
        kind: 'conversation',
        domain,
        districtId,
        districtHealth: health,
        inspirationSnippets: snippets,
        giverId: 'local-elder',
        giverName: 'Local Elder',
        reward: { cc: 40, xp: 60, karmaBonus: 8 },
      });
    }

    return seeds.slice(0, max);
  }

  private static async _narrate(seed: QuestSeed): Promise<Quest | null> {
    const cfg = domainConfig(seed.domain);
    const prompt = [
      `You are generating a quest for a ${seed.domain} district in Concordia.`,
      `District health: ${seed.districtHealth}/100. Atmosphere: ${cfg.atmosphereTags.join(', ')}.`,
      seed.inspirationSnippets.length > 0
        ? `Nearby player-created content: ${seed.inspirationSnippets.join(' | ')}`
        : '',
      `Quest kind: ${seed.kind}. Quest giver: ${seed.giverName}.`,
      `Respond ONLY with JSON matching this shape (no markdown fences):`,
      `{"title":"...","description":"...","objectiveDescription":"...","objectiveTarget":${seed.kind === 'combat' ? 5 : 1}}`,
    ].filter(Boolean).join('\n');

    try {
      const { data } = await api.post('/api/chat', {
        message: prompt,
        brainOverride: 'subconscious',
        lensContext: { type: 'quest_generation', domain: seed.domain },
      });

      const raw: string = data?.response ?? data?.message ?? '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]) as {
        title?: string;
        description?: string;
        objectiveDescription?: string;
        objectiveTarget?: number;
      };

      const objectiveKind = QuestGenerator._kindToObjective(seed.kind);
      return {
        id: `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: parsed.title ?? `${cfg.label} Quest`,
        description: parsed.description ?? 'A quest awaits.',
        domain: seed.domain,
        giverId: seed.giverId,
        giverName: seed.giverName,
        status: 'available',
        objectives: [{
          id: `obj-0`,
          kind: objectiveKind,
          description: parsed.objectiveDescription ?? 'Complete the objective.',
          progress: 0,
          target: parsed.objectiveTarget ?? 1,
          meta: { domain: seed.domain, factionId: seed.reward.factionId },
        }],
        reward: seed.reward,
      };
    } catch {
      return null;
    }
  }

  private static _kindToObjective(kind: QuestSeed['kind']): ObjectiveKind {
    const map: Record<QuestSeed['kind'], ObjectiveKind> = {
      combat: 'kill',
      delivery: 'deliver',
      conversation: 'talk',
      creation: 'create_dtu',
      repair: 'repair',
      exploration: 'reach',
    };
    return map[kind];
  }
}

// ── Tracker ───────────────────────────────────────────────────────────

export type QuestEvent =
  | { type: 'kill'; npcId: string; domain: DomainType }
  | { type: 'talk'; npcId: string }
  | { type: 'create_dtu'; tags: string[] }
  | { type: 'reach'; position: { x: number; z: number } }
  | { type: 'deliver'; itemId: string; toNpcId: string }
  | { type: 'collect'; resourceId: string }
  | { type: 'health_delta'; districtId: string; delta: number }
  | { type: 'tick'; seconds: number };

export class QuestTracker {
  private _quests: Quest[] = [];
  private _onChange?: (quests: Quest[]) => void;

  setQuests(quests: Quest[]): void {
    this._quests = quests;
    this._onChange?.(this._quests);
  }

  onQuestsChanged(cb: (quests: Quest[]) => void): void {
    this._onChange = cb;
  }

  accept(questId: string): void {
    this._mutate(questId, q => ({ ...q, status: 'active', startedAt: Date.now() }));
  }

  abandon(questId: string): void {
    this._mutate(questId, q => ({ ...q, status: 'available', startedAt: undefined }));
  }

  dispatch(event: QuestEvent): Quest[] {
    const completed: Quest[] = [];

    this._quests = this._quests.map(quest => {
      if (quest.status !== 'active') return quest;

      // Check time limit
      if (quest.timeLimit && quest.startedAt) {
        if (Date.now() - quest.startedAt > quest.timeLimit * 1000) {
          return { ...quest, status: 'failed' };
        }
      }

      const updatedObjs = quest.objectives.map(obj => {
        const prog = QuestTracker._applyEvent(obj, event);
        return prog !== obj.progress ? { ...obj, progress: prog } : obj;
      });

      const allDone = updatedObjs.every(o => o.progress >= o.target);
      if (allDone && quest.objectives.some((_, i) => updatedObjs[i].progress !== quest.objectives[i].progress || updatedObjs[i].progress >= updatedObjs[i].target)) {
        const done = { ...quest, objectives: updatedObjs, status: 'completed' as QuestStatus, completedAt: Date.now() };
        completed.push(done);
        return done;
      }

      return updatedObjs === quest.objectives ? quest : { ...quest, objectives: updatedObjs };
    });

    if (completed.length > 0) this._onChange?.(this._quests);
    return completed;
  }

  get active(): Quest[] {
    return this._quests.filter(q => q.status === 'active');
  }

  get available(): Quest[] {
    return this._quests.filter(q => q.status === 'available');
  }

  private _mutate(id: string, fn: (q: Quest) => Quest): void {
    this._quests = this._quests.map(q => q.id === id ? fn(q) : q);
    this._onChange?.(this._quests);
  }

  private static _applyEvent(obj: QuestObjective, event: QuestEvent): number {
    const p = obj.progress;
    switch (obj.kind) {
      case 'kill':
        return event.type === 'kill' ? p + 1 : p;
      case 'talk':
        return event.type === 'talk' && event.npcId === (obj.meta.npcId as string) ? p + 1 : p;
      case 'create_dtu':
        return event.type === 'create_dtu' ? p + 1 : p;
      case 'reach':
        if (event.type !== 'reach') return p;
        return p + 1;  // caller ensures position matches
      case 'deliver':
        return event.type === 'deliver' ? p + 1 : p;
      case 'collect':
        return event.type === 'collect' ? p + 1 : p;
      case 'repair':
        return event.type === 'health_delta' && event.delta > 0 ? p + event.delta : p;
      case 'protect':
        return event.type === 'tick' ? p + event.seconds : p;
      case 'build':
        return event.type === 'create_dtu' ? p + 1 : p;
    }
  }
}

export const questTracker = new QuestTracker();
