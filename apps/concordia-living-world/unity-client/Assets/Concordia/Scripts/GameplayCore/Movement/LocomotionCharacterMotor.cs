using UnityEngine;

namespace Concordia.GameplayCore.Movement
{
    /// <summary>
    /// CharacterController movement authority for the kernel. It computes one
    /// velocity and performs exactly one Move per simulation tick.
    /// </summary>
    public sealed class LocomotionCharacterMotor
    {
        readonly CharacterController _controller;
        readonly Transform _root;
        readonly int _collisionMask;
        readonly float _skin;

        public Vector3 Velocity { get; private set; }
        public CollisionFlags LastCollisionFlags { get; private set; }
        public bool LastMoveWasClipped { get; private set; }

        public LocomotionCharacterMotor(CharacterController controller, LayerMask collisionMask, float skin)
        {
            _controller = controller;
            _root = controller ? controller.transform : null;
            _collisionMask = collisionMask.value;
            _skin = Mathf.Max(0.01f, skin);
        }

        public void ResetVelocity(Vector3 velocity)
        {
            Velocity = velocity;
        }

        public Vector3 Step(
            LocomotionContext context,
            LocomotionInput input,
            LocomotionEnvironment environment,
            Vector3 worldWish,
            LocomotionTuning tuning,
            ref LocomotionStamina stamina,
            float bodySpeedMultiplier,
            bool allowJump,
            float dt)
        {
            if (!_controller || dt <= 0f) return Velocity;

            var surface = environment.Surface.Sanitized();
            var speedMul = surface.SpeedMultiplier * Mathf.Max(0.05f, bodySpeedMultiplier);
            var target = Vector3.zero;
            var acceleration = tuning.airAcceleration;
            var preserveVertical = false;
            var planarWish = worldWish;
            planarWish.y = 0f;
            if (planarWish.sqrMagnitude > 1f) planarWish.Normalize();

            switch (context)
            {
                case LocomotionContext.Swimming:
                    target = planarWish * tuning.swimSpeed * speedMul;
                    target.y = (input.Ascend ? tuning.swimSpeed : 0f) - (input.Descend ? tuning.swimSpeed : 0f);
                    acceleration = tuning.swimAcceleration * surface.AccelerationMultiplier;
                    preserveVertical = true;
                    break;

                case LocomotionContext.Climbing:
                    var wallPlanar = Vector3.ProjectOnPlane(planarWish, environment.WallNormal);
                    if (wallPlanar.sqrMagnitude > 1f) wallPlanar.Normalize();
                    target = wallPlanar * tuning.climbSpeed * speedMul;
                    target.y = input.Move.y * tuning.climbSpeed;
                    acceleration = tuning.climbAcceleration * surface.AccelerationMultiplier;
                    preserveVertical = true;
                    break;

                case LocomotionContext.Flight:
                    target = worldWish * tuning.flightSpeed * speedMul;
                    target.y += (input.Ascend ? tuning.flightSpeed : 0f) - (input.Descend ? tuning.flightSpeed : 0f);
                    if (target.sqrMagnitude > tuning.flightSpeed * tuning.flightSpeed * 1.1f)
                        target = target.normalized * tuning.flightSpeed * speedMul;
                    acceleration = tuning.flightAcceleration * surface.AccelerationMultiplier;
                    preserveVertical = true;
                    break;

                case LocomotionContext.Superspeed:
                    target = planarWish * tuning.superspeed * speedMul;
                    acceleration = tuning.groundAcceleration * 1.35f * surface.AccelerationMultiplier;
                    break;

                case LocomotionContext.Grounded:
                    target = GroundTarget(planarWish, environment, tuning, speedMul, input.Sprint);
                    acceleration = tuning.groundAcceleration * surface.AccelerationMultiplier;
                    break;

                default:
                    target = planarWish * (input.Sprint ? tuning.sprintSpeed : tuning.walkSpeed) * speedMul;
                    acceleration = tuning.airAcceleration * surface.AccelerationMultiplier;
                    break;
            }

            if (context == LocomotionContext.Superspeed)
            {
                if (!stamina.TrySpend(tuning.superspeedStaminaPerSecond * dt))
                    target = planarWish * tuning.walkSpeed * speedMul;
            }
            else if (context == LocomotionContext.Grounded && input.Sprint && planarWish.sqrMagnitude > 0.01f)
            {
                stamina.TrySpend(tuning.sprintStaminaPerSecond * dt);
            }
            else if (context == LocomotionContext.Climbing)
            {
                stamina.TrySpend(tuning.climbStaminaPerSecond * dt);
            }

            var braking = !input.HasMove || input.Brake;
            if (braking) acceleration = tuning.groundBraking * surface.BrakingMultiplier;
            var velocity = Accelerate(Velocity, target, acceleration, dt);

            if (context == LocomotionContext.Grounded && allowJump && input.Jump && stamina.TrySpend(tuning.jumpStamina))
                velocity.y = tuning.jumpSpeed;
            else if (preserveVertical)
                velocity.y = Mathf.MoveTowards(velocity.y, target.y, acceleration * dt);
            else if (context == LocomotionContext.Grounded)
                velocity.y = _controller.isGrounded ? -1.5f : velocity.y;
            else
                velocity.y = Mathf.Max(tuning.gravity * dt, velocity.y + tuning.gravity * dt);

            if (context == LocomotionContext.Airborne)
                velocity.y = Mathf.Max(-Mathf.Abs(tuning.maxFallSpeed), velocity.y);

            Velocity = velocity;
            var displacement = Velocity * dt;
            var safeDisplacement = ClipAgainstBlockingGeometry(displacement);
            LastMoveWasClipped = (safeDisplacement - displacement).sqrMagnitude > 0.000001f;
            if (_controller != null && _controller.enabled && _controller.gameObject.activeInHierarchy)
                LastCollisionFlags = _controller.Move(safeDisplacement);
            else
                LastCollisionFlags = CollisionFlags.None;

            velocity = Velocity;
            if ((LastCollisionFlags & CollisionFlags.Above) != 0 && velocity.y > 0f)
                velocity.y = 0f;
            if ((LastCollisionFlags & CollisionFlags.Below) != 0 && velocity.y < 0f)
                velocity.y = -1.5f;
            Velocity = velocity;

            return Velocity;
        }

        static Vector3 GroundTarget(Vector3 planarWish, LocomotionEnvironment environment, LocomotionTuning tuning, float speedMul, bool sprint)
        {
            var normal = environment.GroundNormal.sqrMagnitude > 0.1f ? environment.GroundNormal : Vector3.up;
            var alongSurface = Vector3.ProjectOnPlane(planarWish, normal);
            if (alongSurface.sqrMagnitude > 1f) alongSurface.Normalize();
            var limit = Mathf.Min(tuning.slopeLimit, environment.Surface.SlopeLimit);
            if (environment.SlopeAngle > limit && alongSurface.y > 0.01f)
            {
                alongSurface.y = 0f;
                if (alongSurface.sqrMagnitude > 1f) alongSurface.Normalize();
            }
            return alongSurface * (sprint ? tuning.sprintSpeed : tuning.walkSpeed) * speedMul;
        }

        Vector3 ClipAgainstBlockingGeometry(Vector3 displacement)
        {
            var magnitude = displacement.magnitude;
            if (magnitude <= 0.0001f || !_root) return displacement;
            var direction = displacement / magnitude;
            if (!CapsuleCast(direction, magnitude, out var hit)) return displacement;
            if (IsSelf(hit.collider)) return displacement;

            var safeDistance = Mathf.Max(0f, hit.distance - _skin);
            var first = direction * Mathf.Min(magnitude, safeDistance);
            var remaining = displacement - first;
            var slide = Vector3.ProjectOnPlane(remaining, hit.normal);
            if (slide.sqrMagnitude <= 0.000001f || CapsuleCast(slide.normalized, slide.magnitude, out var slideHit) && !IsSelf(slideHit.collider))
                return first;
            return first + slide;
        }

        bool CapsuleCast(Vector3 direction, float distance, out RaycastHit hit)
        {
            hit = default;
            if (!_controller || distance <= 0.0001f) return false;
            GetCapsule(out var bottom, out var top, out var radius);
            return Physics.CapsuleCast(bottom, top, radius, direction, out hit, distance + _skin,
                _collisionMask, QueryTriggerInteraction.Ignore);
        }

        void GetCapsule(out Vector3 bottom, out Vector3 top, out float radius)
        {
            radius = Mathf.Max(0.01f, _controller.radius - _skin);
            var center = _root.TransformPoint(_controller.center);
            var half = Mathf.Max(radius, _controller.height * 0.5f - radius);
            bottom = center - _root.up * half;
            top = center + _root.up * half;
        }

        bool IsSelf(Collider collider)
        {
            return collider && (collider.transform == _root || collider.transform.IsChildOf(_root));
        }

        static Vector3 Accelerate(Vector3 current, Vector3 target, float rate, float dt)
        {
            var t = 1f - Mathf.Exp(-Mathf.Max(0.01f, rate) * dt);
            return Vector3.Lerp(current, target, t);
        }
    }
}
