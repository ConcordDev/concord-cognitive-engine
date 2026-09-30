using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.Vehicles
{
    [DisallowMultipleComponent]
    [RequireComponent(typeof(Rigidbody))]
    public sealed class VehicleEntity : MonoBehaviour, IVehicleEntity, IVehicleBody, IVehicleAction,
        IVehicleInventory, IVehicleOwnership, IVehicleRelationship, IVehicleDamage, IVehicleSeat,
        IVehicleStorage, IVehicleEquipment, IVehiclePersistence, IVehicleAI
    {
        [Header("Entity")]
        [SerializeField] string entityId;
        [SerializeField] VehicleKind kind = VehicleKind.Car;
        [SerializeField] VehicleAuthority authority = VehicleAuthority.Local;
        [SerializeField] string ownerId;
        [SerializeField] float maxHealth = 100f;
        [SerializeField] float mass = 1200f;
        [SerializeField] float maxSpeed = 20f;

        [Header("Capacity")]
        [SerializeField] int inventoryCapacity = 16;
        [SerializeField] int storageCapacity = 24;
        [SerializeField] List<VehicleSeatHandle> seats = new List<VehicleSeatHandle>();
        [SerializeField] List<VehicleEquipmentSlot> equipment = new List<VehicleEquipmentSlot>();

        [Header("Runtime")]
        [SerializeField] bool autopilot;
        [SerializeField] Vector3 autopilotDestination;
        [SerializeField] float health;

        readonly List<VehicleItem> inventory = new List<VehicleItem>();
        readonly List<VehicleItem> storedItems = new List<VehicleItem>();
        readonly Dictionary<string, VehicleRelationshipKind> relationships = new Dictionary<string, VehicleRelationshipKind>();
        Rigidbody bodyRigidbody;
        VehiclePhysicsModelBase physicsModel;
        VehicleGroundMovement groundMovement;
        VehicleInput input;
        VehicleMotionState motion;
        bool initialized;

        public event Action<VehicleActionType> ActionPerformed;
        public event Action<VehicleDamageEvent> Damaged;

        public string EntityId => string.IsNullOrEmpty(entityId) ? name : entityId;
        public VehicleKind Kind => kind;
        public VehicleAuthority Authority => authority;
        public Transform Root => transform;
        public float Mass => bodyRigidbody ? bodyRigidbody.mass : mass;
        public float Speed => bodyRigidbody ? bodyRigidbody.linearVelocity.magnitude : motion.Velocity.magnitude;
        public float MaxSpeed => maxSpeed;
        public float Health => health;
        public float MaxHealth => maxHealth;
        public VehicleMotionState Motion => motion;
        public bool IsDestroyed => health <= 0f;
        public string OwnerId => ownerId;
        public bool Autopilot => autopilot;
        public IReadOnlyList<VehicleItem> Inventory => inventory;
        public IReadOnlyList<VehicleItem> StoredItems => storedItems;
        public IReadOnlyList<VehicleSeatHandle> Seats => seats;
        public IReadOnlyList<VehicleEquipmentSlot> Equipment => equipment;
        public int StorageCapacity => storageCapacity;

        void Awake()
        {
            bodyRigidbody = GetComponent<Rigidbody>();
            bodyRigidbody.mass = Mathf.Max(1f, mass);
            health = health <= 0f ? maxHealth : Mathf.Min(health, maxHealth);
            if (string.IsNullOrEmpty(entityId)) entityId = Guid.NewGuid().ToString("N");
            EnsureDefaultSeat();
            groundMovement = GetComponent<VehicleGroundMovement>();
            physicsModel = GetComponent<VehiclePhysicsModelBase>();
            if (!physicsModel) physicsModel = gameObject.AddComponent<VehiclePhysicsModelBase>();
            initialized = true;
        }

        void OnEnable() { VehiclePersistenceService.Register(this); }
        void OnDisable() { VehiclePersistenceService.Unregister(this); }

        void FixedUpdate()
        {
            if (groundMovement != null && groundMovement.UsesCharacterController) return;

            if (!initialized || authority == VehicleAuthority.Disabled || IsDestroyed) return;
            if (autopilot) input = BuildAIInput(Time.fixedDeltaTime);
            input = input.Clamped();
            physicsModel.Simulate(this, bodyRigidbody, input, Time.fixedDeltaTime);
            motion.Velocity = bodyRigidbody.linearVelocity;
            motion.AngularVelocity = bodyRigidbody.angularVelocity;
            if (bodyRigidbody.linearVelocity.sqrMagnitude > maxSpeed * maxSpeed)
                bodyRigidbody.linearVelocity = bodyRigidbody.linearVelocity.normalized * maxSpeed;
            input = VehicleInput.Neutral;
        }

        public void SetInput(VehicleInput nextInput)
        {
            if (authority == VehicleAuthority.Local || authority == VehicleAuthority.Predicted) input = nextInput;
        }

        public VehicleEntityState Snapshot()
        {
            return new VehicleEntityState
            {
                EntityId = EntityId, Kind = kind, Authority = authority,
                Position = transform.position, Rotation = transform.rotation,
                Velocity = bodyRigidbody ? bodyRigidbody.linearVelocity : Vector3.zero,
                Health = health, OwnerId = ownerId, IsOccupied = HasOccupant()
            };
        }

        public void ApplyMotion(VehicleMotionState state)
        {
            motion = state;
            if (!bodyRigidbody) return;
            bodyRigidbody.linearVelocity = state.Velocity;
            bodyRigidbody.angularVelocity = state.AngularVelocity;
        }

        public bool TryPerform(VehicleActionType action, string parameter = null)
        {
            if (IsDestroyed) return false;
            ActionPerformed?.Invoke(action);
            return true;
        }

        public bool TryAddItem(VehicleItem item)
        {
            if (item == null || string.IsNullOrEmpty(item.ItemId) || inventory.Count >= inventoryCapacity) return false;
            inventory.Add(item);
            return true;
        }

        public bool TryRemoveItem(string itemId, int quantity) { return RemoveFrom(inventory, itemId, quantity); }

        public bool CanControl(string actorId)
        {
            if (authority == VehicleAuthority.Remote || authority == VehicleAuthority.Disabled) return false;
            if (string.IsNullOrEmpty(ownerId)) return true;
            return ownerId == actorId || RelationshipTo(actorId) == VehicleRelationshipKind.Crew || RelationshipTo(actorId) == VehicleRelationshipKind.Owner;
        }

        public bool TransferOwnership(string actorId, string newOwnerId)
        {
            if (!CanControl(actorId) || string.IsNullOrEmpty(newOwnerId)) return false;
            ownerId = newOwnerId;
            SetRelationship(newOwnerId, VehicleRelationshipKind.Owner);
            return true;
        }

        public VehicleRelationshipKind RelationshipTo(string actorId)
        {
            if (string.IsNullOrEmpty(actorId)) return VehicleRelationshipKind.Neutral;
            if (actorId == ownerId) return VehicleRelationshipKind.Owner;
            VehicleRelationshipKind value;
            return relationships.TryGetValue(actorId, out value) ? value : VehicleRelationshipKind.Neutral;
        }

        public void SetRelationship(string actorId, VehicleRelationshipKind relationship)
        {
            if (!string.IsNullOrEmpty(actorId)) relationships[actorId] = relationship;
        }

        public void ApplyDamage(VehicleDamageEvent damage)
        {
            if (IsDestroyed || damage.Amount <= 0f) return;
            damage.WasFatal = damage.Amount >= health;
            health = Mathf.Max(0f, health - damage.Amount);
            if (damage.WasFatal && bodyRigidbody) bodyRigidbody.linearVelocity = Vector3.zero;
            Damaged?.Invoke(damage);
        }

        public void Repair(float amount) { health = Mathf.Clamp(health + Mathf.Max(0f, amount), 0f, maxHealth); }

        public bool TryEnter(GameObject occupant, string seatId = null)
        {
            if (!occupant || IsDestroyed) return false;
            VehicleSeatHandle seat = FindSeat(seatId);
            if (seat == null || seat.IsOccupied) return false;
            seat.Occupant = occupant;
            Transform anchor = seat.Anchor ? seat.Anchor : transform;
            occupant.transform.SetParent(anchor, false);
            occupant.transform.localPosition = Vector3.zero;
            occupant.transform.localRotation = Quaternion.identity;
            CharacterController controller = occupant.GetComponent<CharacterController>();
            if (controller) controller.enabled = false;
            return true;
        }

        public bool TryExit(GameObject occupant)
        {
            if (!occupant) return false;
            for (int i = 0; i < seats.Count; i++)
            {
                if (seats[i].Occupant != occupant) continue;
                seats[i].Occupant = null;
                occupant.transform.SetParent(null, true);
                occupant.transform.position = transform.position + transform.right * 2f + Vector3.up * 0.2f;
                CharacterController controller = occupant.GetComponent<CharacterController>();
                if (controller) controller.enabled = true;
                return true;
            }
            return false;
        }

        public GameObject Occupant(string seatId)
        {
            VehicleSeatHandle seat = FindSeat(seatId);
            return seat == null ? null : seat.Occupant;
        }

        public bool TryStore(VehicleItem item)
        {
            if (item == null || string.IsNullOrEmpty(item.ItemId) || storedItems.Count >= storageCapacity) return false;
            storedItems.Add(item);
            return true;
        }

        public bool TryWithdraw(string itemId, int quantity) { return RemoveFrom(storedItems, itemId, quantity); }

        public bool TryEquip(string slotId, string itemId)
        {
            if (string.IsNullOrEmpty(slotId) || string.IsNullOrEmpty(itemId)) return false;
            VehicleEquipmentSlot slot = equipment.Find(x => x.SlotId == slotId);
            if (slot == null) { slot = new VehicleEquipmentSlot { SlotId = slotId }; equipment.Add(slot); }
            slot.ItemId = itemId;
            return true;
        }

        public bool TryUnequip(string slotId, out string itemId)
        {
            itemId = null;
            VehicleEquipmentSlot slot = equipment.Find(x => x.SlotId == slotId);
            if (slot == null || !slot.Occupied) return false;
            itemId = slot.ItemId;
            slot.ItemId = null;
            return true;
        }

        public void SetAutopilot(bool enabled, Vector3 destination)
        {
            autopilot = enabled;
            autopilotDestination = destination;
        }

        public VehicleInput BuildAIInput(float deltaTime)
        {
            Vector3 local = transform.InverseTransformDirection(autopilotDestination - transform.position);
            float distance = local.magnitude;
            float lateral = Mathf.Clamp(local.x / Mathf.Max(1f, local.magnitude), -1f, 1f);
            return new VehicleInput
            {
                Throttle = distance > 2f ? 1f : 0f,
                Brake = distance <= 2f ? 1f : 0f,
                Steering = lateral,
                Yaw = lateral
            };
        }

        public VehiclePersistenceRecord CaptureState()
        {
            VehiclePersistenceRecord record = new VehiclePersistenceRecord
            {
                EntityId = EntityId, Kind = (int)kind,
                Px = transform.position.x, Py = transform.position.y, Pz = transform.position.z,
                Rx = transform.rotation.x, Ry = transform.rotation.y, Rz = transform.rotation.z, Rw = transform.rotation.w,
                Health = health, OwnerId = ownerId
            };
            record.Inventory.AddRange(inventory);
            record.Inventory.AddRange(storedItems);
            return record;
        }

        public void RestoreState(VehiclePersistenceRecord state)
        {
            if (state == null || state.EntityId != EntityId) return;
            transform.position = new Vector3(state.Px, state.Py, state.Pz);
            transform.rotation = new Quaternion(state.Rx, state.Ry, state.Rz, state.Rw);
            health = Mathf.Clamp(state.Health, 0f, maxHealth);
            ownerId = state.OwnerId;
            inventory.Clear();
            storedItems.Clear();
            for (int i = 0; i < state.Inventory.Count; i++) TryStore(state.Inventory[i]);
        }

        void EnsureDefaultSeat()
        {
            if (seats == null) seats = new List<VehicleSeatHandle>();
            if (seats.Count == 0) seats.Add(new VehicleSeatHandle { SeatId = "driver", Role = kind == VehicleKind.Aircraft ? VehicleSeatRole.Pilot : VehicleSeatRole.Driver });
        }

        VehicleSeatHandle FindSeat(string seatId)
        {
            if (seats == null || seats.Count == 0) return null;
            if (string.IsNullOrEmpty(seatId))
                for (int i = 0; i < seats.Count; i++) if (!seats[i].IsOccupied) return seats[i];
            return seats.Find(x => x.SeatId == seatId);
        }

        bool HasOccupant()
        {
            for (int i = 0; i < seats.Count; i++) if (seats[i].IsOccupied) return true;
            return false;
        }

        static bool RemoveFrom(List<VehicleItem> list, string itemId, int quantity)
        {
            if (string.IsNullOrEmpty(itemId) || quantity <= 0) return false;
            for (int i = 0; i < list.Count; i++)
            {
                if (list[i].ItemId != itemId) continue;
                list[i].Quantity -= quantity;
                if (list[i].Quantity <= 0) list.RemoveAt(i);
                return true;
            }
            return false;
        }
    }
}
