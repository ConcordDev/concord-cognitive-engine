using System;
using UnityEngine;

namespace Concordia.GameplayCore.Movement
{
    public enum LocomotionContext { Grounded, Airborne, Swimming, Climbing, Flight, Superspeed }

    [Serializable]
    public struct LocomotionInput
    {
        public Vector2 Move;
        public bool Sprint;
        public bool Jump;
        public bool Ascend;
        public bool Descend;
        public bool Brake;
        public bool HasMove => Move.sqrMagnitude > 0.0001f;
    }

    [Serializable]
    public struct LocomotionSurfaceData
    {
        public string Id;
        public float SpeedMultiplier;
        public float AccelerationMultiplier;
        public float BrakingMultiplier;
        public float SlopeLimit;

        public static LocomotionSurfaceData Default => new LocomotionSurfaceData
        {
            Id = "default",
            SpeedMultiplier = 1f,
            AccelerationMultiplier = 1f,
            BrakingMultiplier = 1f,
            SlopeLimit = 48f
        };

        public LocomotionSurfaceData Sanitized()
        {
            var value = this;
            if (string.IsNullOrEmpty(value.Id)) value.Id = "default";
            value.SpeedMultiplier = Mathf.Max(0.05f, value.SpeedMultiplier);
            value.AccelerationMultiplier = Mathf.Max(0.05f, value.AccelerationMultiplier);
            value.BrakingMultiplier = Mathf.Max(0.05f, value.BrakingMultiplier);
            value.SlopeLimit = Mathf.Clamp(value.SlopeLimit, 1f, 89f);
            return value;
        }
    }

    [Serializable]
    public struct LocomotionEnvironment
    {
        public bool Grounded;
        public bool WallContact;
        public bool InSwimVolume;
        public bool InFlightVolume;
        public bool SuperspeedAllowed;
        public float SlopeAngle;
        public Vector3 GroundNormal;
        public Vector3 WallNormal;
        public LocomotionSurfaceData Surface;
    }

    [Serializable]
    public struct LocomotionTuning
    {
        public float walkSpeed;
        public float sprintSpeed;
        public float swimSpeed;
        public float climbSpeed;
        public float flightSpeed;
        public float superspeed;
        public float groundAcceleration;
        public float groundBraking;
        public float airAcceleration;
        public float swimAcceleration;
        public float climbAcceleration;
        public float flightAcceleration;
        public float gravity;
        public float maxFallSpeed;
        public float jumpSpeed;
        public float jumpStamina;
        public float sprintStaminaPerSecond;
        public float superspeedStaminaPerSecond;
        public float climbStaminaPerSecond;

        public static LocomotionTuning Default => new LocomotionTuning
        {
            walkSpeed = 5.2f,
            sprintSpeed = 8.1f,
            swimSpeed = 3.6f,
            climbSpeed = 2.6f,
            flightSpeed = 12f,
            superspeed = 18f,
            groundAcceleration = 8.2f,
            groundBraking = 14f,
            airAcceleration = 4.2f,
            swimAcceleration = 5f,
            climbAcceleration = 5f,
            flightAcceleration = 8f,
            gravity = -22f,
            maxFallSpeed = 45f,
            jumpSpeed = 8.2f,
            jumpStamina = 10f,
            sprintStaminaPerSecond = 4f,
            superspeedStaminaPerSecond = 18f,
            climbStaminaPerSecond = 22f
        };

        public float slopeLimit => 48f;
    }

    [Serializable]
    public struct LocomotionStamina
    {
        public float Current;
        public float Maximum;
        public bool TrySpend(float amount)
        {
            amount = Mathf.Max(0f, amount);
            if (Current < amount) return false;
            Current -= amount;
            return true;
        }
    }

    [Serializable]
    public struct LocomotionSnapshot
    {
        public LocomotionContext Context;
        public string Animation;
        public Vector3 Position;
        public Vector3 Velocity;
        public Vector3 GroundNormal;
        public float SlopeAngle;
        public float Stamina;
        public bool Grounded;
        public bool WallContact;
        public string SurfaceId;
    }

    [Serializable]
    public struct LocomotionTransition
    {
        public LocomotionContext From;
        public LocomotionContext To;
        public bool Changed => From != To;
    }

    public interface ILocomotionAnimationSink { }

    public sealed class LocomotionStateMachine
    {
        public LocomotionContext Current { get; private set; } = LocomotionContext.Grounded;

        public void Reset(bool grounded)
        {
            Current = grounded ? LocomotionContext.Grounded : LocomotionContext.Airborne;
        }

        public LocomotionTransition Evaluate(LocomotionInput input, LocomotionEnvironment environment, LocomotionTuning tuning, float stamina, bool canClimb)
        {
            var previous = Current;
            if (environment.InFlightVolume) Current = LocomotionContext.Flight;
            else if (environment.InSwimVolume) Current = LocomotionContext.Swimming;
            else if (canClimb && environment.WallContact && input.Ascend && stamina > 1f) Current = LocomotionContext.Climbing;
            else if (environment.SuperspeedAllowed && input.Sprint && input.HasMove && stamina > 5f) Current = LocomotionContext.Superspeed;
            else if (environment.Grounded) Current = LocomotionContext.Grounded;
            else Current = LocomotionContext.Airborne;
            return new LocomotionTransition { From = previous, To = Current };
        }
    }

    public static class LocomotionAnimationSelector
    {
        public static string Select(LocomotionContext context, Vector3 velocity, bool grounded)
        {
            if (context == LocomotionContext.Swimming) return "swim";
            if (context == LocomotionContext.Climbing) return "climb";
            if (context == LocomotionContext.Flight) return "flight";
            if (context == LocomotionContext.Superspeed) return "superspeed";
            if (!grounded) return "airborne";
            return velocity.sqrMagnitude > 0.25f ? "locomotion" : "idle";
        }
    }

    public sealed class ConcordiaInputSource
    {
        public LocomotionInput Read(Transform subject, ChaseCameraAdapter camera)
        {
            var move = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
            return new LocomotionInput
            {
                Move = move,
                Sprint = Input.GetKey(KeyCode.LeftShift),
                Jump = Input.GetKeyDown(KeyCode.Space),
                Ascend = Input.GetKey(KeyCode.Space),
                Descend = Input.GetKey(KeyCode.LeftControl),
                Brake = Input.GetKey(KeyCode.S)
            };
        }
    }

    public sealed class ChaseCameraAdapter
    {
        public Vector3 PlanarForward { get; set; } = Vector3.forward;
        public Vector3 PlanarRight { get; set; } = Vector3.right;
    }

    public sealed class ConcordiaLocomotionBindings
    {
        public CharacterController Controller { get; private set; }
        public bool CanClimb { get; private set; }
        public void Resolve(Transform root)
        {
            Controller = root ? root.GetComponent<CharacterController>() : null;
            var body = root ? root.GetComponent<Concordia.LivingBody>() : null;
            CanClimb = body != null && body.CanClimb;
        }
        public void ApplyAnimation(LocomotionSnapshot snapshot) { }
    }
}
