using UnityEngine;

namespace Concordia.Vehicles
{
    /// <summary>
    /// Selectable collision-aware ground motor. Rigidbody mode deliberately defers to
    /// VehicleEntity and its configured IVehiclePhysicsModel. CharacterController mode
    /// is an adapter for controller-based mounts and keeps the same VehicleEntity state.
    /// </summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(VehicleEntity))]
    public sealed class VehicleGroundMovement : MonoBehaviour
    {
        [SerializeField] VehicleMovementBackend backend = VehicleMovementBackend.Auto;
        [SerializeField] LayerMask collisionMask = ~0;
        [SerializeField] float acceleration = 12f;
        [SerializeField] float braking = 18f;
        [SerializeField] float gravity = -25f;
        [SerializeField] float turnRate = 90f;

        VehicleEntity entity;
        Rigidbody body;
        CharacterController controller;
        VehicleInput pendingInput;
        Vector3 velocity;
        bool configured;

        public VehicleMovementBackend ActiveBackend { get; private set; } = VehicleMovementBackend.Rigidbody;
        public bool UsesCharacterController => ActiveBackend == VehicleMovementBackend.CharacterController && controller != null;
        public VehicleInput PendingInput => pendingInput;

        void Awake()
        {
            entity = GetComponent<VehicleEntity>();
            body = GetComponent<Rigidbody>();
            controller = GetComponent<CharacterController>();
            Configure(backend);
        }

        public void Configure(VehicleMovementBackend requested)
        {
            backend = requested;
            if (entity == null) entity = GetComponent<VehicleEntity>();
            if (body == null) body = GetComponent<Rigidbody>();
            if (controller == null) controller = GetComponent<CharacterController>();

            if (requested == VehicleMovementBackend.CharacterController && controller != null)
                ActiveBackend = VehicleMovementBackend.CharacterController;
            else if (requested == VehicleMovementBackend.Rigidbody && body != null)
                ActiveBackend = VehicleMovementBackend.Rigidbody;
            else if (requested == VehicleMovementBackend.Auto && controller != null)
                ActiveBackend = VehicleMovementBackend.CharacterController;
            else
                ActiveBackend = VehicleMovementBackend.Rigidbody;

            if (ActiveBackend == VehicleMovementBackend.CharacterController && body != null)
            {
                body.isKinematic = true;
                body.useGravity = false;
                body.linearVelocity = Vector3.zero;
                body.angularVelocity = Vector3.zero;
            }
            configured = true;
        }

        public void SubmitInput(VehicleInput input)
        {
            pendingInput = input.Clamped();
            if (!UsesCharacterController && entity != null) entity.SetInput(pendingInput);
        }

        void FixedUpdate()
        {
            if (!configured || !UsesCharacterController || entity == null || entity.IsDestroyed) return;
            var input = pendingInput;
            if (entity.Autopilot && input.Throttle == 0f && input.Steering == 0f)
                input = entity.BuildAIInput(Time.fixedDeltaTime);

            var dt = Time.fixedDeltaTime;
            var forward = transform.forward;
            var target = forward * (input.Throttle * entity.MaxSpeed);
            var planar = new Vector3(velocity.x, 0f, velocity.z);
            var rate = input.Brake > 0.01f || Mathf.Abs(input.Throttle) < 0.01f ? braking : acceleration;
            planar = Vector3.MoveTowards(planar, new Vector3(target.x, 0f, target.z), rate * dt);
            velocity.x = planar.x;
            velocity.z = planar.z;
            if (controller.isGrounded && velocity.y < 0f) velocity.y = -1.5f;
            else velocity.y = Mathf.Max(velocity.y + gravity * dt, gravity);

            transform.Rotate(0f, input.Steering * turnRate * dt, 0f, Space.Self);
            CollisionFlags flags = CollisionFlags.None;
            if (controller != null && controller.enabled && controller.gameObject.activeInHierarchy)
                flags = controller.Move(velocity * dt);
            if ((flags & CollisionFlags.Above) != 0 && velocity.y > 0f) velocity.y = 0f;
            if ((flags & CollisionFlags.Below) != 0 && velocity.y < 0f) velocity.y = -1.5f;
            entity.ApplyMotion(new VehicleMotionState { Velocity = velocity, AngularVelocity = Vector3.zero });
            pendingInput = VehicleInput.Neutral;
        }

        void OnDisable()
        {
            pendingInput = VehicleInput.Neutral;
            velocity = Vector3.zero;
        }
    }
}
