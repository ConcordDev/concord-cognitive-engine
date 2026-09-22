using System;
using System.Collections.Generic;

namespace Concordia.WorldSystems
{
    public enum WorldSystemsInfrastructureEffectKind
    {
        GatheringMultiplier,
        ProductionMultiplier,
        ConstructionSpeed,
        ShopSupply,
        JobCapacity,
        UpkeepReduction
    }

    [Serializable]
    public sealed class WorldSystemsResourceStack
    {
        public string resourceId;
        public float quantity;

        public WorldSystemsResourceStack() { }

        public WorldSystemsResourceStack(string resourceId, float quantity)
        {
            this.resourceId = resourceId;
            this.quantity = quantity;
        }
    }

    [Serializable]
    public sealed class WorldSystemsInventoryContract
    {
        public string inventoryId;
        public string ownerId;
        public string settlementId;
        public float capacity;
        public readonly List<WorldSystemsResourceStack> resources = new List<WorldSystemsResourceStack>();
    }

    [Serializable]
    public sealed class WorldSystemsGatheringSourceContract
    {
        public string sourceId;
        public string settlementId;
        public string resourceId;
        public float yieldPerAction = 1f;
        public float available = 1f;
        public float maximumAvailable = 1f;
        public float respawnSeconds = 30f;
        public float respawnAt;
        public bool requiresOperationalBuilding;
        public string requiredBuildingId;
        public BuildingKind requiredBuildingKind = BuildingKind.Workplace;
    }

    [Serializable]
    public sealed class WorldSystemsRecipeContract
    {
        public string recipeId;
        public string displayName;
        public float durationSeconds = 1f;
        public bool requiresBuilding;
        public string requiredBuildingId;
        public BuildingKind requiredBuildingKind = BuildingKind.Workshop;
        public readonly List<WorldSystemsResourceStack> inputs = new List<WorldSystemsResourceStack>();
        public readonly List<WorldSystemsResourceStack> outputs = new List<WorldSystemsResourceStack>();
    }

    [Serializable]
    public sealed class WorldSystemsMarketContract
    {
        public string storefrontId;
        public string resourceId;
        public float basePrice = 1f;
        public float targetStock = 10f;
        public float priceElasticity = 0.25f;
        public float minimumPrice = 0.01f;
        public float maximumPrice = 999999f;
        public float desiredSupplyPerTick;
        public float desiredDemandPerTick;
        public float recentSupply;
        public float recentDemand;
        public float lastPrice = 1f;
    }

    [Serializable]
    public sealed class WorldSystemsJobContract
    {
        public string jobId;
        public string settlementId;
        public string buildingId;
        public string role;
        public float wagePerSecond;
        public int maximumWorkers = 1;
        public bool requiresOperationalBuilding = true;
        public readonly List<string> workerIds = new List<string>();
    }

    [Serializable]
    public sealed class WorldSystemsOwnershipContract
    {
        public string assetId;
        public string ownerId;
        public string factionId;
        public string settlementId;
        public bool transferable = true;
    }

    [Serializable]
    public sealed class WorldSystemsConstructionContract
    {
        public string projectId;
        public string buildingId;
        public string settlementId;
        public string ownerId;
        public string factionId;
        public BuildingKind kind = BuildingKind.Workplace;
        public string plan;
        public float requiredWork = 100f;
        public float workDone;
        public bool materialsConsumed;
        public ConstructionStatus status = ConstructionStatus.Planned;
        public readonly List<WorldSystemsResourceStack> requiredMaterials = new List<WorldSystemsResourceStack>();
    }

    [Serializable]
    public sealed class WorldSystemsInfrastructureEffectContract
    {
        public string effectId;
        public string infrastructureBuildingId;
        public string settlementId;
        public string resourceId;
        public string targetBuildingId;
        public WorldSystemsInfrastructureEffectKind kind;
        public float magnitude;
        public bool enabled = true;
    }

    [Serializable]
    public sealed class WorldSystemsEconomicConsequenceRecord
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
    public sealed class WorldSystemsEconomyState
    {
        public float simulationTime;
        public readonly List<WorldSystemsInventoryContract> inventories = new List<WorldSystemsInventoryContract>();
        public readonly List<WorldSystemsGatheringSourceContract> gatheringSources = new List<WorldSystemsGatheringSourceContract>();
        public readonly List<WorldSystemsRecipeContract> recipes = new List<WorldSystemsRecipeContract>();
        public readonly List<WorldSystemsMarketContract> markets = new List<WorldSystemsMarketContract>();
        public readonly List<WorldSystemsJobContract> jobs = new List<WorldSystemsJobContract>();
        public readonly List<WorldSystemsOwnershipContract> ownership = new List<WorldSystemsOwnershipContract>();
        public readonly List<WorldSystemsConstructionContract> construction = new List<WorldSystemsConstructionContract>();
        public readonly List<WorldSystemsInfrastructureEffectContract> infrastructure = new List<WorldSystemsInfrastructureEffectContract>();
        public readonly List<WorldSystemsEconomicConsequenceRecord> consequences = new List<WorldSystemsEconomicConsequenceRecord>();
    }

    [Serializable]
    public sealed class WorldSystemsEconomyOperationResult
    {
        public bool success;
        public string message;
        public string resourceId;
        public float quantity;
        public float unitPrice;
        public float totalValue;

        public static WorldSystemsEconomyOperationResult Fail(string message)
        {
            return new WorldSystemsEconomyOperationResult { success = false, message = message ?? "Operation failed." };
        }

        public static WorldSystemsEconomyOperationResult Succeed(string message)
        {
            return new WorldSystemsEconomyOperationResult { success = true, message = message ?? "Operation completed." };
        }
    }

    [Serializable]
    public sealed class WorldSystemsShopQuote
    {
        public bool available;
        public string storefrontId;
        public string itemId;
        public string resourceId;
        public float availableQuantity;
        public float requestedQuantity;
        public float unitPrice;
        public float totalPrice;
    }
}
