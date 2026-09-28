using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.WorldFabric
{
    [DisallowMultipleComponent]
    public sealed class WorldFabricIdentity : MonoBehaviour
    {
        public string objectId;
        public string buildingId;
        public string semanticId;
        public string ownerId;
        public string purpose;
        public WorldFabricInteractionKind interaction;
        public bool persistent = true;

        public void Bind(WorldFabricObjectRecord record)
        {
            if (record == null) return;
            objectId = record.objectId;
            buildingId = record.provenance != null ? record.provenance.buildingId : record.containerId;
            semanticId = record.semanticId;
            ownerId = record.ownerId;
            purpose = record.purpose;
            interaction = record.interaction;
        }
    }

    [DisallowMultipleComponent]
    public sealed class WorldFabricContainer : MonoBehaviour
    {
        public string containerId;
        public string ownerId;
        public float capacity = 10f;
        public List<string> itemIds = new List<string>();

        public bool Contains(string itemId)
        {
            return !string.IsNullOrEmpty(itemId) && itemIds.Contains(itemId);
        }

        public bool TryAdd(string itemId)
        {
            if (string.IsNullOrEmpty(itemId) || Contains(itemId) || itemIds.Count >= Mathf.RoundToInt(capacity)) return false;
            itemIds.Add(itemId);
            return true;
        }

        public bool TryRemove(string itemId)
        {
            return !string.IsNullOrEmpty(itemId) && itemIds.Remove(itemId);
        }
    }

    [DisallowMultipleComponent]
    public sealed class WorldFabricRuntime : MonoBehaviour
    {
        public static WorldFabricRuntime Active { get; private set; }
        public WorldFabricService Service { get; private set; }
        public string activeActorId = "player";
        public event Action<WorldFabricConsequenceRecord> ConsequenceRaised;

        void Awake()
        {
            if (Active != null && Active != this)
            {
                Destroy(this);
                return;
            }
            Active = this;
            Service = new WorldFabricService();
        }

        void OnDestroy()
        {
            if (Active == this) Active = null;
        }

        public void Bind(WorldFabricService service)
        {
            if (service != null) Service = service;
        }

        public bool TryInteract(WorldFabricIdentity identity, string actorId, out string message)
        {
            message = null;
            if (!identity || Service == null || string.IsNullOrEmpty(identity.objectId)) return false;
            var record = Service.TryGetObject(identity.objectId);
            if (record == null || !record.present) return false;

            actorId = string.IsNullOrEmpty(actorId) ? activeActorId : actorId;
            if (record.interaction != WorldFabricInteractionKind.Inspect
                && record.interaction != WorldFabricInteractionKind.Read
                && !CanAccess(record, actorId))
            {
                message = "You do not have access to " + record.displayName + ".";
                return true;
            }
            switch (record.interaction)
            {
                case WorldFabricInteractionKind.Take:
                    if (!Service.TryRemoveObject(record.objectId, actorId, "taken", out var taken)) return false;
                    ConsequenceRaised?.Invoke(taken);
                    message = "Took " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Consume:
                    if (!Service.TryRemoveObject(record.objectId, actorId, "consumed", out var consumed)) return false;
                    ConsequenceRaised?.Invoke(consumed);
                    message = "Consumed " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Read:
                    message = "Read " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Open:
                    message = "Opened " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Use:
                    message = "Used " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Sit:
                    message = "You sit at " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Trade:
                    message = "Trade is available at " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Inspect:
                    message = record.displayName + " — " + record.purpose + " — condition " + Mathf.RoundToInt(record.condition * 100f) + "%.";
                    return true;
                case WorldFabricInteractionKind.Break:
                    if (!Service.TryChangeObjectCondition(record.objectId, -0.35f, actorId, "broken", out var broken)) return false;
                    ConsequenceRaised?.Invoke(broken);
                    message = "Damaged " + record.displayName + ".";
                    return true;
                case WorldFabricInteractionKind.Repair:
                    if (!Service.TryChangeObjectCondition(record.objectId, 0.35f, actorId, "repaired", out var repaired)) return false;
                    ConsequenceRaised?.Invoke(repaired);
                    message = "Repaired " + record.displayName + ".";
                    return true;
                default:
                    message = record.displayName + " is part of " + record.purpose + ".";
                    return true;
            }
        }

        static bool CanAccess(WorldFabricObjectRecord record, string actorId)
        {
            if (record == null) return false;
            var owner = record.ownerId ?? string.Empty;
            return string.IsNullOrEmpty(owner)
                || string.Equals(owner, "public", StringComparison.OrdinalIgnoreCase)
                || string.Equals(owner, actorId ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        }
    }
}
