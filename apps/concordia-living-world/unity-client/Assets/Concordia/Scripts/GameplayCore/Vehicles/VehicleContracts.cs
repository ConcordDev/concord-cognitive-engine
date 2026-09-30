using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.Vehicles
{
    public enum VehicleKind { CreatureMount, Bike, Car, Truck, Boat, Aircraft, SciFi }
    public enum VehicleAuthority { Local, Predicted, Remote, Disabled }
    public enum VehicleActionType { Enter, Exit, Honk, Boost, Brake, Repair, ToggleAutopilot }
    public enum VehicleSeatRole { Driver, Passenger, Pilot, Gunner }
    public enum VehicleRelationshipKind { Neutral, Owner, Crew, Passenger, Hostile }

    [Serializable]
    public struct VehicleInput
    {
        public float Throttle;
        public float Brake;
        public float Steering;
        public float Pitch;
        public float Yaw;
        public float Roll;
        public bool Jump;
        public bool Boost;
        public static VehicleInput Neutral => default(VehicleInput);
        public VehicleInput Clamped()
        {
            var value = this;
            value.Throttle = Mathf.Clamp(value.Throttle, -1f, 1f);
            value.Brake = Mathf.Clamp01(value.Brake);
            value.Steering = Mathf.Clamp(value.Steering, -1f, 1f);
            value.Pitch = Mathf.Clamp(value.Pitch, -1f, 1f);
            value.Yaw = Mathf.Clamp(value.Yaw, -1f, 1f);
            value.Roll = Mathf.Clamp(value.Roll, -1f, 1f);
            return value;
        }
    }

    [Serializable]
    public struct VehicleMotionState
    {
        public Vector3 Velocity;
        public Vector3 AngularVelocity;
    }

    [Serializable]
    public sealed class VehicleItem
    {
        public string ItemId;
        public int Quantity = 1;
        public VehicleItem() { }
        public VehicleItem(string itemId, int quantity = 1) { ItemId = itemId; Quantity = quantity; }
    }

    [Serializable]
    public sealed class VehicleSeatHandle
    {
        public string SeatId;
        public VehicleSeatRole Role;
        public Transform Anchor;
        public GameObject Occupant;
        public bool IsOccupied => Occupant != null;
    }

    [Serializable]
    public sealed class VehicleEquipmentSlot
    {
        public string SlotId;
        public string ItemId;
        public bool Occupied => !string.IsNullOrEmpty(ItemId);
    }

    [Serializable]
    public sealed class VehicleEntityState
    {
        public string EntityId;
        public VehicleKind Kind;
        public VehicleAuthority Authority;
        public Vector3 Position;
        public Quaternion Rotation;
        public Vector3 Velocity;
        public float Health;
        public string OwnerId;
        public bool IsOccupied;
    }

    [Serializable]
    public sealed class VehicleDamageEvent
    {
        public float Amount;
        public string SourceId;
        public Vector3 Direction;
        public bool WasFatal;
    }

    [Serializable]
    public sealed class VehiclePersistenceRecord
    {
        public string EntityId;
        public int Kind;
        public float Px, Py, Pz;
        public float Rx, Ry, Rz, Rw = 1f;
        public float Health;
        public string OwnerId;
        public readonly List<VehicleItem> Inventory = new List<VehicleItem>();
    }

    public interface IVehicleEntity { }
    public interface IVehicleAction { bool TryPerform(VehicleActionType action, string parameter = null); }
    public interface IVehicleInventory { IReadOnlyList<VehicleItem> Inventory { get; } bool TryAddItem(VehicleItem item); bool TryRemoveItem(string itemId, int quantity); }
    public interface IVehicleOwnership { string OwnerId { get; } bool CanControl(string actorId); bool TransferOwnership(string actorId, string newOwnerId); }
    public interface IVehicleRelationship { VehicleRelationshipKind RelationshipTo(string actorId); void SetRelationship(string actorId, VehicleRelationshipKind relationship); }
    public interface IVehicleDamage { float Health { get; } float MaxHealth { get; } void ApplyDamage(VehicleDamageEvent damage); void Repair(float amount); }
    public interface IVehicleSeat { IReadOnlyList<VehicleSeatHandle> Seats { get; } bool TryEnter(GameObject occupant, string seatId = null); bool TryExit(GameObject occupant); GameObject Occupant(string seatId); }
    public interface IVehicleStorage { IReadOnlyList<VehicleItem> StoredItems { get; } int StorageCapacity { get; } bool TryStore(VehicleItem item); bool TryWithdraw(string itemId, int quantity); }
    public interface IVehicleEquipment { IReadOnlyList<VehicleEquipmentSlot> Equipment { get; } bool TryEquip(string slotId, string itemId); bool TryUnequip(string slotId, out string itemId); }
    public interface IVehiclePersistence { VehiclePersistenceRecord CaptureState(); void RestoreState(VehiclePersistenceRecord state); }
    public interface IVehicleAI { bool Autopilot { get; } void SetAutopilot(bool enabled, Vector3 destination); VehicleInput BuildAIInput(float deltaTime); }
    public interface IVehicleBody { Transform Root { get; } float Mass { get; } float Speed { get; } float MaxSpeed { get; } }
    public interface IVehiclePhysicsModel { VehicleKind SupportedKind { get; } void Simulate(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime); }

    public static class VehiclePersistenceService
    {
        static readonly HashSet<VehicleEntity> _vehicles = new HashSet<VehicleEntity>();
        public static void Register(VehicleEntity vehicle) { if (vehicle) _vehicles.Add(vehicle); }
        public static void Unregister(VehicleEntity vehicle) { if (vehicle) _vehicles.Remove(vehicle); }
        public static IReadOnlyCollection<VehicleEntity> Vehicles => _vehicles;
    }
}
