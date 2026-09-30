using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.WorldSystems;

namespace Concordia.GameplayCore.WorldFabric
{
    [Serializable]
    public sealed class WorldFabricInteractionResolution
    {
        public bool found;
        public bool available;
        public float distance;
        public string targetId;
        public string displayName;
        public string ownerId;
        public string containerId;
        public string semanticId;
        public string prompt;
        public string why;
        public WorldFabricInteractionKind primaryVerb;
        public global::Concordia.WorldField.Sample field;
        public WorldFabricIdentity identity;
        public readonly List<WorldFabricInteractionKind> verbs = new List<WorldFabricInteractionKind>();

        public string VerbLine()
        {
            if (verbs.Count == 0) return string.Empty;
            var values = new List<string>();
            for (var i = 0; i < verbs.Count; i++) values.Add(verbs[i].ToString());
            return string.Join(" / ", values.ToArray());
        }
    }

    /// <summary>
    /// Read/resolve seam for player interaction. It observes WorldField, WorldFabric,
    /// ownership and the canonical player inventory without becoming a second mutation
    /// authority. Execution remains on WorldFabricRuntime and existing legacy handlers.
    /// </summary>
    public static class WorldFabricInteractionResolver
    {
        public static WorldFabricInteractionResolution Resolve(
            WorldFabricService fabric,
            Vector3 position,
            WorldId world,
            string actorId,
            WorldSystemsInventoryContract inventory,
            float maxDistance = 3.2f)
        {
            var result = new WorldFabricInteractionResolution
            {
                field = global::Concordia.WorldField.At(world, position, "athletics", world),
                distance = maxDistance
            };
            if (fabric == null) return result;

            WorldFabricIdentity nearest = null;
            var best = Mathf.Max(0.1f, maxDistance);
            var identities = UnityEngine.Object.FindObjectsByType<WorldFabricIdentity>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (var i = 0; i < identities.Length; i++)
            {
                var candidate = identities[i];
                if (!candidate || string.IsNullOrEmpty(candidate.objectId)) continue;
                var distance = Vector3.Distance(position, candidate.transform.position);
                if (distance <= best) { best = distance; nearest = candidate; }
            }
            if (!nearest) return result;

            result.found = true;
            result.distance = best;
            result.identity = nearest;
            result.targetId = nearest.objectId;
            var record = fabric.TryGetObject(nearest.objectId);
            if (record == null)
            {
                result.displayName = string.IsNullOrEmpty(nearest.semanticId) ? nearest.name : nearest.semanticId;
                result.why = "The scene identity is present, but no authoritative WorldFabricObjectRecord is live.";
                result.prompt = "E  ·  Inspect " + result.displayName;
                result.verbs.Add(WorldFabricInteractionKind.Inspect);
                return result;
            }

            result.displayName = string.IsNullOrEmpty(record.displayName) ? record.semanticId : record.displayName;
            result.ownerId = record.ownerId ?? string.Empty;
            result.containerId = record.containerId ?? string.Empty;
            result.semanticId = record.semanticId ?? string.Empty;
            result.primaryVerb = record.interaction;
            var accessible = CanAccess(record, actorId);
            var hasSpace = inventory == null || inventory.capacity <= 0f || CurrentQuantity(inventory) + Mathf.Max(1, record.quantity) <= inventory.capacity + 0.0001f;
            if (!record.present)
                result.why = "This object is no longer present in the authoritative fabric record.";
            else if (!record.interactive)
                result.why = "This object is present, but it has no interactive capability.";
            else if (!accessible)
                result.why = "This object is owned by " + result.ownerId + " and the actor has no access right.";
            else if (record.interaction == WorldFabricInteractionKind.Take && !hasSpace)
                result.why = "The canonical player inventory has no capacity for this object.";
            else if (!result.field.ok)
                result.why = "WorldField could not provide a valid local resolution sample.";
            else
                result.why = record.displayName + " is available because its live fabric record, field sample, and ownership checks resolve.";

            result.available = record.present && record.interactive && accessible && hasSpace && result.field.ok;
            result.verbs.Add(WorldFabricInteractionKind.Inspect);
            if (record.interaction != WorldFabricInteractionKind.None) result.verbs.Add(record.interaction);
            result.prompt = result.available
                ? "E  ·  " + record.interaction + " " + result.displayName
                : "E  ·  Inspect " + result.displayName + "  (unavailable)";
            return result;
        }

        static bool CanAccess(WorldFabricObjectRecord record, string actorId)
        {
            if (record == null) return false;
            var owner = record.ownerId ?? string.Empty;
            return string.IsNullOrEmpty(owner)
                || string.Equals(owner, "public", StringComparison.OrdinalIgnoreCase)
                || string.Equals(owner, actorId ?? string.Empty, StringComparison.OrdinalIgnoreCase);
        }

        static float CurrentQuantity(WorldSystemsInventoryContract inventory)
        {
            var total = 0f;
            if (inventory == null || inventory.resources == null) return total;
            for (var i = 0; i < inventory.resources.Count; i++)
                if (inventory.resources[i] != null) total += Mathf.Max(0f, inventory.resources[i].quantity);
            return total;
        }
    }
}
