using System;
using System.Collections.Generic;

namespace Concordia.GameplayCore.WorldFabric
{
    public enum WorldFabricObjectKind
    {
        Furniture,
        Container,
        Food,
        Tool,
        Book,
        Weapon,
        Decoration,
        Waste,
        Resource,
        Evidence,
        QuestObject
    }

    public enum WorldFabricInteractionKind
    {
        None,
        Take,
        Inspect,
        Consume,
        Use,
        Read,
        Open,
        Sit,
        Trade,
        Break,
        Repair
    }

    [Serializable]
    public sealed class WorldFabricProvenance
    {
        public string assetId;
        public string worldId;
        public string regionId;
        public string cultureId;
        public string factionId;
        public string buildingId;
        public string generationRule;
        public string generatorVersion = "world-fabric-v1";
        public List<string> loreSources = new List<string>();
        public List<string> gameplayBindings = new List<string>();
    }

    [Serializable]
    public sealed class WorldFabricObjectRecord
    {
        public string objectId;
        public WorldFabricObjectKind kind;
        public string semanticId;
        public string displayName;
        public string purpose;
        public string ownerId;
        public string containerId;
        public string material;
        public float condition = 1f;
        public float value;
        public int quantity = 1;
        public bool present = true;
        public bool movable;
        public bool destructible;
        public bool interactive;
        public string contentsCsv = "";
        public WorldFabricInteractionKind interaction;
        public WorldFabricProvenance provenance = new WorldFabricProvenance();
    }

    [Serializable]
    public sealed class WorldFabricRoomRecord
    {
        public string roomId;
        public string purpose;
        public string occupantId;
        public float capacity = 1f;
        public List<string> objectIds = new List<string>();
    }

    [Serializable]
    public sealed class WorldFabricBuildingRecord
    {
        public string buildingId;
        public string worldId;
        public string regionId;
        public string settlementId;
        public string buildingType;
        public string cultureId;
        public string factionId;
        public string ownerId;
        public string purpose;
        public bool operational = true;
        public float condition = 1f;
        public List<string> inhabitants = new List<string>();
        public List<WorldFabricRoomRecord> rooms = new List<WorldFabricRoomRecord>();
        public List<WorldFabricObjectRecord> objects = new List<WorldFabricObjectRecord>();
        public WorldFabricProvenance provenance = new WorldFabricProvenance();
    }

    [Serializable]
    public sealed class WorldFabricSettlementRecord
    {
        public string settlementId;
        public string worldId;
        public string regionId;
        public string name;
        public string cultureId;
        public string factionId;
        public string settlementType;
        public int population;
        public List<string> buildingIds = new List<string>();
        public List<string> culturalRules = new List<string>();
        public List<string> loreSources = new List<string>();
    }

    [Serializable]
    public sealed class WorldFabricConsequenceRecord
    {
        public string eventId;
        public string objectId;
        public string buildingId;
        public string actorId;
        public string kind;
        public string detail;
        public float value;
        public string worldId;
        public string occurredAt;
    }

    [Serializable]
    public sealed class WorldFabricState
    {
        public int schemaVersion = 1;
        public string generatorVersion = "world-fabric-v1";
        public List<WorldFabricSettlementRecord> settlements = new List<WorldFabricSettlementRecord>();
        public List<WorldFabricBuildingRecord> buildings = new List<WorldFabricBuildingRecord>();
        public List<WorldFabricConsequenceRecord> consequences = new List<WorldFabricConsequenceRecord>();
    }

    [Serializable]
    public sealed class WorldFabricValidationIssue
    {
        public string severity;
        public string code;
        public string objectId;
        public string buildingId;
        public string detail;

        public override string ToString()
        {
            return severity + " " + code + " object=" + objectId + " building=" + buildingId + " " + detail;
        }
    }
}
