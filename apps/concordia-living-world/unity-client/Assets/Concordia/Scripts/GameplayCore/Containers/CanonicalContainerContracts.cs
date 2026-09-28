using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.Containers
{
    public enum ContainerKind
    {
        Drawer,
        Chest,
        Barrel,
        Backpack,
        Shelf,
        VehicleTrunk,
        Warehouse,
        Building
    }

    public enum ContainerInventoryAuthority
    {
        Canonical,
        WorldSystemsInventory,
        VehicleInventory,
        VehicleStorage
    }

    public enum ContainerAccessRule
    {
        Public,
        OwnerOnly,
        OwnerOrAllowed,
        Faction,
        Locked,
        Claimable
    }

    public enum ContainerOperationKind
    {
        Register,
        Move,
        Open,
        Take,
        Put,
        Steal,
        Trade,
        Claim
    }

    public enum ContainerRefusalReason
    {
        None,
        InvalidRequest,
        NotFound,
        AlreadyRegistered,
        NotPresent,
        Broken,
        AccessDenied,
        Locked,
        NotOwner,
        NotAllowed,
        FactionMismatch,
        NotClaimable,
        AlreadyOwned,
        ItemNotFound,
        InvalidQuantity,
        CapacityExceeded,
        StealingDisabled,
        CannotStealOwnContainer,
        TradingDisabled,
        DestinationNotFound,
        DestinationAccessDenied,
        AdapterUnavailable,
        AdapterRejected,
        MoveNotPermitted,
        PersistenceRejected
    }

    [Serializable]
    public sealed class ContainerPhysicalLocation
    {
        public string worldId = "Hub";
        public string sceneId = "";
        public string regionId = "";
        public string parentId = "";
        public string locationKind = "scene";
        public Vector3 position;
        public Quaternion rotation = Quaternion.identity;

        public ContainerPhysicalLocation Clone()
        {
            return new ContainerPhysicalLocation
            {
                worldId = worldId,
                sceneId = sceneId,
                regionId = regionId,
                parentId = parentId,
                locationKind = locationKind,
                position = position,
                rotation = rotation
            };
        }
    }

    [Serializable]
    public sealed class ContainerProvenance
    {
        public string sourceId = "";
        public string sourceKind = "";
        public string worldId = "Hub";
        public string regionId = "";
        public string buildingId = "";
        public string generationRule = "authored";
        public string generatorVersion = "canonical-containers-v1";
        public List<string> gameplayBindings = new List<string>();
        public List<string> loreSources = new List<string>();

        public ContainerProvenance Clone()
        {
            var copy = new ContainerProvenance
            {
                sourceId = sourceId,
                sourceKind = sourceKind,
                worldId = worldId,
                regionId = regionId,
                buildingId = buildingId,
                generationRule = generationRule,
                generatorVersion = generatorVersion
            };
            if (gameplayBindings != null) copy.gameplayBindings.AddRange(gameplayBindings);
            if (loreSources != null) copy.loreSources.AddRange(loreSources);
            return copy;
        }
    }

    [Serializable]
    public sealed class ContainerItemStack
    {
        public string itemId;
        public float quantity = 1f;
        public float unitWeight = 1f;
        public string provenanceId = "";

        public ContainerItemStack() { }

        public ContainerItemStack(string itemId, float quantity, float unitWeight = 1f, string provenanceId = "")
        {
            this.itemId = itemId;
            this.quantity = quantity;
            this.unitWeight = unitWeight;
            this.provenanceId = provenanceId ?? "";
        }

        public float Weight => Mathf.Max(0f, quantity) * Mathf.Max(0f, unitWeight);

        public ContainerItemStack Clone()
        {
            return new ContainerItemStack(itemId, quantity, unitWeight, provenanceId);
        }
    }

    [Serializable]
    public sealed class CanonicalContainerRecord
    {
        public string containerId;
        public ContainerKind kind;
        public string displayName;
        public string ownerId = "";
        public string factionId = "";
        public ContainerAccessRule accessRule = ContainerAccessRule.OwnerOnly;
        public List<string> allowedActorIds = new List<string>();
        public List<string> allowedFactionIds = new List<string>();
        public float capacity = 1f;
        public float condition = 1f;
        public bool isPresent = true;
        public bool isSealed;
        public bool isPersistent = true;
        public bool claimable;
        public bool stealable = true;
        public bool tradeable;
        public ContainerInventoryAuthority inventoryAuthority = ContainerInventoryAuthority.Canonical;
        public string authorityId = "";
        public ContainerPhysicalLocation physicalLocation = new ContainerPhysicalLocation();
        public ContainerProvenance provenance = new ContainerProvenance();
        public List<ContainerItemStack> contents = new List<ContainerItemStack>();

        public float UsedCapacity
        {
            get
            {
                if (contents == null) return 0f;
                var total = 0f;
                for (var i = 0; i < contents.Count; i++)
                    if (contents[i] != null) total += contents[i].Weight;
                return total;
            }
        }

        public CanonicalContainerRecord CloneSnapshot()
        {
            var copy = new CanonicalContainerRecord
            {
                containerId = containerId,
                kind = kind,
                displayName = displayName,
                ownerId = ownerId,
                factionId = factionId,
                accessRule = accessRule,
                capacity = capacity,
                condition = condition,
                isPresent = isPresent,
                isSealed = isSealed,
                isPersistent = isPersistent,
                claimable = claimable,
                stealable = stealable,
                tradeable = tradeable,
                inventoryAuthority = inventoryAuthority,
                authorityId = authorityId,
                physicalLocation = physicalLocation == null ? new ContainerPhysicalLocation() : physicalLocation.Clone(),
                provenance = provenance == null ? new ContainerProvenance() : provenance.Clone()
            };
            if (allowedActorIds != null) copy.allowedActorIds.AddRange(allowedActorIds);
            if (allowedFactionIds != null) copy.allowedFactionIds.AddRange(allowedFactionIds);
            if (contents != null)
                for (var i = 0; i < contents.Count; i++)
                    if (contents[i] != null) copy.contents.Add(contents[i].Clone());
            return copy;
        }
    }

    [Serializable]
    public sealed class ContainerConsequenceEvent
    {
        public string eventId;
        public ContainerOperationKind operation;
        public string containerId;
        public string sourceContainerId;
        public string destinationContainerId;
        public string actorId;
        public string counterpartyId;
        public string itemId;
        public float quantity;
        public float value;
        public string refusalReason = "";
        public string detail = "";
        public string worldId = "Hub";
        public string occurredAtUtc;
    }

    [Serializable]
    public sealed class ContainerOperationResult
    {
        public bool success;
        public ContainerOperationKind operation;
        public ContainerRefusalReason refusalReason;
        public string message;
        public string containerId;
        public string sourceContainerId;
        public string destinationContainerId;
        public string itemId;
        public float quantity;
        public ContainerConsequenceEvent consequence;

        public static ContainerOperationResult Succeed(ContainerOperationKind operation, string message)
        {
            return new ContainerOperationResult { success = true, operation = operation, refusalReason = ContainerRefusalReason.None, message = message ?? "Operation completed." };
        }

        public static ContainerOperationResult Refuse(ContainerOperationKind operation, ContainerRefusalReason reason, string message)
        {
            return new ContainerOperationResult { success = false, operation = operation, refusalReason = reason, message = message ?? reason.ToString() };
        }
    }

    public interface ICanonicalContainerContentsAdapter
    {
        string AuthorityId { get; }
        float Capacity { get; }
        float UsedCapacity { get; }
        bool TryGetSnapshot(List<ContainerItemStack> destination);
        bool TryPut(ContainerItemStack item);
        bool TryTake(string itemId, float quantity);
    }
}
