using UnityEngine;

namespace Concordia.Vehicles
{
    public class VehiclePhysicsModelBase : MonoBehaviour, IVehiclePhysicsModel
    {
        [SerializeField] protected float acceleration = 8f;
        [SerializeField] protected float braking = 12f;
        [SerializeField] protected float steeringRate = 2.2f;
        public virtual VehicleKind SupportedKind => VehicleKind.Car;

        public virtual void Simulate(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime)
        {
            Vector3 forward = rigidbody.transform.forward;
            float target = input.Throttle * body.MaxSpeed;
            Vector3 velocity = rigidbody.linearVelocity;
            Vector3 planar = Vector3.MoveTowards(new Vector3(velocity.x, 0f, velocity.z), forward * target, acceleration * deltaTime);
            rigidbody.linearVelocity = new Vector3(planar.x, velocity.y, planar.z);
            rigidbody.angularVelocity = Vector3.zero;
        }

        protected void ApplyPlanarDrive(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime, float driveScale, float turnScale)
        {
            float speed = new Vector3(rigidbody.linearVelocity.x, 0f, rigidbody.linearVelocity.z).magnitude;
            float desired = input.Throttle * body.MaxSpeed * driveScale;
            Vector3 desiredVelocity = rigidbody.transform.forward * desired;
            Vector3 planar = new Vector3(rigidbody.linearVelocity.x, 0f, rigidbody.linearVelocity.z);
            float rate = input.Brake > 0.1f ? braking : acceleration;
            planar = Vector3.MoveTowards(planar, desiredVelocity, rate * deltaTime);
            rigidbody.linearVelocity = new Vector3(planar.x, rigidbody.linearVelocity.y, planar.z);
            float steering = input.Steering * turnScale * Mathf.Clamp01(speed / Mathf.Max(1f, body.MaxSpeed));
            rigidbody.MoveRotation(rigidbody.rotation * Quaternion.Euler(0f, steering * deltaTime * 60f, 0f));
        }
    }

    public sealed class CreatureMountPhysicsModel : VehiclePhysicsModelBase
    {
        [SerializeField] float jumpImpulse = 5.5f;
        public override VehicleKind SupportedKind => VehicleKind.CreatureMount;

        public override void Simulate(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime)
        {
            ApplyPlanarDrive(body, rigidbody, input, deltaTime, 0.85f, 1.6f);
            if (input.Jump && Mathf.Abs(rigidbody.linearVelocity.y) < 0.2f) rigidbody.AddForce(Vector3.up * jumpImpulse, ForceMode.VelocityChange);
            rigidbody.linearDamping = 0.15f;
            rigidbody.angularDamping = 4f;
        }
    }

    public sealed class GroundVehiclePhysicsModel : VehiclePhysicsModelBase
    {
        [SerializeField] float traction = 1.2f;
        public override VehicleKind SupportedKind => VehicleKind.Car;

        public override void Simulate(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime)
        {
            float scale = 1f;
            VehicleEntity entity = body as VehicleEntity;
            if (entity && entity.Kind == VehicleKind.Truck) scale = 0.72f;
            if (entity && entity.Kind == VehicleKind.Bike) scale = 1.08f;
            ApplyPlanarDrive(body, rigidbody, input, deltaTime, scale, steeringRate * traction);
            rigidbody.linearDamping = input.Brake > 0.1f ? 1.8f : 0.35f;
            rigidbody.angularDamping = 5f;
        }
    }

    public sealed class WatercraftPhysicsModel : VehiclePhysicsModelBase
    {
        [SerializeField] float waterLevel;
        [SerializeField] float buoyancy = 16f;
        [SerializeField] float waterDrag = 1.4f;
        public override VehicleKind SupportedKind => VehicleKind.Boat;

        public override void Simulate(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime)
        {
            float submerged = Mathf.Clamp01((waterLevel + 0.75f - rigidbody.position.y) / 1.5f);
            if (submerged > 0f) rigidbody.AddForce(Vector3.up * buoyancy * submerged, ForceMode.Acceleration);
            Vector3 forward = rigidbody.transform.forward;
            Vector3 velocity = rigidbody.linearVelocity;
            Vector3 horizontal = new Vector3(velocity.x, 0f, velocity.z);
            horizontal = Vector3.MoveTowards(horizontal, forward * (input.Throttle * body.MaxSpeed), acceleration * deltaTime);
            horizontal *= Mathf.Clamp01(1f - waterDrag * submerged * deltaTime);
            rigidbody.linearVelocity = new Vector3(horizontal.x, velocity.y, horizontal.z);
            rigidbody.MoveRotation(rigidbody.rotation * Quaternion.Euler(0f, input.Steering * steeringRate * deltaTime * 50f, 0f));
            rigidbody.linearDamping = 0.4f + submerged * 1.6f;
            rigidbody.angularDamping = 3f;
        }
    }

    public sealed class AircraftPhysicsModel : VehiclePhysicsModelBase
    {
        [SerializeField] float lift = 14f;
        [SerializeField] float airDrag = 0.08f;
        public override VehicleKind SupportedKind => VehicleKind.Aircraft;

        public override void Simulate(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime)
        {
            float throttle = input.Throttle * body.MaxSpeed;
            Vector3 desired = rigidbody.transform.forward * throttle;
            rigidbody.linearVelocity = Vector3.MoveTowards(rigidbody.linearVelocity, desired, acceleration * deltaTime);
            rigidbody.AddForce(Vector3.up * Mathf.Max(0f, rigidbody.linearVelocity.magnitude) * lift, ForceMode.Acceleration);
            rigidbody.AddTorque(new Vector3(input.Pitch, input.Yaw, -input.Roll) * steeringRate, ForceMode.Acceleration);
            rigidbody.linearVelocity *= 1f - airDrag * deltaTime;
            rigidbody.angularVelocity *= 1f - 2f * deltaTime;
        }
    }

    public sealed class SciFiVehiclePhysicsModel : VehiclePhysicsModelBase
    {
        [SerializeField] float hoverHeight = 2f;
        [SerializeField] float hoverStrength = 18f;
        [SerializeField] float boostMultiplier = 1.8f;
        public override VehicleKind SupportedKind => VehicleKind.SciFi;

        public override void Simulate(IVehicleBody body, Rigidbody rigidbody, VehicleInput input, float deltaTime)
        {
            float hoverError = hoverHeight - rigidbody.position.y;
            rigidbody.AddForce(Vector3.up * hoverError * hoverStrength, ForceMode.Acceleration);
            float multiplier = input.Boost ? boostMultiplier : 1f;
            Vector3 desired = rigidbody.transform.forward * (input.Throttle * body.MaxSpeed * multiplier);
            Vector3 planar = new Vector3(rigidbody.linearVelocity.x, 0f, rigidbody.linearVelocity.z);
            planar = Vector3.MoveTowards(planar, desired, acceleration * multiplier * deltaTime);
            rigidbody.linearVelocity = new Vector3(planar.x, rigidbody.linearVelocity.y, planar.z);
            rigidbody.MoveRotation(rigidbody.rotation * Quaternion.Euler(0f, input.Steering * steeringRate * deltaTime * 60f, 0f));
            rigidbody.linearDamping = 0.8f;
            rigidbody.angularDamping = 6f;
        }
    }
}
