using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.GameplayCore.Containers;
using Concordia.GameplayCore.Fabrication;
using Concordia.GameplayCore.Gunsmithing;
using Concordia.GameplayCore.Spellcrafting;
using Concordia.GameplayCore.WorldFabric;
using Concordia.WorldSimulation;

namespace Concordia.GameplayCore.Persistence
{
    /// <summary>
    /// Stable scalar representation used by the persistence boundary. Unity object
    /// references, enums, dictionaries and runtime-only components never cross it.
    /// </summary>
    [Serializable]
    public sealed class Vector3Record
    {
        public float x;
        public float y;
        public float z;

        public Vector3Record() { }
        public Vector3Record(Vector3 value) { x = value.x; y = value.y; z = value.z; }
        public Vector3 ToVector3() => new Vector3(x, y, z);
    }

    [Serializable]
    public sealed class QuaternionRecord
    {
        public float x;
        public float y;
        public float z;
        public float w = 1f;

        public QuaternionRecord() { }
        public QuaternionRecord(Quaternion value) { x = value.x; y = value.y; z = value.z; w = value.w; }
        public Quaternion ToQuaternion() => new Quaternion(x, y, z, w);
    }

    [Serializable]
    public sealed class PersistenceEnvelope
    {
        public int schemaVersion = 1;
        public string saveId;
        public string savedAtUtc;
        public PersistencePayload payload = new PersistencePayload();
    }

    [Serializable]
    public sealed class PersistencePayload
    {
        public PlayerPersistenceRecord player = new PlayerPersistenceRecord();
        public List<NpcPersistenceRecord> npcs = new List<NpcPersistenceRecord>();
        public WorldPersistenceRecord world = new WorldPersistenceRecord();
        public List<VehiclePersistenceRecord> vehicles = new List<VehiclePersistenceRecord>();
        public WorldSystemsPersistenceRecord worldSystems = new WorldSystemsPersistenceRecord();
        public WorldSystemsEconomyPersistenceRecord economy = new WorldSystemsEconomyPersistenceRecord();
        public WorldSimulationPersistenceRecord worldSimulation = new WorldSimulationPersistenceRecord();
        public WorldFabricState worldFabric = new WorldFabricState();
        public FabricationPersistenceEnvelopeDto fabrication = new FabricationPersistenceEnvelopeDto();
        public GunsmithingPersistenceEnvelopeDto gunsmithing = new GunsmithingPersistenceEnvelopeDto();
        public SpellcraftingPersistenceEnvelopeDto spellcrafting = new SpellcraftingPersistenceEnvelopeDto();
        public CanonicalContainerPersistenceEnvelopeDto containers = new CanonicalContainerPersistenceEnvelopeDto();
        public List<ConsequenceEventRecord> consequences = new List<ConsequenceEventRecord>();
        public QuestPersistenceRecord quests = new QuestPersistenceRecord();
        public SkillPersistenceRecord skills = new SkillPersistenceRecord();
        public PlotPersistenceRecord plot;
    }

    [Serializable]
    public sealed class PlayerPersistenceRecord
    {
        public string actorId;
        public Vector3Record position = new Vector3Record();
        public QuaternionRecord rotation = new QuaternionRecord();
        public string world = "Hub";
        public float hp = 100f;
        public float stamina = 100f;
        public float poise = 12f;
        public float hostility;
        public float hunger;
        public float fatigue;
        public string heldEquipmentId;
        public string equippedItemId;
        public int combatArt;
        public List<ItemIdentifierRecord> inventory = new List<ItemIdentifierRecord>();
        public List<string> talkLog = new List<string>();
    }

    [Serializable]
    public sealed class ItemIdentifierRecord
    {
        public string id;
        public string displayName;
        public string kind;
        public string stem;
        public string affix;
        public int quantity = 1;
    }

    [Serializable]
    public sealed class NpcPersistenceRecord
    {
        public string actorId;
        public string objectName;
        public string personId;
        public List<string> socialIds = new List<string>();
        public float bondAffinity;
        public Vector3Record position = new Vector3Record();
        public QuaternionRecord rotation = new QuaternionRecord();
        public Vector3Record home = new Vector3Record();
        public Vector3Record workplace = new Vector3Record();
        public Vector3Record post = new Vector3Record();
        public string job;
        public string activity;
        public bool pinned;
        public bool hailed;
    }

    [Serializable]
    public sealed class VehiclePersistenceRecord
    {
        public string entityId;
        public string objectName;
        public string kind;
        public string authority;
        public Vector3Record position = new Vector3Record();
        public QuaternionRecord rotation = new QuaternionRecord();
        public Vector3Record velocity = new Vector3Record();
        public Vector3Record angularVelocity = new Vector3Record();
        public float health;
        public string ownerId;
        public bool autopilot;
        public Vector3Record autopilotDestination = new Vector3Record();
        public List<ItemIdentifierRecord> inventory = new List<ItemIdentifierRecord>();
        public List<ItemIdentifierRecord> storedItems = new List<ItemIdentifierRecord>();
        public List<VehicleEquipmentPersistenceRecord> equipment = new List<VehicleEquipmentPersistenceRecord>();
        public List<VehicleSeatPersistenceRecord> seats = new List<VehicleSeatPersistenceRecord>();
        public List<VehicleRelationshipPersistenceRecord> relationships = new List<VehicleRelationshipPersistenceRecord>();
    }

    [Serializable]
    public sealed class VehicleEquipmentPersistenceRecord
    {
        public string slotId;
        public string itemId;
    }

    [Serializable]
    public sealed class VehicleSeatPersistenceRecord
    {
        public string seatId;
        public string role;
        public string occupantId;
        public string occupantObjectName;
    }

    [Serializable]
    public sealed class VehicleRelationshipPersistenceRecord
    {
        public string actorId;
        public string relationship;
    }

    [Serializable]
    public sealed class WorldPersistenceRecord
    {
        public string activeWorld = "Hub";
        public float hour = 7.2f;
        public int day = 1;
        public string weather = "clear";
        public float ecology = 0.7f;
        public float prices = 1f;
        public float factionHeat = 0.2f;
        public string lastEvent = "";
        public string nearbyActivity = "";
        public List<WorldSlicePersistenceRecord> slices = new List<WorldSlicePersistenceRecord>();
        public string plotsCsv = "";
        public string travelersCsv = "";
        public string crossCsv = "";
        public string caravansCsv = "";
        public string tariffsCsv = "";
        public string borderCrossingsCsv = "";
        public List<WorldEventPersistenceRecord> eventLog = new List<WorldEventPersistenceRecord>();
        public List<FactionStandingPersistenceRecord> factionStandings = new List<FactionStandingPersistenceRecord>();
    }

    [Serializable]
    public sealed class FactionStandingPersistenceRecord
    {
        public string world;
        public string factionId;
        public float standing;
        public float witnessHeat;
        public int updatedDay;
    }

    [Serializable]
    public sealed class WorldEventPersistenceRecord
    {
        public string eventId;
        public string type;
        public string world;
        public string actorId;
        public string targetId;
        public string text;
        public float occurredAt;
        public int day;
    }

    [Serializable]
    public sealed class WorldSlicePersistenceRecord
    {
        public string world;
        public float ecology = 0.7f;
        public float prices = 1f;
        public float factionHeat = 0.2f;
        public float hour = 7.2f;
        public int day = 1;
        public int births;
        public string lastEvent = "";
        public float savedAt;
        public string deadCsv = "";
        public float stock = 1f;
        public float need = 0.4f;
        public string staple = "";
        public string imports = "";
        public int population;
        public List<RegionPersistenceRecord> regions = new List<RegionPersistenceRecord>();
        public List<SettlementPersistenceRecord> settlements = new List<SettlementPersistenceRecord>();
    }

    [Serializable]
    public sealed class RegionPersistenceRecord
    {
        public string regionId;
        public bool discovered;
        public float ecology = 0.7f;
        public float activity = 0.5f;
        public string controlFactionId = "";
    }

    [Serializable]
    public sealed class SettlementPersistenceRecord
    {
        public string settlementId;
        public int population;
        public float prices = 1f;
        public string controlFactionId = "";
        public string incidentsCsv = "";
        public string constructionCsv = "";
        public string activitiesCsv = "";
    }

    [Serializable]
    public sealed class WorldSystemsPersistenceRecord
    {
        public List<BuildingPersistenceRecord> buildings = new List<BuildingPersistenceRecord>();
        public List<StorefrontPersistenceRecord> storefront = new List<StorefrontPersistenceRecord>();
    }

    /// <summary>
    /// Versioned adapter for the additive WorldSimulationHost state. The legacy
    /// simulation file is a raw WorldSimulationState; the unified boundary wraps
    /// it so future migrations can be explicit and section-local.
    /// </summary>
    [Serializable]
    public sealed class WorldSimulationPersistenceRecord
    {
        public int schemaVersion;
        public WorldSimulationState state;
    }

    [Serializable]
    public sealed class WorldSystemsEconomyPersistenceRecord
    {
        public float simulationTime;
        public List<EconomyInventoryPersistenceRecord> inventories = new List<EconomyInventoryPersistenceRecord>();
        public List<EconomyGatheringSourcePersistenceRecord> gatheringSources = new List<EconomyGatheringSourcePersistenceRecord>();
        public List<EconomyRecipePersistenceRecord> recipes = new List<EconomyRecipePersistenceRecord>();
        public List<EconomyConsequencePersistenceRecord> consequences = new List<EconomyConsequencePersistenceRecord>();
    }

    [Serializable]
    public sealed class EconomyResourcePersistenceRecord
    {
        public string resourceId;
        public float quantity;
    }

    [Serializable]
    public sealed class EconomyInventoryPersistenceRecord
    {
        public string inventoryId;
        public string ownerId;
        public string settlementId;
        public float capacity;
        public List<EconomyResourcePersistenceRecord> resources = new List<EconomyResourcePersistenceRecord>();
    }

    [Serializable]
    public sealed class EconomyGatheringSourcePersistenceRecord
    {
        public string sourceId;
        public string settlementId;
        public string resourceId;
        public float yieldPerAction;
        public float available;
        public float maximumAvailable;
        public float respawnSeconds;
        public float respawnAt;
        public bool requiresOperationalBuilding;
        public string requiredBuildingId;
        public string requiredBuildingKind;
    }

    [Serializable]
    public sealed class EconomyRecipePersistenceRecord
    {
        public string recipeId;
        public string displayName;
        public float durationSeconds;
        public bool requiresBuilding;
        public string requiredBuildingId;
        public string requiredBuildingKind;
        public List<EconomyResourcePersistenceRecord> inputs = new List<EconomyResourcePersistenceRecord>();
        public List<EconomyResourcePersistenceRecord> outputs = new List<EconomyResourcePersistenceRecord>();
    }

    [Serializable]
    public sealed class EconomyConsequencePersistenceRecord
    {
        public string recordId;
        public float simulationTime;
        public string category;
        public string actorId;
        public string settlementId;
        public string resourceId;
        public float quantity;
        public float value;
        public bool positive;
        public string description;
    }

    [Serializable]
    public sealed class BuildingPersistenceRecord
    {
        public string buildingId;
        public string settlementId;
        public string ownerId;
        public string factionId;
        public string kind;
        public string construction;
        public bool operational;
        public float condition = 1f;
        public string plan;
    }

    [Serializable]
    public sealed class StorefrontPersistenceRecord
    {
        public string itemId;
        public string storefrontId;
        public string resource;
        public float quantity;
        public float targetStock;
        public float unitPrice;
    }

    [Serializable]
    public sealed class ConsequenceEventRecord
    {
        public string eventId;
        public string channel;
        public string kind;
        public string title;
        public string sourceId;
        public string targetId;
        public string actionId;
        public string detail;
        public string world;
        public float occurredAt;
        public float value;
    }

    [Serializable]
    public sealed class QuestPersistenceRecord
    {
        public List<ActiveQuestPersistenceRecord> active = new List<ActiveQuestPersistenceRecord>();
        public List<string> completedIds = new List<string>();
    }

    [Serializable]
    public sealed class ActiveQuestPersistenceRecord
    {
        public string questId;
        public string world;
        public List<bool> objectiveDone = new List<bool>();
    }

    [Serializable]
    public sealed class SkillPersistenceRecord
    {
        public string group;
        public string activeSkill;
        public string lastArt;
        public int catalogCount;
        public int trainedCount;
    }

    [Serializable]
    public sealed class PlotPersistenceRecord
    {
        public string id;
        public string text;
        public string phase;
        public bool kernel;
    }
}
