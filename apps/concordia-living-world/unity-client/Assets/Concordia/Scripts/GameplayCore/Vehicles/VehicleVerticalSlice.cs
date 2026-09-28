using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.Vehicles
{
    public enum VehicleCategory
    {
        Mount,
        Vehicle
    }

    public enum VehicleMovementBackend
    {
        Auto,
        Rigidbody,
        CharacterController
    }

    public enum VehicleNpcUseMode
    {
        None,
        Destination,
        Follow
    }

    [Serializable]
    public struct VehicleNpcUseState
    {
        public bool Active;
        public string ControllerId;
        public Vector3 Destination;
        public VehicleNpcUseMode Mode;
    }

    /// <summary>
    /// Composition entry point for a playable vehicle or creature mount. VehicleEntity
    /// remains the state, persistence, seat, ownership, and Rigidbody authority; this
    /// component only routes possession/input and exposes reusable interaction methods.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(VehicleEntity))]
    [DefaultExecutionOrder(-100)]
    public sealed class VehicleVerticalSlice : MonoBehaviour
    {
        [Header("Composition")]
        [SerializeField] VehicleMovementBackend movementBackend = VehicleMovementBackend.Auto;
        [SerializeField] int passengerSeatCount = 1;
        [SerializeField] string passengerSeatPrefix = "passenger";
        [SerializeField] bool readLegacyInput = true;

        [Header("Interaction")]
        [SerializeField] float interactionRadius = 3.5f;
        [SerializeField] bool requireOwnershipForPossession = true;
        [SerializeField] string defaultActorId = "player";

        VehicleEntity entity;
        VehicleGroundMovement groundMovement;
        GameObject driver;
        string controllingActorId;
        VehicleInput lastInput;
        VehicleNpcUseState npcUse;

        public VehicleEntity Entity => entity;
        public VehicleCategory Category => entity != null && entity.Kind == VehicleKind.CreatureMount ? VehicleCategory.Mount : VehicleCategory.Vehicle;
        public VehicleKind Kind => entity != null ? entity.Kind : VehicleKind.Car;
        public VehicleMovementBackend ConfiguredMovementBackend => movementBackend;
        public VehicleMovementBackend ActiveMovementBackend => groundMovement != null ? groundMovement.ActiveBackend : VehicleMovementBackend.Rigidbody;
        public GameObject Driver => driver;
        public string ControllingActorId => controllingActorId;
        public bool IsPossessed => driver != null && !string.IsNullOrEmpty(controllingActorId);
        public float InteractionRadius => interactionRadius;
        public VehicleNpcUseState NpcUse => npcUse;
        public float HandlingMultiplier => VehicleHandlingPolicy.GetHandlingMultiplier(entity);
        public VehicleInput LastInput => lastInput;

        void Awake()
        {
            entity = GetComponent<VehicleEntity>();
            EnsurePhysicsModel();
            EnsureSeatLayout();
            groundMovement = GetComponent<VehicleGroundMovement>();
            if (groundMovement == null) groundMovement = gameObject.AddComponent<VehicleGroundMovement>();
            groundMovement.Configure(movementBackend);
        }

        void Update()
        {
            if (!readLegacyInput || !IsPossessed || driver == null || entity == null || entity.IsDestroyed) return;
            if (!entity.CanControl(controllingActorId))
            {
                ReleasePossession(controllingActorId);
                return;
            }

            var input = new VehicleInput
            {
                Throttle = Input.GetAxisRaw("Vertical"),
                Steering = Input.GetAxisRaw("Horizontal"),
                Brake = Input.GetKey(KeyCode.Space) ? 1f : 0f,
                Jump = Input.GetKeyDown(KeyCode.Space),
                Boost = Input.GetKey(KeyCode.LeftShift),
                Yaw = Input.GetAxisRaw("Horizontal")
            };
            SetInput(driver, controllingActorId, input);
        }

        /// <summary>Enters the first available driver/pilot seat and claims possession.</summary>
        public bool TryEnterDriver(GameObject actor, string actorId = null)
        {
            if (!CanInteract(actor) || entity == null) return false;
            actorId = NormalizeActorId(actor, actorId);
            if (!CanClaimOrControl(actorId)) return false;

            var seat = FindDriverSeat();
            if (seat == null || seat.IsOccupied) return false;
            if (!entity.TryEnter(actor, seat.SeatId)) return false;

            driver = actor;
            controllingActorId = actorId;
            entity.SetRelationship(actorId, VehicleRelationshipKind.Crew);
            if (string.IsNullOrEmpty(entity.OwnerId)) entity.TransferOwnership(actorId, actorId);
            npcUse = default(VehicleNpcUseState);
            entity.SetAutopilot(false, Vector3.zero);
            return true;
        }

        /// <summary>Enters an available passenger seat without changing vehicle ownership.</summary>
        public bool TryEnterPassenger(GameObject actor, string actorId = null, string seatId = null)
        {
            if (!CanInteract(actor) || entity == null) return false;
            actorId = NormalizeActorId(actor, actorId);
            if (entity.RelationshipTo(actorId) == VehicleRelationshipKind.Hostile) return false;

            var seat = FindPassengerSeat(seatId);
            return seat != null && !seat.IsOccupied && entity.TryEnter(actor, seat.SeatId);
        }

        public bool TryExit(GameObject actor)
        {
            if (!actor || entity == null || !entity.TryExit(actor)) return false;
            if (driver == actor)
            {
                driver = null;
                controllingActorId = null;
                lastInput = VehicleInput.Neutral;
                if (groundMovement != null) groundMovement.SubmitInput(lastInput);
                entity.SetInput(lastInput);
            }
            return true;
        }

        /// <summary>Claims ownership when unowned, then enters the actor as the driver.</summary>
        public bool TryPossess(GameObject actor, string actorId = null)
        {
            if (!actor || entity == null) return false;
            actorId = NormalizeActorId(actor, actorId);
            if (driver != actor && !TryEnterDriver(actor, actorId)) return false;
            if (!CanClaimOrControl(actorId)) return false;
            driver = actor;
            controllingActorId = actorId;
            return true;
        }

        public bool ReleasePossession(string actorId = null)
        {
            if (!IsPossessed) return false;
            if (!string.IsNullOrEmpty(actorId) && actorId != controllingActorId) return false;
            lastInput = VehicleInput.Neutral;
            if (groundMovement != null) groundMovement.SubmitInput(lastInput);
            entity.SetInput(lastInput);
            controllingActorId = null;
            return true;
        }

        /// <summary>Routes external input through damage handling into the selected motor.</summary>
        public bool SetInput(GameObject actor, string actorId, VehicleInput input)
        {
            if (entity == null || entity.IsDestroyed || actor == null || actor != driver) return false;
            actorId = NormalizeActorId(actor, actorId);
            if (actorId != controllingActorId || !entity.CanControl(actorId)) return false;

            lastInput = VehicleHandlingPolicy.Apply(entity, input);
            if (groundMovement != null && groundMovement.UsesCharacterController)
                groundMovement.SubmitInput(lastInput);
            else
                entity.SetInput(lastInput);
            return true;
        }

        public bool TryTransferOwnership(string actorId, string newOwnerId)
        {
            return entity != null && entity.TransferOwnership(NormalizeActorId(null, actorId), newOwnerId);
        }

        /// <summary>Starts or stops contract-backed NPC/autopilot use of the vehicle.</summary>
        public bool SetNpcUse(string controllerId, Vector3 destination, VehicleNpcUseMode mode = VehicleNpcUseMode.Destination)
        {
            if (entity == null || string.IsNullOrEmpty(controllerId) || IsPossessed) return false;
            if (!entity.CanControl(controllerId)) return false;

            npcUse = new VehicleNpcUseState
            {
                Active = true,
                ControllerId = controllerId,
                Destination = destination,
                Mode = mode
            };
            entity.SetAutopilot(true, destination);
            return true;
        }

        public void StopNpcUse()
        {
            npcUse = default(VehicleNpcUseState);
            if (entity != null) entity.SetAutopilot(false, Vector3.zero);
        }

        public VehiclePersistenceDto CapturePersistenceDto()
        {
            return VehiclePersistenceDto.FromEntity(entity);
        }

        public bool RestorePersistenceDto(VehiclePersistenceDto dto)
        {
            return dto != null && dto.ApplyTo(entity);
        }

        bool CanInteract(GameObject actor)
        {
            return actor && interactionRadius <= 0f || actor && Vector3.Distance(actor.transform.position, transform.position) <= interactionRadius;
        }

        bool CanClaimOrControl(string actorId)
        {
            if (string.IsNullOrEmpty(actorId) || entity == null) return false;
            if (!requireOwnershipForPossession) return true;
            return entity.CanControl(actorId);
        }

        string NormalizeActorId(GameObject actor, string actorId)
        {
            if (!string.IsNullOrEmpty(actorId)) return actorId;
            if (!string.IsNullOrEmpty(defaultActorId)) return defaultActorId;
            return actor ? actor.name : string.Empty;
        }

        VehicleSeatHandle FindDriverSeat()
        {
            var seats = entity != null ? entity.Seats : null;
            if (seats == null) return null;
            for (var i = 0; i < seats.Count; i++)
            {
                var seat = seats[i];
                if (seat != null && (seat.Role == VehicleSeatRole.Driver || seat.Role == VehicleSeatRole.Pilot)) return seat;
            }
            return null;
        }

        VehicleSeatHandle FindPassengerSeat(string seatId)
        {
            var seats = entity != null ? entity.Seats : null;
            if (seats == null) return null;
            for (var i = 0; i < seats.Count; i++)
            {
                var seat = seats[i];
                if (seat == null || seat.IsOccupied) continue;
                if (!string.IsNullOrEmpty(seatId) && seat.SeatId != seatId) continue;
                if (seat.Role == VehicleSeatRole.Passenger || seat.Role == VehicleSeatRole.Gunner) return seat;
            }
            return null;
        }

        void EnsureSeatLayout()
        {
            if (entity == null || passengerSeatCount <= 0) return;
            var mutable = entity.Seats as IList<VehicleSeatHandle>;
            if (mutable == null) return;

            var existingPassengers = 0;
            for (var i = 0; i < mutable.Count; i++)
            {
                if (mutable[i] != null && (mutable[i].Role == VehicleSeatRole.Passenger || mutable[i].Role == VehicleSeatRole.Gunner)) existingPassengers++;
            }
            for (var i = existingPassengers; i < passengerSeatCount; i++)
            {
                var seatId = passengerSeatPrefix + (i + 1).ToString();
                mutable.Add(new VehicleSeatHandle
                {
                    SeatId = seatId,
                    Role = VehicleSeatRole.Passenger,
                    Anchor = FindOrCreateAnchor(seatId)
                });
            }
        }

        Transform FindOrCreateAnchor(string seatId)
        {
            var childName = "SeatAnchor_" + seatId;
            var child = transform.Find(childName);
            if (child != null) return child;
            var anchor = new GameObject(childName).transform;
            anchor.SetParent(transform, false);
            anchor.localPosition = seatId.StartsWith("passenger", StringComparison.OrdinalIgnoreCase) ? new Vector3(-0.8f, 0.8f, 0f) : new Vector3(0f, 0.8f, 0f);
            anchor.localRotation = Quaternion.identity;
            return anchor;
        }

        void EnsurePhysicsModel()
        {
            if (entity == null || GetComponent<VehiclePhysicsModelBase>() != null) return;
            switch (entity.Kind)
            {
                case VehicleKind.CreatureMount:
                    gameObject.AddComponent<CreatureMountPhysicsModel>();
                    break;
                case VehicleKind.Boat:
                    gameObject.AddComponent<WatercraftPhysicsModel>();
                    break;
                case VehicleKind.Aircraft:
                    gameObject.AddComponent<AircraftPhysicsModel>();
                    break;
                case VehicleKind.SciFi:
                    gameObject.AddComponent<SciFiVehiclePhysicsModel>();
                    break;
                default:
                    gameObject.AddComponent<GroundVehiclePhysicsModel>();
                    break;
            }
        }
    }

    public static class VehicleHandlingPolicy
    {
        public static float GetHandlingMultiplier(IVehicleDamage damage)
        {
            if (damage == null || damage.MaxHealth <= 0f) return 1f;
            var health01 = Mathf.Clamp01(damage.Health / damage.MaxHealth);
            return Mathf.Lerp(0.2f, 1f, health01 * health01);
        }

        public static VehicleInput Apply(IVehicleDamage damage, VehicleInput input)
        {
            var multiplier = GetHandlingMultiplier(damage);
            input.Throttle *= multiplier;
            input.Steering *= Mathf.Lerp(0.35f, 1f, multiplier);
            input.Pitch *= multiplier;
            input.Yaw *= multiplier;
            input.Roll *= multiplier;
            if (multiplier <= 0.2f) input.Boost = false;
            return input.Clamped();
        }
    }
}
