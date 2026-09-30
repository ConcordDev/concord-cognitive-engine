using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.WorldSimulation
{
    public enum WorldSimulationJob { None, Farmer, Merchant, Guard, Artisan, Scholar, Hunter, Healer, Courier, Leader, Student, Unemployed }
    public enum RelationshipKind { Family, Friendship, Romance, Rivalry, Mentorship, Debt, Employment, Alliance }
    public enum ReputationDisposition { Trusted, Neutral, Watched, Hated, Honored }
    public enum CrimeKind { Theft, Assault, Trespass, Fraud, Smuggling, Sabotage, Poaching, Murder }
    public enum WitnessConfidence { Rumor, Suspected, Plausible, Confirmed }
    public enum ConsequenceKind { Reputation, FactionStanding, CrimeHeat, ScheduleChange, Economic, Social, Ecological, QuestUnlock, QuestBlock }
    public enum QuestOpportunityKind { Errand, Escort, Hunt, Rescue, Delivery, Investigation, Diplomacy, Defense, Discovery, Trade }
    public enum QuestSource { Authored, Procedural, Consequence, Rumor, Faction }
    public enum QuestStatus { Offered, Accepted, Active, Failed, Completed, Abandoned, Expired }
    public enum InvestigationStatus { Open, Pursuing, Solved, Cold, Dismissed }
    public enum WorldEventKind { Festival, Shortage, Storm, FactionConflict, Migration, Outbreak, Discovery, CrimeWave, Treaty, Disaster }
    public enum SpeciesDiet { Herbivore, Carnivore, Omnivore, Scavenger, Insectivore }
    public enum HabitatKind { Settlement, Forest, Wetland, Grassland, Desert, Mountain, Coast, Ruins, Urban, Unknown }
    public enum MigrationStatus { Planned, Traveling, Arrived, Disrupted, Complete }
    public enum CreatureDisposition { Calm, Territorial, Herding, Predatory, Fleeing, Tame }
    public enum TamingStatus { Wild, Bonding, Tamed, Broken, Released }
    public enum MountStatus { None, Offered, Mounted, Injured, Retired }
    public enum CreatureCombatStatus { Healthy, Wounded, Recovering, Dead }

    public static class StableWorldId
    {
        public static string Normalize(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return string.Empty;
            var value = raw.Trim().ToLowerInvariant();
            var chars = value.ToCharArray();
            for (var i = 0; i < chars.Length; i++)
                if (char.IsWhiteSpace(chars[i])) chars[i] = '-';
            return new string(chars);
        }

        public static string Combine(params string[] parts)
        {
            var result = string.Empty;
            if (parts == null) return result;
            for (var i = 0; i < parts.Length; i++)
            {
                var part = Normalize(parts[i]);
                if (part.Length == 0) continue;
                if (result.Length > 0) result += ":";
                result += part;
            }
            return result;
        }

        public static int Hash(string value)
        {
            unchecked
            {
                var hash = 23;
                var text = value ?? string.Empty;
                for (var i = 0; i < text.Length; i++) hash = hash * 31 + text[i];
                return hash;
            }
        }

        public static string Generated(string prefix, params string[] parts)
        {
            var key = Combine(parts);
            return Normalize(prefix) + "-" + Math.Abs(Hash(key)).ToString("x8");
        }
    }

    [Serializable]
    public sealed class WorldSimulationClock
    {
        public long tick;
        public int day;
        public float hour;
        public float elapsedSeconds;

        public void Advance(float seconds)
        {
            seconds = Mathf.Max(0f, seconds);
            elapsedSeconds += seconds;
            hour += seconds / 60f;
            while (hour >= 24f) { hour -= 24f; day++; }
            tick++;
        }

        public int MinuteOfDay => Mathf.Clamp(Mathf.FloorToInt(hour * 60f), 0, 1439);
    }

    [Serializable]
    public sealed class HomeState
    {
        public string homeId;
        public string settlementId;
        public string placeId;
        public string ownerNpcId;
        public string[] residentNpcIds = Array.Empty<string>();
        public int capacity = 4;
        public float condition = 1f;
        public bool occupied = true;
    }

    [Serializable]
    public sealed class JobState
    {
        public string jobId;
        public string workplaceId;
        public string employerId;
        public string factionId;
        public WorldSimulationJob job;
        public float productivity = 1f;
        public bool active = true;
    }

    [Serializable]
    public sealed class FamilyState
    {
        public string familyId;
        public string surname;
        public string homeId;
        public string[] memberNpcIds = Array.Empty<string>();
        public string[] legacyIds = Array.Empty<string>();
    }

    [Serializable]
    public sealed class RelationshipState
    {
        public string relationshipId;
        public string subjectNpcId;
        public string targetNpcId;
        public RelationshipKind kind;
        public float strength;
        public float trust;
        public long lastInteractionTick;
        public bool active = true;
    }

    [Serializable]
    public sealed class FactionState
    {
        public string factionId;
        public string displayName;
        public string leaderNpcId;
        public string settlementId;
        public string[] memberNpcIds = Array.Empty<string>();
        public string[] rivalFactionIds = Array.Empty<string>();
        public float cohesion = 1f;
        public float influence = 0.5f;
    }

    [Serializable]
    public sealed class NpcSocialState
    {
        public string npcId;
        public string displayName;
        public string settlementId;
        public string homeId;
        public string jobId;
        public string familyId;
        public string factionId;
        public string scheduleId;
        public bool alive = true;
        public bool available = true;
        public string currentActivity = "idle";
        public int stress;
    }

    [Serializable]
    public sealed class ReputationState
    {
        public string subjectId;
        public string observerId;
        public string factionId;
        public float value;
        public ReputationDisposition disposition;
        public long updatedTick;
    }

    [Serializable]
    public sealed class CrimeRecord
    {
        public string crimeId;
        public CrimeKind kind;
        public string perpetratorId;
        public string victimId;
        public string factionId;
        public string locationId;
        public string[] witnessIds = Array.Empty<string>();
        public float severity = 0.25f;
        public float heat;
        public bool resolved;
        public long tick;
    }

    [Serializable]
    public sealed class WitnessRecord
    {
        public string witnessId;
        public string crimeId;
        public string observerNpcId;
        public WitnessConfidence confidence;
        public float reliability = 0.5f;
        public bool reported;
        public string[] memoryTags = Array.Empty<string>();
    }

    [Serializable]
    public sealed class ScheduleEntry
    {
        public string entryId;
        public int startMinute;
        public int endMinute;
        public string locationId;
        public string activity = "idle";
        public bool interruptible = true;
    }

    [Serializable]
    public sealed class NpcSchedule
    {
        public string scheduleId;
        public string npcId;
        public ScheduleEntry[] entries = Array.Empty<ScheduleEntry>();
    }

    [Serializable]
    public sealed class MemoryRecord
    {
        public string memoryId;
        public string ownerNpcId;
        public string subjectId;
        public string eventId;
        public string summary;
        public float importance = 0.5f;
        public float confidence = 1f;
        public long createdTick;
        public long lastRecalledTick;
        public bool active = true;
    }

    [Serializable]
    public sealed class ConsequenceRecord
    {
        public string consequenceId;
        public ConsequenceKind kind;
        public string sourceId;
        public string subjectId;
        public string factionId;
        public float magnitude;
        public string description;
        public long applyAtTick;
        public bool applied;
    }

    [Serializable]
    public sealed class QuestRequirement
    {
        public string requirementId;
        public string type;
        public string targetId;
        public int requiredCount = 1;
        public bool optional;
    }

    [Serializable]
    public sealed class QuestOpportunity
    {
        public string opportunityId;
        public string sourceId;
        public QuestSource source;
        public QuestOpportunityKind kind;
        public string title;
        public string description;
        public string giverNpcId;
        public string factionId;
        public string locationId;
        public string[] tags = Array.Empty<string>();
        public QuestRequirement[] requirements = Array.Empty<QuestRequirement>();
        public int difficulty = 1;
        public float rewardValue;
        public long expiresAtTick;
        public QuestStatus status = QuestStatus.Offered;
    }

    [Serializable]
    public sealed class QuestContract
    {
        public string contractId;
        public string opportunityId;
        public string actorId;
        public QuestStatus status = QuestStatus.Accepted;
        public float progress;
        public int completedRequirements;
        public long acceptedAtTick;
        public long resolvedAtTick;
        public string[] evidenceIds = Array.Empty<string>();
        public string[] consequenceIds = Array.Empty<string>();
    }

    [Serializable]
    public sealed class InvestigationCase
    {
        public string investigationId;
        public string subjectId;
        public string investigatorId;
        public string crimeId;
        public string locationId;
        public string[] leadIds = Array.Empty<string>();
        public InvestigationStatus status = InvestigationStatus.Open;
        public float certainty;
        public long openedAtTick;
    }

    [Serializable]
    public sealed class WorldEventState
    {
        public string eventId;
        public WorldEventKind kind;
        public string regionId;
        public string factionId;
        public string title;
        public string description;
        public float intensity;
        public long startTick;
        public long endTick;
        public bool active = true;
        public string[] affectedIds = Array.Empty<string>();
    }

    [Serializable]
    public sealed class SpeciesState
    {
        public string speciesId;
        public string displayName;
        public SpeciesDiet diet;
        public float adultMassKg;
        public float gestationDays = 30f;
        public int maturityDays = 10;
        public int carryingCapacity = 100;
        public string[] habitatTags = Array.Empty<string>();
        public string[] predatorSpeciesIds = Array.Empty<string>();
        public string[] preySpeciesIds = Array.Empty<string>();
    }

    [Serializable]
    public sealed class HabitatState
    {
        public string habitatId;
        public HabitatKind kind;
        public string regionId;
        public string settlementId;
        public string[] tags = Array.Empty<string>();
        public float quality = 1f;
        public int carryingCapacity = 100;
        public int population;
        public bool protectedArea;
    }

    [Serializable]
    public sealed class CreatureState
    {
        public string creatureId;
        public string speciesId;
        public string habitatId;
        public string parentAId;
        public string parentBId;
        public int generation;
        public CreatureDisposition disposition;
        public TamingStatus taming;
        public MountStatus mount;
        public CreatureCombatStatus combat;
        public float health = 1f;
        public float tamingProgress;
        public string ownerId;
        public long lastMigrationTick;
        public bool alive = true;
    }

    [Serializable]
    public sealed class PredatorPreyLink
    {
        public string linkId;
        public string predatorSpeciesId;
        public string preySpeciesId;
        public float pressure = 0.1f;
        public bool active = true;
    }

    [Serializable]
    public sealed class MigrationState
    {
        public string migrationId;
        public string speciesId;
        public string fromHabitatId;
        public string toHabitatId;
        public int population;
        public float progress;
        public MigrationStatus status = MigrationStatus.Planned;
        public long startTick;
    }

    [Serializable]
    public sealed class BreedingRecord
    {
        public string breedingId;
        public string parentAId;
        public string parentBId;
        public string offspringId;
        public string speciesId;
        public int generation;
        public long tick;
        public bool successful;
    }

    [Serializable]
    public sealed class TamingRecord
    {
        public string tamingId;
        public string creatureId;
        public string handlerId;
        public TamingStatus status;
        public float progress;
        public long updatedTick;
    }

    [Serializable]
    public sealed class MountRecord
    {
        public string mountId;
        public string creatureId;
        public string riderId;
        public MountStatus status;
        public float bond;
        public long updatedTick;
    }

    [Serializable]
    public sealed class CreatureCombatRecord
    {
        public string combatId;
        public string creatureId;
        public string opponentId;
        public float damage;
        public string cause;
        public CreatureCombatStatus result;
        public long tick;
    }

    [Serializable]
    public sealed class EcologicalConsequence
    {
        public string consequenceId;
        public string habitatId;
        public string speciesId;
        public string sourceId;
        public float populationDelta;
        public float habitatQualityDelta;
        public string description;
        public long tick;
    }

    [Serializable]
    public sealed class WorldSimulationState
    {
        public int schemaVersion = 1;
        public int worldSeed;
        public WorldSimulationClock clock = new WorldSimulationClock();
        public List<HomeState> homes = new List<HomeState>();
        public List<JobState> jobs = new List<JobState>();
        public List<FamilyState> families = new List<FamilyState>();
        public List<RelationshipState> relationships = new List<RelationshipState>();
        public List<FactionState> factions = new List<FactionState>();
        public List<NpcSocialState> npcs = new List<NpcSocialState>();
        public List<ReputationState> reputations = new List<ReputationState>();
        public List<CrimeRecord> crimes = new List<CrimeRecord>();
        public List<WitnessRecord> witnesses = new List<WitnessRecord>();
        public List<NpcSchedule> schedules = new List<NpcSchedule>();
        public List<MemoryRecord> memories = new List<MemoryRecord>();
        public List<ConsequenceRecord> consequences = new List<ConsequenceRecord>();
        public List<QuestOpportunity> opportunities = new List<QuestOpportunity>();
        public List<QuestContract> contracts = new List<QuestContract>();
        public List<InvestigationCase> investigations = new List<InvestigationCase>();
        public List<WorldEventState> worldEvents = new List<WorldEventState>();
        public List<SpeciesState> species = new List<SpeciesState>();
        public List<HabitatState> habitats = new List<HabitatState>();
        public List<CreatureState> creatures = new List<CreatureState>();
        public List<PredatorPreyLink> predatorPrey = new List<PredatorPreyLink>();
        public List<MigrationState> migrations = new List<MigrationState>();
        public List<BreedingRecord> breeding = new List<BreedingRecord>();
        public List<TamingRecord> taming = new List<TamingRecord>();
        public List<MountRecord> mounts = new List<MountRecord>();
        public List<CreatureCombatRecord> creatureCombat = new List<CreatureCombatRecord>();
        public List<EcologicalConsequence> ecologicalConsequences = new List<EcologicalConsequence>();
    }

    [Serializable]
    public sealed class WorldSimulationEvent
    {
        public string eventId;
        public string type;
        public string subjectId;
        public string relatedId;
        public float magnitude;
        public long tick;
        public string message;
    }
}
