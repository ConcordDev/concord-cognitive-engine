using UnityEngine;
using Unity.Cinemachine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Concordia
{
    /// <summary>
    /// Third-person orbit. Body is Cinemachine Orbital Follow (Asset Store / UPM 3.1.6).
    /// PlanarForward stays on our yaw so WASD does not depend on camera.forward.
    /// </summary>
    [DefaultExecutionOrder(40)]
    public class ChaseCamera : MonoBehaviour
    {
        public Transform target;
        public float distance = 3.4f;
        public float height = 1.55f;
        public float shoulder = 0.62f;
        public float yaw, pitch = 0.22f;
        public bool sprinting;
        public bool inCombat;
        public bool creatorFraming;
        public int pov = 0;
        static readonly float[] PovDist = { 3.2f, 4.6f, 6.8f };
        static readonly float[] PovFov = { 50f, 48f, 44f };
        bool _snapped;
        CinemachineCamera _vcam;
        CinemachineOrbitalFollow _orbit;
        CinemachineHardLookAt _look;
        Camera _cam;

        public Vector3 PlanarForward => new Vector3(-Mathf.Sin(yaw), 0, -Mathf.Cos(yaw));
        public Vector3 PlanarRight => new Vector3(-Mathf.Cos(yaw), 0, Mathf.Sin(yaw));

        void Start() => Bind();

        public void Bind()
        {
            if (_vcam && _orbit) return;
            _cam = GetComponent<Camera>();
            if (!_cam) _cam = Camera.main;
            if (!_cam) return;

            var brain = _cam.GetComponent<CinemachineBrain>();
            if (!brain) brain = _cam.gameObject.AddComponent<CinemachineBrain>();
            brain.UpdateMethod = CinemachineBrain.UpdateMethods.LateUpdate;
            brain.BlendUpdateMethod = CinemachineBrain.BrainUpdateMethods.LateUpdate;
            brain.DefaultBlend = new CinemachineBlendDefinition(CinemachineBlendDefinition.Styles.Cut, 0f);

            var hold = transform.Find("OrbitVCam");
            var vgo = hold ? hold.gameObject : new GameObject("OrbitVCam");
            if (!hold)
            {
                vgo.transform.SetParent(transform, false);
                vgo.transform.localPosition = Vector3.zero;
            }
            _vcam = vgo.GetComponent<CinemachineCamera>() ?? vgo.AddComponent<CinemachineCamera>();
            _vcam.Priority = 20;
            _orbit = vgo.GetComponent<CinemachineOrbitalFollow>() ?? vgo.AddComponent<CinemachineOrbitalFollow>();
            _orbit.OrbitStyle = CinemachineOrbitalFollow.OrbitStyles.Sphere;
            _orbit.Radius = 3.4f;
            _orbit.TargetOffset = new Vector3(0.18f, 1.48f, 0f);
            var track = _orbit.TrackerSettings;
            track.BindingMode = Unity.Cinemachine.TargetTracking.BindingMode.WorldSpace;
            track.PositionDamping = new Vector3(0.12f, 0.18f, 0.12f);
            _orbit.TrackerSettings = track;

            _look = vgo.GetComponent<CinemachineHardLookAt>() ?? vgo.AddComponent<CinemachineHardLookAt>();
            _look.LookAtOffset = new Vector3(0.12f, 1.48f, 0f);
            // No Deoccluder: plaza/ground colliders are 40m+ discs and would yank the camera.

            AimAt(target);
        }

        public void AimAt(Transform t)
        {
            target = t;
            if (!_vcam || !t) return;
            _vcam.Target.TrackingTarget = t;
            _vcam.Target.LookAtTarget = t;
            _vcam.Target.CustomLookAtTarget = false;
        }

        void LateUpdate()
        {
            if (!target) return;
            if (!_vcam) Bind();
            if (_cam)
            {
                _cam.nearClipPlane = 0.18f;
                _cam.farClipPlane = 220f;
                _cam.clearFlags = CameraClearFlags.Skybox;
            }

            var feetY = Mathf.Clamp(target.position.y, 0f, 3.5f);
            var focus = new Vector3(target.position.x, feetY + 1.35f, target.position.z);
            var fov = creatorFraming ? 52f : (sprinting ? PovFov[pov] + 6f : inCombat ? PovFov[pov] - 3f : PovFov[pov]);

            if (creatorFraming)
            {
                if (_vcam) _vcam.enabled = false;
                var want = focus + new Vector3(0.55f, 1.55f, -8.2f);
                DriveTransform(want, focus + Vector3.up * 0.22f, feetY, 52f);
                return;
            }

            ReadZoomAndPov();
            var dist = PovDist[Mathf.Clamp(pov, 0, 2)];
            if (sprinting) dist += 0.7f;
            if (inCombat) dist -= 0.6f;
            dist = Mathf.Clamp(dist + (distance - 6.2f), 2.4f, 14f);

            if (_vcam && _orbit)
            {
                _vcam.enabled = true;
                AimAt(target);
                _orbit.Radius = dist;
                var h = _orbit.HorizontalAxis;
                h.Value = 180f - yaw * Mathf.Rad2Deg;
                h.Range = new Vector2(-180f, 180f);
                h.Wrap = true;
                var rec = h.Recentering;
                rec.Enabled = false;
                h.Recentering = rec;
                _orbit.HorizontalAxis = h;

                var v = _orbit.VerticalAxis;
                v.Value = pitch * Mathf.Rad2Deg;
                v.Range = new Vector2(-26f, 40f);
                v.Wrap = false;
                var recV = v.Recentering;
                recV.Enabled = false;
                v.Recentering = recV;
                _orbit.VerticalAxis = v;

                var rad = _orbit.RadialAxis;
                rad.Value = 1f;
                var recR = rad.Recentering;
                recR.Enabled = false;
                rad.Recentering = recR;
                _orbit.RadialAxis = rad;

                var lens = _vcam.Lens;
                lens.FieldOfView = fov;
                lens.NearClipPlane = 0.18f;
                lens.FarClipPlane = 220f;
                _vcam.Lens = lens;
                return;
            }

            var fwd = PlanarForward;
            var right = PlanarRight;
            var wantFree = focus - fwd * dist + right * shoulder + Vector3.up * (height - 1.35f + pitch * 2.1f);
            wantFree = Collide(focus, wantFree);
            DriveTransform(wantFree, focus, feetY, fov);
        }

        void DriveTransform(Vector3 want, Vector3 focus, float feetY, float fov)
        {
            if (want.y < feetY + 1.55f) want.y = feetY + 1.55f;
            if (!_snapped)
            {
                transform.position = want;
                _snapped = true;
            }
            else
                transform.position = Vector3.Lerp(transform.position, want, 1f - Mathf.Exp(-10f * Time.deltaTime));

            if (transform.position.y < feetY + 1.25f)
            {
                var p = transform.position;
                p.y = feetY + 1.35f;
                transform.position = p;
            }
            var look = Quaternion.LookRotation((focus - transform.position).normalized, Vector3.up);
            transform.rotation = Quaternion.Slerp(transform.rotation, look, 1f - Mathf.Exp(-14f * Time.deltaTime));
            if (_cam)
                _cam.fieldOfView = Mathf.Lerp(_cam.fieldOfView <= 1f ? fov : _cam.fieldOfView, fov, Time.deltaTime * 7f);
        }

        public void Look(Vector2 delta)
        {
            yaw += delta.x * 0.0022f;
            pitch = Mathf.Clamp(pitch - delta.y * 0.0018f, -0.45f, 0.62f);
        }

        void ReadZoomAndPov()
        {
#if ENABLE_INPUT_SYSTEM
            if (Mouse.current != null)
            {
                var scroll = Mouse.current.scroll.ReadValue().y;
                if (Mathf.Abs(scroll) > 0.01f) distance = Mathf.Clamp(distance - scroll * 0.004f, 2.2f, 12f);
            }
            if (Keyboard.current != null && Keyboard.current.vKey.wasPressedThisFrame)
                pov = (pov + 1) % 3;
#else
            distance = Mathf.Clamp(distance - Input.GetAxis("Mouse ScrollWheel") * 4f, 2.2f, 12f);
            if (Input.GetKeyDown(KeyCode.V)) pov = (pov + 1) % 3;
#endif
        }

        Vector3 Collide(Vector3 from, Vector3 to)
        {
            var delta = to - from;
            var mag = delta.magnitude;
            if (mag < 0.2f) return to;
            var dir = delta / mag;
            var hits = Physics.SphereCastAll(from, 0.22f, dir, mag, ~0, QueryTriggerInteraction.Ignore);
            var best = mag;
            foreach (var h in hits)
            {
                if (!h.collider) continue;
                if (target && h.transform.IsChildOf(target)) continue;
                if (h.collider is CharacterController) continue;
                var sz = h.collider.bounds.size;
                if (sz.x > 18f || sz.z > 18f) continue;
                if (sz.y > 10f) continue;
                if (h.distance < best) best = h.distance;
            }
            return from + dir * Mathf.Max(1.7f, best - 0.28f);
        }
    }
}
