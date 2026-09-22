using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;
using Concordia.Vehicles;
using Concordia.WorldSystems;
using Concordia.GameplayCore.WorldFabric;

namespace Concordia.GameplayCore.Containers
{
    [Serializable]
    public sealed class CanonicalContainerPersistenceEnvelopeDto
    {
        public int schemaVersion = 1;
        public string savedAtUtc;
        public List<CanonicalContainerRecord> containers = new List<CanonicalContainerRecord>();
        public List<ContainerConsequenceEvent> consequences = new List<ContainerConsequenceEvent>();
    }

    public static class CanonicalContainerIds
    {
        public static string PlayerInventory(string inventoryId) { return "container/player/" + Normalize(inventoryId); }
        public static string VehicleStorage(string entityId) { return "container/vehicle/" + Normalize(entityId) + "/storage"; }
        public static string VehicleInventory(string entityId) { return "container/vehicle/" + Normalize(entityId) + "/inventory"; }
        public static string WorldFabric(string containerId) { return "container/fabric/" + Normalize(containerId); }
        public static string Create(string prefix, params string[] parts)
        {
            var canonical = new StringBuilder(Normalize(prefix));
            if (parts != null) for (var i = 0; i < parts.Length; i++) canonical.Append('|').Append(Normalize(parts[i]));
            unchecked { ulong hash = 14695981039346656037UL; for (var i = 0; i < canonical.Length; i++) { hash ^= canonical[i]; hash *= 1099511628211UL; } return Normalize(prefix) + "-" + hash.ToString("x16", CultureInfo.InvariantCulture); }
        }
        static string Normalize(string value) { return (value ?? "").Trim().ToLowerInvariant().Replace(' ', '-'); }
    }

    public sealed class WorldSystemsInventoryContainerAdapter : ICanonicalContainerContentsAdapter
    {
        readonly WorldSystemsInventoryContract inventory;
        public WorldSystemsInventoryContainerAdapter(WorldSystemsInventoryContract inventory) { this.inventory = inventory; }
        public string AuthorityId => inventory == null ? "" : inventory.inventoryId;
        public float Capacity => inventory == null ? 0f : inventory.capacity;
        public float UsedCapacity { get { return Total(inventory); } }
        public bool TryGetSnapshot(List<ContainerItemStack> destination)
        {
            if (inventory == null || destination == null) return false;
            destination.Clear();
            if (inventory.resources != null) foreach (var item in inventory.resources) if (item != null && item.quantity > 0f) destination.Add(new ContainerItemStack(item.resourceId, item.quantity));
            return true;
        }
        public bool TryPut(ContainerItemStack item)
        {
            if (inventory == null || item == null || string.IsNullOrEmpty(item.itemId) || item.quantity <= 0f || (inventory.capacity > 0f && UsedCapacity + item.Weight > inventory.capacity + 0.0001f)) return false;
            for (var i = 0; i < inventory.resources.Count; i++) if (inventory.resources[i] != null && Same(inventory.resources[i].resourceId, item.itemId)) { inventory.resources[i].quantity += item.quantity; return true; }
            inventory.resources.Add(new WorldSystemsResourceStack(item.itemId, item.quantity));
            return true;
        }
        public bool TryTake(string itemId, float quantity)
        {
            if (inventory == null || string.IsNullOrEmpty(itemId) || quantity <= 0f) return false;
            for (var i = 0; i < inventory.resources.Count; i++)
            {
                var stack = inventory.resources[i];
                if (stack == null || !Same(stack.resourceId, itemId) || stack.quantity + 0.0001f < quantity) continue;
                stack.quantity = Mathf.Max(0f, stack.quantity - quantity);
                return true;
            }
            return false;
        }
        static float Total(WorldSystemsInventoryContract value) { var total = 0f; if (value != null && value.resources != null) foreach (var item in value.resources) if (item != null) total += Mathf.Max(0f, item.quantity); return total; }
        static bool Same(string a, string b) { return string.Equals(a ?? "", b ?? "", StringComparison.OrdinalIgnoreCase); }
    }

    public sealed class VehicleStorageContainerAdapter : ICanonicalContainerContentsAdapter
    {
        readonly VehicleEntity vehicle;
        readonly bool storage;
        public VehicleStorageContainerAdapter(VehicleEntity vehicle, bool storage) { this.vehicle = vehicle; this.storage = storage; }
        public string AuthorityId => vehicle == null ? "" : vehicle.EntityId + (storage ? ":storage" : ":inventory");
        public float Capacity => vehicle == null ? 0f : (storage ? vehicle.StorageCapacity : vehicle.Inventory.Count + 1f);
        public float UsedCapacity { get { return vehicle == null ? 0f : (storage ? vehicle.StoredItems.Count : vehicle.Inventory.Count); } }
        public bool TryGetSnapshot(List<ContainerItemStack> destination)
        {
            if (vehicle == null || destination == null) return false;
            destination.Clear();
            var source = storage ? vehicle.StoredItems : vehicle.Inventory;
            foreach (var item in source) if (item != null && item.Quantity > 0) destination.Add(new ContainerItemStack(item.ItemId, item.Quantity));
            return true;
        }
        public bool TryPut(ContainerItemStack item)
        {
            if (vehicle == null || item == null || string.IsNullOrEmpty(item.itemId) || item.quantity <= 0f || UsedCapacity >= Capacity) return false;
            var value = new VehicleItem(item.itemId, Mathf.Max(1, Mathf.RoundToInt(item.quantity)));
            return storage ? vehicle.TryStore(value) : vehicle.TryAddItem(value);
        }
        public bool TryTake(string itemId, float quantity)
        {
            if (vehicle == null || string.IsNullOrEmpty(itemId) || quantity <= 0f) return false;
            var amount = Mathf.Max(1, Mathf.RoundToInt(quantity));
            return storage ? vehicle.TryWithdraw(itemId, amount) : vehicle.TryRemoveItem(itemId, amount);
        }
    }

    public sealed class WorldFabricContainerAdapter : ICanonicalContainerContentsAdapter
    {
        readonly WorldFabricContainer container;
        public WorldFabricContainerAdapter(WorldFabricContainer container) { this.container = container; }
        public string AuthorityId => container == null ? "" : container.containerId;
        public float Capacity => container == null ? 0f : container.capacity;
        public float UsedCapacity => container == null || container.itemIds == null ? 0f : container.itemIds.Count;
        public bool TryGetSnapshot(List<ContainerItemStack> destination)
        {
            if (container == null || destination == null) return false;
            destination.Clear();
            if (container.itemIds != null) foreach (var id in container.itemIds) if (!string.IsNullOrEmpty(id)) destination.Add(new ContainerItemStack(id, 1f));
            return true;
        }
        public bool TryPut(ContainerItemStack item) { return container != null && item != null && item.quantity == 1f && container.TryAdd(item.itemId); }
        public bool TryTake(string itemId, float quantity) { return container != null && quantity == 1f && container.TryRemove(itemId); }
    }

    /// <summary>Canonical container registry and operation coordinator. Backing inventories remain authoritative.</summary>
    public sealed class CanonicalContainerService
    {
        readonly Dictionary<string, CanonicalContainerRecord> records = new Dictionary<string, CanonicalContainerRecord>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, ICanonicalContainerContentsAdapter> adapters = new Dictionary<string, ICanonicalContainerContentsAdapter>(StringComparer.OrdinalIgnoreCase);
        readonly List<ContainerConsequenceEvent> consequences = new List<ContainerConsequenceEvent>();
        public IEnumerable<CanonicalContainerRecord> All => records.Values;
        public IReadOnlyList<ContainerConsequenceEvent> Consequences => consequences;

        public bool Register(CanonicalContainerRecord record, ICanonicalContainerContentsAdapter adapter = null)
        {
            if (record == null || string.IsNullOrEmpty(record.containerId) || records.ContainsKey(record.containerId)) return false;
            Normalize(record);
            records[record.containerId] = record;
            if (adapter != null) adapters[record.containerId] = adapter;
            Sync(record.containerId);
            return true;
        }
        public bool BindAdapter(string containerId, ICanonicalContainerContentsAdapter adapter)
        {
            if (string.IsNullOrEmpty(containerId) || adapter == null || !records.ContainsKey(containerId)) return false;
            adapters[containerId] = adapter;
            Sync(containerId);
            return true;
        }
        public bool TryGet(string containerId, out CanonicalContainerRecord record) { return records.TryGetValue(containerId ?? "", out record); }
        public CanonicalContainerRecord GetSnapshot(string containerId) { CanonicalContainerRecord value; return TryGet(containerId, out value) ? value.CloneSnapshot() : null; }

        public ContainerOperationResult Open(string containerId, string actorId, string factionId = null)
        {
            var result = Access(containerId, actorId, factionId, ContainerOperationKind.Open, out var record);
            if (!result.success) return result;
            Sync(containerId);
            result.containerId = containerId;
            result.message = "Opened " + (string.IsNullOrEmpty(record.displayName) ? containerId : record.displayName) + ".";
            return result;
        }
        public ContainerOperationResult Put(string containerId, string actorId, ContainerItemStack item, string factionId = null)
        {
            var access = Access(containerId, actorId, factionId, ContainerOperationKind.Put, out var record);
            if (!access.success) return access;
            if (item == null || string.IsNullOrEmpty(item.itemId) || item.quantity <= 0f) return Refuse(ContainerOperationKind.Put, ContainerRefusalReason.InvalidQuantity, "A positive item quantity is required.");
            Sync(containerId);
            if (record.isSealed) return Refuse(ContainerOperationKind.Put, ContainerRefusalReason.Locked, "The container is sealed.");
            if (record.UsedCapacity + item.Weight > record.capacity + 0.0001f) return Refuse(ContainerOperationKind.Put, ContainerRefusalReason.CapacityExceeded, "The container has no capacity for that item.");
            ICanonicalContainerContentsAdapter adapter;
            if (adapters.TryGetValue(containerId, out adapter) && !adapter.TryPut(item)) return Refuse(ContainerOperationKind.Put, ContainerRefusalReason.AdapterRejected, "The backing inventory rejected the item.");
            if (adapter == null) record.contents.Add(item.Clone());
            Sync(containerId);
            return Complete(ContainerOperationKind.Put, containerId, item.itemId, item.quantity, actorId, "Placed item in container.");
        }
        public ContainerOperationResult Take(string containerId, string actorId, string itemId, float quantity, string factionId = null)
        {
            var access = Access(containerId, actorId, factionId, ContainerOperationKind.Take, out var record);
            if (!access.success) return access;
            if (string.IsNullOrEmpty(itemId) || quantity <= 0f) return Refuse(ContainerOperationKind.Take, ContainerRefusalReason.InvalidQuantity, "A positive item quantity is required.");
            Sync(containerId);
            var stack = FindStack(record.contents, itemId);
            if (stack == null || stack.quantity + 0.0001f < quantity) return Refuse(ContainerOperationKind.Take, ContainerRefusalReason.ItemNotFound, "The requested item is not present.");
            ICanonicalContainerContentsAdapter adapter;
            if (adapters.TryGetValue(containerId, out adapter) && !adapter.TryTake(itemId, quantity)) return Refuse(ContainerOperationKind.Take, ContainerRefusalReason.AdapterRejected, "The backing inventory rejected the withdrawal.");
            if (adapter == null) { stack.quantity -= quantity; if (stack.quantity <= 0.0001f) record.contents.Remove(stack); }
            Sync(containerId);
            return Complete(ContainerOperationKind.Take, containerId, itemId, quantity, actorId, "Took item from container.");
        }
        public ContainerOperationResult Move(string sourceId, string destinationId, string actorId, string itemId, float quantity, string factionId = null)
        {
            var source = Take(sourceId, actorId, itemId, quantity, factionId);
            if (!source.success) return source;
            var destination = Put(destinationId, actorId, new ContainerItemStack(itemId, quantity), factionId);
            if (destination.success) { destination.operation = ContainerOperationKind.Move; destination.sourceContainerId = sourceId; return destination; }
            Put(sourceId, actorId, new ContainerItemStack(itemId, quantity), factionId);
            return Refuse(ContainerOperationKind.Move, destination.refusalReason == ContainerRefusalReason.None ? ContainerRefusalReason.DestinationAccessDenied : destination.refusalReason, "The destination rejected the move; the source was restored.");
        }
        public ContainerOperationResult Claim(string containerId, string actorId, string factionId = null)
        {
            var access = Access(containerId, actorId, factionId, ContainerOperationKind.Claim, out var record);
            if (!access.success && access.refusalReason != ContainerRefusalReason.NotClaimable) return access;
            if (record == null) return Refuse(ContainerOperationKind.Claim, ContainerRefusalReason.NotFound, "Container was not found.");
            if (!record.claimable) return Refuse(ContainerOperationKind.Claim, ContainerRefusalReason.NotClaimable, "This container is not claimable.");
            if (!string.IsNullOrEmpty(record.ownerId)) return Refuse(ContainerOperationKind.Claim, ContainerRefusalReason.AlreadyOwned, "This container already has an owner.");
            record.ownerId = actorId ?? "";
            record.accessRule = ContainerAccessRule.OwnerOnly;
            return Complete(ContainerOperationKind.Claim, containerId, null, 0f, actorId, "Claimed container.");
        }
        public void SyncAll() { foreach (var pair in records) Sync(pair.Key); }
        public CanonicalContainerPersistenceEnvelopeDto Capture(string savedAtUtc)
        {
            var envelope = new CanonicalContainerPersistenceEnvelopeDto { savedAtUtc = savedAtUtc ?? "" };
            foreach (var pair in records) { Sync(pair.Key); envelope.containers.Add(pair.Value.CloneSnapshot()); }
            foreach (var item in consequences) envelope.consequences.Add(item);
            return envelope;
        }
        public void Restore(CanonicalContainerPersistenceEnvelopeDto envelope)
        {
            records.Clear(); adapters.Clear(); consequences.Clear();
            if (envelope == null) return;
            if (envelope.containers != null) foreach (var record in envelope.containers) if (record != null && !string.IsNullOrEmpty(record.containerId)) { Normalize(record); records[record.containerId] = record; }
            if (envelope.consequences != null) consequences.AddRange(envelope.consequences);
        }

        ContainerOperationResult Access(string id, string actorId, string factionId, ContainerOperationKind operation, out CanonicalContainerRecord record)
        {
            record = null;
            if (string.IsNullOrEmpty(id)) return Refuse(operation, ContainerRefusalReason.InvalidRequest, "A container ID is required.");
            if (!records.TryGetValue(id, out record)) return Refuse(operation, ContainerRefusalReason.NotFound, "Container was not found.");
            if (!record.isPresent) return Refuse(operation, ContainerRefusalReason.NotPresent, "The container is not present.");
            if (record.condition <= 0f) return Refuse(operation, ContainerRefusalReason.Broken, "The container is broken.");
            if (record.accessRule == ContainerAccessRule.Locked) return Refuse(operation, ContainerRefusalReason.Locked, "The container is locked.");
            var owner = string.Equals(record.ownerId ?? "", actorId ?? "", StringComparison.OrdinalIgnoreCase);
            var allowed = record.allowedActorIds != null && record.allowedActorIds.Contains(actorId);
            var faction = !string.IsNullOrEmpty(factionId) && record.allowedFactionIds != null && record.allowedFactionIds.Contains(factionId);
            if (record.accessRule == ContainerAccessRule.OwnerOnly && !owner) return Refuse(operation, ContainerRefusalReason.NotOwner, "The actor does not own this container.");
            if (record.accessRule == ContainerAccessRule.OwnerOrAllowed && !owner && !allowed) return Refuse(operation, ContainerRefusalReason.NotAllowed, "The actor is not allowed to access this container.");
            if (record.accessRule == ContainerAccessRule.Faction && !faction) return Refuse(operation, ContainerRefusalReason.FactionMismatch, "The actor faction cannot access this container.");
            return ContainerOperationResult.Succeed(operation, "Access granted.");
        }
        ContainerOperationResult Complete(ContainerOperationKind operation, string containerId, string itemId, float quantity, string actorId, string detail)
        {
            var record = new ContainerConsequenceEvent { eventId = CanonicalContainerIds.Create("container-event", containerId, operation.ToString(), actorId, itemId, consequences.Count.ToString()), operation = operation, containerId = containerId, actorId = actorId ?? "", itemId = itemId ?? "", quantity = quantity, detail = detail ?? "", worldId = WorldClock.World.ToString(), occurredAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
            consequences.Add(record);
            return new ContainerOperationResult { success = true, operation = operation, refusalReason = ContainerRefusalReason.None, message = detail, containerId = containerId, itemId = itemId, quantity = quantity, consequence = record };
        }
        static ContainerOperationResult Refuse(ContainerOperationKind operation, ContainerRefusalReason reason, string message) { return ContainerOperationResult.Refuse(operation, reason, message); }
        void Sync(string id)
        {
            CanonicalContainerRecord record;
            if (!records.TryGetValue(id ?? "", out record)) return;
            ICanonicalContainerContentsAdapter adapter;
            if (adapters.TryGetValue(id, out adapter) && adapter != null) { adapter.TryGetSnapshot(record.contents); record.capacity = adapter.Capacity > 0f ? adapter.Capacity : record.capacity; }
            Normalize(record);
        }
        static ContainerItemStack FindStack(List<ContainerItemStack> list, string id) { if (list != null) foreach (var item in list) if (item != null && string.Equals(item.itemId, id, StringComparison.OrdinalIgnoreCase)) return item; return null; }
        static void Normalize(CanonicalContainerRecord record) { if (record.allowedActorIds == null) record.allowedActorIds = new List<string>(); if (record.allowedFactionIds == null) record.allowedFactionIds = new List<string>(); if (record.contents == null) record.contents = new List<ContainerItemStack>(); if (record.physicalLocation == null) record.physicalLocation = new ContainerPhysicalLocation(); if (record.provenance == null) record.provenance = new ContainerProvenance(); if (record.capacity < 0f) record.capacity = 0f; record.condition = Mathf.Clamp01(record.condition); }
    }
}