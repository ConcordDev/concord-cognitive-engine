using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.WorldSimulation
{
    /// <summary>
    /// Additive, ID-only simulation service. It records durable facts and emits
    /// integration events; it does not spawn, move, or own existing NPCs/quests.
    /// </summary>
    public sealed class WorldSimulationService
    {
        public WorldSimulationState State { get; private set; }
        public event Action<WorldSimulationEvent> EventRaised;

        readonly Dictionary<string, NpcSocialState> _npcs = new Dictionary<string, NpcSocialState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, HomeState> _homes = new Dictionary<string, HomeState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, JobState> _jobs = new Dictionary<string, JobState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, FactionState> _factions = new Dictionary<string, FactionState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, CreatureState> _creatures = new Dictionary<string, CreatureState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, SpeciesState> _species = new Dictionary<string, SpeciesState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, HabitatState> _habitats = new Dictionary<string, HabitatState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, QuestOpportunity> _opportunities = new Dictionary<string, QuestOpportunity>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, QuestContract> _contracts = new Dictionary<string, QuestContract>(StringComparer.OrdinalIgnoreCase);
        float _maintenance;

        public WorldSimulationService(int worldSeed = 0)
        {
            State = new WorldSimulationState { worldSeed = worldSeed };
            Reindex();
        }

public void LoadJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return;
            var loaded = JsonUtility.FromJson<WorldSimulationState>(json);
            if (loaded == null) return;
            State = loaded;
            EnsureCollections();
            Reindex();
        }

        public string ToJson() => JsonUtility.ToJson(State, true);

void EnsureCollections()
        {
            if (State.clock == null) State.clock = new WorldSimulationClock();
            if (State.homes == null) State.homes = new List<HomeState>();
            if (State.jobs == null) State.jobs = new List<JobState>();
            if (State.families == null) State.families = new List<FamilyState>();
            if (State.relationships == null) State.relationships = new List<RelationshipState>();
            if (State.factions == null) State.factions = new List<FactionState>();
            if (State.npcs == null) State.npcs = new List<NpcSocialState>();
            if (State.reputations == null) State.reputations = new List<ReputationState>();
            if (State.crimes == null) State.crimes = new List<CrimeRecord>();
            if (State.witnesses == null) State.witnesses = new List<WitnessRecord>();
            if (State.schedules == null) State.schedules = new List<NpcSchedule>();
            if (State.memories == null) State.memories = new List<MemoryRecord>();
            if (State.consequences == null) State.consequences = new List<ConsequenceRecord>();
            if (State.opportunities == null) State.opportunities = new List<QuestOpportunity>();
            if (State.contracts == null) State.contracts = new List<QuestContract>();
            if (State.investigations == null) State.investigations = new List<InvestigationCase>();
            if (State.worldEvents == null) State.worldEvents = new List<WorldEventState>();
            if (State.species == null) State.species = new List<SpeciesState>();
            if (State.habitats == null) State.habitats = new List<HabitatState>();
            if (State.creatures == null) State.creatures = new List<CreatureState>();
            if (State.predatorPrey == null) State.predatorPrey = new List<PredatorPreyLink>();
            if (State.migrations == null) State.migrations = new List<MigrationState>();
            if (State.breeding == null) State.breeding = new List<BreedingRecord>();
            if (State.taming == null) State.taming = new List<TamingRecord>();
            if (State.mounts == null) State.mounts = new List<MountRecord>();
            if (State.creatureCombat == null) State.creatureCombat = new List<CreatureCombatRecord>();
            if (State.ecologicalConsequences == null) State.ecologicalConsequences = new List<EcologicalConsequence>();
        }


public void Reindex()
        {
            EnsureCollections();
            _npcs.Clear(); _homes.Clear(); _jobs.Clear(); _factions.Clear();
            _creatures.Clear(); _species.Clear(); _habitats.Clear(); _opportunities.Clear(); _contracts.Clear();
            Index(State.npcs, _npcs, x => x.npcId);
            Index(State.homes, _homes, x => x.homeId);
            Index(State.jobs, _jobs, x => x.jobId);
            Index(State.factions, _factions, x => x.factionId);
            Index(State.creatures, _creatures, x => x.creatureId);
            Index(State.species, _species, x => x.speciesId);
            Index(State.habitats, _habitats, x => x.habitatId);
            Index(State.opportunities, _opportunities, x => x.opportunityId);
            Index(State.contracts, _contracts, x => x.contractId);
        }

        static void Index<T>(List<T> items, Dictionary<string, T> index, Func<T, string> key)
        {
            if (items == null) return;
            for (var i = 0; i < items.Count; i++)
            {
                var item = items[i];
                var id = item == null ? string.Empty : StableWorldId.Normalize(key(item));
                if (id.Length > 0) index[id] = item;
            }
        }

        public void Tick(float deltaSeconds)
        {
            if (State == null) return;
            State.clock.Advance(deltaSeconds);
            _maintenance += Mathf.Max(0f, deltaSeconds);
            if (_maintenance < 1f) return;
            _maintenance = 0f;
            UpdateSchedules();
            ExpireOpportunities();
            AdvanceMigrations();
            ApplyPendingConsequences();
        }

        void UpdateSchedules()
        {
            var minute = State.clock.MinuteOfDay;
            for (var i = 0; i < State.npcs.Count; i++)
            {
                var npc = State.npcs[i];
                if (npc == null || string.IsNullOrEmpty(npc.scheduleId)) continue;
                var schedule = FindSchedule(npc.scheduleId);
                if (schedule == null || schedule.entries == null) continue;
                ScheduleEntry active = null;
                for (var e = 0; e < schedule.entries.Length; e++)
                {
                    var entry = schedule.entries[e];
                    if (entry != null && InWindow(minute, entry.startMinute, entry.endMinute)) { active = entry; break; }
                }
                if (active != null && npc.currentActivity != active.activity)
                {
                    npc.currentActivity = active.activity;
                    Emit("schedule.changed", npc.npcId, active.locationId, 0f, active.activity);
                }
            }
        }

        static bool InWindow(int minute, int start, int end)
        {
            start = Mathf.Clamp(start, 0, 1439); end = Mathf.Clamp(end, 0, 1439);
            return start <= end ? minute >= start && minute <= end : minute >= start || minute <= end;
        }

        void ExpireOpportunities()
        {
            for (var i = 0; i < State.opportunities.Count; i++)
            {
                var opportunity = State.opportunities[i];
                if (opportunity == null || opportunity.status != QuestStatus.Offered || opportunity.expiresAtTick <= 0) continue;
                if (State.clock.tick >= opportunity.expiresAtTick)
                {
                    opportunity.status = QuestStatus.Expired;
                    Emit("quest.expired", opportunity.opportunityId, opportunity.locationId, 0f, opportunity.title);
                }
            }
        }

        void AdvanceMigrations()
        {
            for (var i = 0; i < State.migrations.Count; i++)
            {
                var migration = State.migrations[i];
                if (migration == null || migration.status == MigrationStatus.Complete || migration.status == MigrationStatus.Disrupted) continue;
                migration.status = MigrationStatus.Traveling;
                migration.progress = Mathf.Clamp01(migration.progress + 0.01f);
                if (migration.progress >= 1f)
                {
                    migration.status = MigrationStatus.Arrived;
                    Emit("ecology.migration.arrived", migration.speciesId, migration.toHabitatId, migration.population, "migration arrived");
                }
            }
        }

        void ApplyPendingConsequences()
        {
            for (var i = 0; i < State.consequences.Count; i++)
            {
                var consequence = State.consequences[i];
                if (consequence == null || consequence.applied || consequence.applyAtTick > State.clock.tick) continue;
                consequence.applied = true;
                Emit("consequence.applied", consequence.subjectId, consequence.sourceId, consequence.magnitude, consequence.description);
            }
        }

        public NpcSocialState UpsertNpc(NpcSocialState value)
        {
            if (value == null || string.IsNullOrEmpty(value.npcId)) return null;
            value.npcId = StableWorldId.Normalize(value.npcId);
            var existing = FindNpc(value.npcId);
            if (existing == null) { State.npcs.Add(value); _npcs[value.npcId] = value; return value; }
            CopyNpc(value, existing); return existing;
        }

        static void CopyNpc(NpcSocialState from, NpcSocialState to)
        {
            to.displayName = from.displayName; to.settlementId = from.settlementId; to.homeId = from.homeId;
            to.jobId = from.jobId; to.familyId = from.familyId; to.factionId = from.factionId; to.scheduleId = from.scheduleId;
            to.alive = from.alive; to.available = from.available; to.currentActivity = from.currentActivity; to.stress = from.stress;
        }

        public HomeState UpsertHome(HomeState value) => Upsert(value, State.homes, _homes, x => x.homeId);
        public JobState UpsertJob(JobState value) => Upsert(value, State.jobs, _jobs, x => x.jobId);
        public FamilyState UpsertFamily(FamilyState value) => Upsert(value, State.families, null, x => x.familyId);
        public FactionState UpsertFaction(FactionState value) => Upsert(value, State.factions, _factions, x => x.factionId);
        public SpeciesState UpsertSpecies(SpeciesState value) => Upsert(value, State.species, _species, x => x.speciesId);
        public HabitatState UpsertHabitat(HabitatState value) => Upsert(value, State.habitats, _habitats, x => x.habitatId);
        public CreatureState UpsertCreature(CreatureState value) => Upsert(value, State.creatures, _creatures, x => x.creatureId);

public NpcSchedule UpsertSchedule(NpcSchedule value) => Upsert(value, State.schedules, null, x => x.scheduleId);


        T Upsert<T>(T value, List<T> list, Dictionary<string, T> index, Func<T, string> key) where T : class
        {
            if (value == null) return null;
            var id = StableWorldId.Normalize(key(value));
            if (id.Length == 0) return value;
            var existing = index == null ? FindIn(list, id, key) : (index.TryGetValue(id, out var hit) ? hit : null);
            if (existing == null) { list.Add(value); if (index != null) index[id] = value; return value; }
            var at = list.IndexOf(existing); list[at] = value; if (index != null) index[id] = value; return value;
        }

        static T FindIn<T>(List<T> list, string id, Func<T, string> key) where T : class
        {
            for (var i = 0; i < list.Count; i++) if (list[i] != null && string.Equals(StableWorldId.Normalize(key(list[i])), id, StringComparison.OrdinalIgnoreCase)) return list[i];
            return null;
        }

        public NpcSocialState FindNpc(string id) { _npcs.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public HomeState FindHome(string id) { _homes.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public JobState FindJob(string id) { _jobs.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public FactionState FindFaction(string id) { _factions.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public CreatureState FindCreature(string id) { _creatures.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public SpeciesState FindSpecies(string id) { _species.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public HabitatState FindHabitat(string id) { _habitats.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public NpcSchedule FindSchedule(string id) => FindById(State.schedules, id, x => x.scheduleId);
        public QuestOpportunity FindOpportunity(string id) { _opportunities.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }
        public QuestContract FindContract(string id) { _contracts.TryGetValue(StableWorldId.Normalize(id), out var value); return value; }

        static T FindById<T>(List<T> list, string id, Func<T, string> key) where T : class
        {
            var wanted = StableWorldId.Normalize(id);
            for (var i = 0; i < list.Count; i++) if (list[i] != null && StableWorldId.Normalize(key(list[i])) == wanted) return list[i];
            return null;
        }

        public bool AddRelationship(RelationshipState relationship)
        {
            if (relationship == null || string.IsNullOrEmpty(relationship.subjectNpcId) || string.IsNullOrEmpty(relationship.targetNpcId)) return false;
            if (string.IsNullOrEmpty(relationship.relationshipId)) relationship.relationshipId = StableWorldId.Generated("relationship", relationship.subjectNpcId, relationship.targetNpcId, relationship.kind.ToString());
            relationship.relationshipId = StableWorldId.Normalize(relationship.relationshipId);
            var existing = FindById(State.relationships, relationship.relationshipId, x => x.relationshipId);
            if (existing == null) State.relationships.Add(relationship); else State.relationships[State.relationships.IndexOf(existing)] = relationship;
            Emit("social.relationship.updated", relationship.subjectNpcId, relationship.targetNpcId, relationship.strength, relationship.kind.ToString());
            return true;
        }

        public void SetReputation(string subjectId, string observerId, string factionId, float value)
        {
            var found = FindReputation(subjectId, observerId, factionId);
            if (found == null)
            {
                found = new ReputationState { subjectId = StableWorldId.Normalize(subjectId), observerId = StableWorldId.Normalize(observerId), factionId = StableWorldId.Normalize(factionId) };
                State.reputations.Add(found);
            }
            found.value = Mathf.Clamp(value, -1f, 1f); found.disposition = DispositionFor(found.value); found.updatedTick = State.clock.tick;
            Emit("social.reputation.changed", subjectId, factionId, found.value, found.disposition.ToString());
        }

        ReputationState FindReputation(string subjectId, string observerId, string factionId)
        {
            for (var i = 0; i < State.reputations.Count; i++)
            {
                var item = State.reputations[i]; if (item == null) continue;
                if (Same(item.subjectId, subjectId) && Same(item.observerId, observerId) && Same(item.factionId, factionId)) return item;
            }
            return null;
        }

        static ReputationDisposition DispositionFor(float value)
        {
            if (value >= 0.65f) return ReputationDisposition.Honored;
            if (value >= 0.2f) return ReputationDisposition.Trusted;
            if (value <= -0.65f) return ReputationDisposition.Hated;
            if (value <= -0.2f) return ReputationDisposition.Watched;
            return ReputationDisposition.Neutral;
        }

        public string RecordCrime(CrimeRecord crime)
        {
            if (crime == null) return string.Empty;
            if (string.IsNullOrEmpty(crime.crimeId)) crime.crimeId = StableWorldId.Generated("crime", crime.perpetratorId, crime.victimId, State.clock.tick.ToString());
            crime.crimeId = StableWorldId.Normalize(crime.crimeId); crime.tick = State.clock.tick; crime.heat = Mathf.Clamp01(crime.severity);
            State.crimes.Add(crime);
            Emit("crime.recorded", crime.perpetratorId, crime.crimeId, crime.severity, crime.kind.ToString());
            return crime.crimeId;
        }

        public string AddWitness(WitnessRecord witness)
        {
            if (witness == null) return string.Empty;
            if (string.IsNullOrEmpty(witness.witnessId)) witness.witnessId = StableWorldId.Generated("witness", witness.observerNpcId, witness.crimeId);
            witness.witnessId = StableWorldId.Normalize(witness.witnessId); State.witnesses.Add(witness);
            Emit("crime.witnessed", witness.observerNpcId, witness.crimeId, (float)witness.confidence, witness.reported ? "reported" : "unreported");
            return witness.witnessId;
        }

        public string AddMemory(MemoryRecord memory)
        {
            if (memory == null) return string.Empty;
            if (string.IsNullOrEmpty(memory.memoryId)) memory.memoryId = StableWorldId.Generated("memory", memory.ownerNpcId, memory.eventId, memory.subjectId);
            memory.memoryId = StableWorldId.Normalize(memory.memoryId); memory.createdTick = State.clock.tick; memory.lastRecalledTick = State.clock.tick; State.memories.Add(memory);
            return memory.memoryId;
        }

        public string AddConsequence(ConsequenceRecord consequence)
        {
            if (consequence == null) return string.Empty;
            if (string.IsNullOrEmpty(consequence.consequenceId)) consequence.consequenceId = StableWorldId.Generated("consequence", consequence.sourceId, consequence.subjectId, State.clock.tick.ToString());
            consequence.consequenceId = StableWorldId.Normalize(consequence.consequenceId); consequence.applyAtTick = Math.Max(State.clock.tick, consequence.applyAtTick); State.consequences.Add(consequence);
            return consequence.consequenceId;
        }

        public string CreateOpportunity(QuestOpportunity opportunity)
        {
            if (opportunity == null) return string.Empty;
            if (string.IsNullOrEmpty(opportunity.opportunityId)) opportunity.opportunityId = StableWorldId.Generated("opportunity", opportunity.sourceId, opportunity.locationId, opportunity.title);
            opportunity.opportunityId = StableWorldId.Normalize(opportunity.opportunityId); State.opportunities.Add(opportunity); _opportunities[opportunity.opportunityId] = opportunity;
            Emit("quest.opportunity.created", opportunity.opportunityId, opportunity.locationId, opportunity.rewardValue, opportunity.source.ToString());
            return opportunity.opportunityId;
        }

        public string GenerateProceduralOpportunity(string seed, QuestOpportunityKind kind, string locationId, string factionId)
        {
            var id = StableWorldId.Generated("procedural-quest", State.worldSeed.ToString(), seed, State.clock.day.ToString(), kind.ToString());
            return CreateOpportunity(new QuestOpportunity { opportunityId = id, sourceId = seed, source = QuestSource.Procedural, kind = kind, title = kind + " opportunity", description = "A simulation-generated opportunity awaiting authored presentation.", locationId = locationId, factionId = factionId, difficulty = 1 + Mathf.Abs(StableWorldId.Hash(seed)) % 5, rewardValue = 10f, expiresAtTick = State.clock.tick + 3600 });
        }

        public bool AcceptOpportunity(string opportunityId, string actorId, out QuestContract contract)
        {
            contract = null; var opportunity = FindOpportunity(opportunityId);
            if (opportunity == null || opportunity.status != QuestStatus.Offered) return false;
            opportunity.status = QuestStatus.Accepted;
            contract = new QuestContract { contractId = StableWorldId.Generated("contract", opportunity.opportunityId, actorId), opportunityId = opportunity.opportunityId, actorId = StableWorldId.Normalize(actorId), acceptedAtTick = State.clock.tick };
            State.contracts.Add(contract); _contracts[contract.contractId] = contract;
            Emit("quest.accepted", contract.actorId, contract.contractId, 0f, opportunity.title); return true;
        }

        public bool AdvanceContract(string contractId, float progress, string evidenceId = null)
        {
            var contract = FindContract(contractId); if (contract == null || contract.status == QuestStatus.Completed || contract.status == QuestStatus.Failed) return false;
            contract.status = QuestStatus.Active; contract.progress = Mathf.Clamp01(contract.progress + Mathf.Max(0f, progress));
            if (!string.IsNullOrEmpty(evidenceId)) AddUnique(ref contract.evidenceIds, evidenceId);
            Emit("quest.progress", contract.actorId, contract.contractId, contract.progress, "contract advanced"); return true;
        }

        public bool ResolveContract(string contractId, bool success, string consequenceId = null)
        {
            var contract = FindContract(contractId); if (contract == null) return false;
            contract.status = success ? QuestStatus.Completed : QuestStatus.Failed; contract.resolvedAtTick = State.clock.tick;
            if (!string.IsNullOrEmpty(consequenceId)) AddUnique(ref contract.consequenceIds, consequenceId);
            Emit(success ? "quest.completed" : "quest.failed", contract.actorId, contract.contractId, success ? 1f : 0f, "contract resolved"); return true;
        }

        public string OpenInvestigation(InvestigationCase investigation)
        {
            if (investigation == null) return string.Empty;
            if (string.IsNullOrEmpty(investigation.investigationId)) investigation.investigationId = StableWorldId.Generated("investigation", investigation.crimeId, investigation.investigatorId);
            investigation.investigationId = StableWorldId.Normalize(investigation.investigationId); investigation.openedAtTick = State.clock.tick; State.investigations.Add(investigation);
            Emit("investigation.opened", investigation.investigatorId, investigation.crimeId, investigation.certainty, investigation.locationId); return investigation.investigationId;
        }

        public string RaiseWorldEvent(WorldEventState worldEvent)
        {
            if (worldEvent == null) return string.Empty;
            if (string.IsNullOrEmpty(worldEvent.eventId)) worldEvent.eventId = StableWorldId.Generated("world-event", worldEvent.kind.ToString(), worldEvent.regionId, State.clock.tick.ToString());
            worldEvent.eventId = StableWorldId.Normalize(worldEvent.eventId); worldEvent.startTick = State.clock.tick; State.worldEvents.Add(worldEvent);
            Emit("world.event.raised", worldEvent.regionId, worldEvent.factionId, worldEvent.intensity, worldEvent.kind.ToString()); return worldEvent.eventId;
        }

        public string RecordMigration(MigrationState migration)
        {
            if (migration == null) return string.Empty;
            if (string.IsNullOrEmpty(migration.migrationId)) migration.migrationId = StableWorldId.Generated("migration", migration.speciesId, migration.fromHabitatId, migration.toHabitatId);
            migration.migrationId = StableWorldId.Normalize(migration.migrationId); migration.startTick = State.clock.tick; State.migrations.Add(migration); return migration.migrationId;
        }

public string AddPredatorPreyLink(PredatorPreyLink link)
        {
            if (link == null || string.IsNullOrEmpty(link.predatorSpeciesId) || string.IsNullOrEmpty(link.preySpeciesId)) return string.Empty;
            if (string.IsNullOrEmpty(link.linkId)) link.linkId = StableWorldId.Generated("predator-prey", link.predatorSpeciesId, link.preySpeciesId);
            link.linkId = StableWorldId.Normalize(link.linkId);
            var existing = FindById(State.predatorPrey, link.linkId, x => x.linkId);
            if (existing == null) State.predatorPrey.Add(link); else State.predatorPrey[State.predatorPrey.IndexOf(existing)] = link;
            Emit("ecology.predator-prey.linked", link.predatorSpeciesId, link.preySpeciesId, link.pressure, "predator-prey relationship");
            return link.linkId;
        }


        public bool TryBreed(string parentAId, string parentBId, out CreatureState offspring)
        {
            offspring = null; var a = FindCreature(parentAId); var b = FindCreature(parentBId);
            if (a == null || b == null || !a.alive || !b.alive || !Same(a.speciesId, b.speciesId)) return false;
            var species = FindSpecies(a.speciesId); if (species == null) return false;
            var generation = Mathf.Max(a.generation, b.generation) + 1;
            offspring = new CreatureState { creatureId = StableWorldId.Generated("creature", a.creatureId, b.creatureId, State.clock.tick.ToString()), speciesId = a.speciesId, habitatId = a.habitatId, parentAId = a.creatureId, parentBId = b.creatureId, generation = generation, disposition = CreatureDisposition.Calm };
            UpsertCreature(offspring); State.breeding.Add(new BreedingRecord { breedingId = StableWorldId.Generated("breeding", a.creatureId, b.creatureId), parentAId = a.creatureId, parentBId = b.creatureId, offspringId = offspring.creatureId, speciesId = offspring.speciesId, generation = generation, tick = State.clock.tick, successful = true });
            Emit("ecology.breeding", offspring.creatureId, offspring.habitatId, generation, species.displayName); return true;
        }

        public bool SetTaming(string creatureId, string handlerId, float progress, TamingStatus status)
        {
            var creature = FindCreature(creatureId); if (creature == null) return false;
            creature.taming = status; creature.tamingProgress = Mathf.Clamp01(progress); creature.ownerId = status == TamingStatus.Tamed ? StableWorldId.Normalize(handlerId) : creature.ownerId;
            State.taming.Add(new TamingRecord { tamingId = StableWorldId.Generated("taming", creatureId, handlerId, State.clock.tick.ToString()), creatureId = creatureId, handlerId = handlerId, progress = creature.tamingProgress, status = status, updatedTick = State.clock.tick });
            Emit("ecology.taming", creatureId, handlerId, creature.tamingProgress, status.ToString()); return true;
        }

        public bool SetMount(string creatureId, string riderId, MountStatus status, float bond)
        {
            var creature = FindCreature(creatureId); if (creature == null || (status == MountStatus.Mounted && creature.taming != TamingStatus.Tamed)) return false;
            creature.mount = status; State.mounts.Add(new MountRecord { mountId = StableWorldId.Generated("mount", creatureId, riderId), creatureId = creatureId, riderId = riderId, status = status, bond = Mathf.Clamp01(bond), updatedTick = State.clock.tick });
            Emit("ecology.mount", creatureId, riderId, bond, status.ToString()); return true;
        }

        public bool RecordCreatureCombat(CreatureCombatRecord combat)
        {
            if (combat == null) return false; var creature = FindCreature(combat.creatureId); if (creature == null) return false;
            combat.combatId = string.IsNullOrEmpty(combat.combatId) ? StableWorldId.Generated("creature-combat", combat.creatureId, combat.opponentId, State.clock.tick.ToString()) : combat.combatId;
            combat.tick = State.clock.tick; creature.health = Mathf.Clamp01(creature.health - Mathf.Max(0f, combat.damage)); creature.combat = creature.health <= 0f ? CreatureCombatStatus.Dead : CreatureCombatStatus.Wounded; creature.alive = creature.health > 0f; State.creatureCombat.Add(combat);
            Emit("ecology.combat", combat.creatureId, combat.opponentId, combat.damage, combat.cause); return true;
        }

        public string ApplyEcologicalConsequence(EcologicalConsequence consequence)
        {
            if (consequence == null) return string.Empty;
            var habitat = FindHabitat(consequence.habitatId); if (habitat != null) { habitat.population = Mathf.Max(0, habitat.population + Mathf.RoundToInt(consequence.populationDelta)); habitat.quality = Mathf.Clamp01(habitat.quality + consequence.habitatQualityDelta); }
            consequence.consequenceId = string.IsNullOrEmpty(consequence.consequenceId) ? StableWorldId.Generated("eco-consequence", consequence.sourceId, consequence.habitatId, State.clock.tick.ToString()) : consequence.consequenceId; consequence.tick = State.clock.tick; State.ecologicalConsequences.Add(consequence);
            Emit("ecology.consequence", consequence.habitatId, consequence.speciesId, consequence.populationDelta, consequence.description); return consequence.consequenceId;
        }

        static void AddUnique(ref string[] values, string value)
        {
            value = StableWorldId.Normalize(value); if (string.IsNullOrEmpty(value)) return;
            var current = values ?? Array.Empty<string>(); for (var i = 0; i < current.Length; i++) if (current[i] == value) return;
            var next = new string[current.Length + 1]; Array.Copy(current, next, current.Length); next[next.Length - 1] = value; values = next;
        }

        static bool Same(string a, string b) => string.Equals(StableWorldId.Normalize(a), StableWorldId.Normalize(b), StringComparison.OrdinalIgnoreCase);

        void Emit(string type, string subjectId, string relatedId, float magnitude, string message)
        {
            var record = new WorldSimulationEvent { eventId = StableWorldId.Generated("event", type, subjectId, relatedId, State.clock.tick.ToString()), type = type, subjectId = StableWorldId.Normalize(subjectId), relatedId = StableWorldId.Normalize(relatedId), magnitude = magnitude, tick = State.clock.tick, message = message };
            EventRaised?.Invoke(record);
        }
    }
}
