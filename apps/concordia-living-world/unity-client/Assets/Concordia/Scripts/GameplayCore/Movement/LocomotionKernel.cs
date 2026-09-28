using UnityEngine;

namespace Concordia.GameplayCore.Movement
{
    /// <summary>
    /// Runtime locomotion authority for a Concordia character. Input is supplied by the
    /// owning actor, while state selection, stamina spending, collision-aware movement,
    /// and the published snapshot remain in the gameplay-core movement package.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LocomotionKernel : MonoBehaviour
    {
        public LocomotionCharacterMotor Motor { get; private set; }
        public LocomotionStateMachine State { get; } = new LocomotionStateMachine();
        public LocomotionSnapshot Snapshot { get; private set; }

        CharacterController _controller;
        bool _bound;

        public void Bind(CharacterController controller, LayerMask collisionMask, float skin)
        {
            if (!controller) return;
            if (_bound && _controller == controller) return;

            _controller = controller;
            Motor = new LocomotionCharacterMotor(controller, collisionMask, skin);
            State.Reset(controller.isGrounded);
            Snapshot = default(LocomotionSnapshot);
            _bound = true;
        }

        public void ResetVelocity(Vector3 velocity)
        {
            Motor?.ResetVelocity(velocity);
        }

        public void AddVelocity(Vector3 impulse)
        {
            if (Motor == null) return;
            Motor.ResetVelocity(Motor.Velocity + impulse);
        }

        public LocomotionSnapshot Step(
            LocomotionInput input,
            LocomotionEnvironment environment,
            Vector3 worldWish,
            LocomotionTuning tuning,
            ref float stamina,
            float bodySpeedMultiplier,
            bool canClimb,
            float dt)
        {
            if (!_bound || Motor == null || !_controller || dt <= 0f)
                return Snapshot;

            var transition = State.Evaluate(input, environment, tuning, stamina, canClimb);
            var staminaState = new LocomotionStamina
            {
                Current = Mathf.Max(0f, stamina),
                Maximum = 100f
            };

            Motor.Step(
                State.Current,
                input,
                environment,
                worldWish,
                tuning,
                ref staminaState,
                bodySpeedMultiplier,
                true,
                dt);

            stamina = Mathf.Clamp(staminaState.Current, 0f, staminaState.Maximum);
            var velocity = Motor.Velocity;
            Snapshot = new LocomotionSnapshot
            {
                Context = State.Current,
                Animation = LocomotionAnimationSelector.Select(State.Current, velocity, _controller.isGrounded),
                Position = transform.position,
                Velocity = velocity,
                GroundNormal = environment.GroundNormal,
                SlopeAngle = environment.SlopeAngle,
                Stamina = stamina,
                Grounded = _controller.isGrounded,
                WallContact = (_controller.collisionFlags & CollisionFlags.Sides) != 0,
                SurfaceId = environment.Surface.Sanitized().Id
            };
            return Snapshot;
        }
    }
}
