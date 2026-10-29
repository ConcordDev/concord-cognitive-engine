using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// F-04 — turning and start/stop polish. TODO_anim_turn.
    ///
    /// There are no turn clips in UAL1 (or any pack in this project): every
    /// locomotion loop is a straight-ahead cycle, so the root yaw authored by
    /// <see cref="ConcordiaPlayer"/> at 7.2–12 rad/s snaps the whole body
    /// around in two or three frames and the feet visibly skate through the
    /// arc. This adds the missing read procedurally, on top of whatever pose
    /// the Animator wrote this frame — the same LateUpdate-overlay pattern
    /// <see cref="ModularPerson"/> already uses for its dodge / strike / idle
    /// overlays, and it runs after them ([DefaultExecutionOrder] 200 vs 0) so
    /// the two compose instead of fighting.
    ///
    /// The lag is driven by the root's yaw *velocity*, not by an accumulated
    /// per-frame delta, so the trail is the same shape at 16 fps and 60 fps.
    /// Turning left rotates the shoulders back to the right by up to
    /// <see cref="turnMaxLag"/> degrees and they catch up over
    /// <see cref="turnRecover"/> seconds once the turn stops — which is what
    /// sells a pivot without a single turn keyframe.
    ///
    /// The decel half of F-04 is already in the gait feed:
    /// <c>ModularPerson.SetGait</c> pushes <c>Speed</c> through
    /// <c>Animator.SetFloat(name, value, 0.12f, dt)</c>, so stopping eases the
    /// blend tree down over ~0.12 s instead of snapping to Idle. That was
    /// verified live for F-04 rather than duplicated here.
    ///
    /// Bone lookup mirrors <c>ModularPerson.FindBone</c>'s alias tables
    /// (Bip01 / Mixamo / Quaternius) rather than reaching into private fields.
    /// </summary>
    [DefaultExecutionOrder(200)]
    public sealed class LocomotionPolish : MonoBehaviour
    {
        /// <summary>Upper-body yaw lag on turns. Off reproduces the pre-F-04 read.</summary>
        public bool turnLag = true;

        /// <summary>Seconds of root yaw velocity the shoulders trail by.</summary>
        public float turnTrail = 0.055f;

        /// <summary>Hard cap on the shoulder trail, in degrees.</summary>
        public float turnMaxLag = 38f;

        /// <summary>Time constant, in seconds, for the shoulders to catch up.</summary>
        public float turnRecover = 0.09f;

        /// <summary>Share of the lag carried by the spine; the chest carries the rest.</summary>
        [Range(0f, 1f)] public float spineShare = 0.4f;

        Transform _spine;
        Transform _chest;
        float _lastYaw;
        float _lag;
        float _rescanAt;
        int _binds;

        /// <summary>Attach to every person once, at runtime, without editing ModularPerson.</summary>
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install()
        {
            var watch = new GameObject("LocomotionPolish");
            DontDestroyOnLoad(watch);
            watch.AddComponent<LocomotionPolish>();
        }

        void Bind()
        {
            var body = transform.Find("AuthoredPerson");
            if (!body) body = transform;

            _spine = FindBone(body, "Bip01 Spine", "Spine", "mixamorig:Spine", "Abdomen");
            _chest = FindBone(body, "Bip01 Spine2", "Bip01 Spine1", "Chest", "UpperChest",
                              "Spine1", "mixamorig:Spine1", "Torso");
            if (!_chest) _chest = _spine;

            if (_chest || _spine) _lastYaw = transform.rotation.eulerAngles.y;
        }

        /// <summary>A rebuild (travel, a recast) destroys the bones this bound to.</summary>
        void OnBodyRebuilt()
        {
            _spine = null;
            _chest = null;
            _rescanAt = 0f;
            _binds = 0;
        }

        void LateUpdate()
        {
            if (!_chest && !_spine)
            {
                if (Time.unscaledTime < _rescanAt) return;
                _rescanAt = Time.unscaledTime + 1f;

                // The shared watcher has no body of its own; it hands the
                // component to every person that is missing one.
                if (transform.name == "LocomotionPolish")
                {
                    Sweep();
                    return;
                }

                // Painted mini-characters have no rig at all. Stop looking
                // rather than walking their hierarchy once a second forever.
                if (_binds++ > 20) { enabled = false; return; }

                Bind();
                return;
            }

            float dt = Time.deltaTime;
            if (dt <= 1e-5f) return;

            float yaw = transform.rotation.eulerAngles.y;
            float angVel = Mathf.DeltaAngle(_lastYaw, yaw) / dt;
            _lastYaw = yaw;

            float target = turnLag
                ? Mathf.Clamp(-angVel * turnTrail, -turnMaxLag, turnMaxLag)
                : 0f;
            _lag = Mathf.Lerp(_lag, target, 1f - Mathf.Exp(-dt / Mathf.Max(0.02f, turnRecover)));
            if (Mathf.Abs(_lag) < 0.05f) return;

            if (_spine && _chest && _spine != _chest)
            {
                _spine.localRotation *= Quaternion.Euler(0f, _lag * spineShare, 0f);
                _chest.localRotation *= Quaternion.Euler(0f, _lag * (1f - spineShare), 0f);
            }
            else
            {
                _chest.localRotation *= Quaternion.Euler(0f, _lag, 0f);
            }
        }

        /// <summary>Give the component to every person that is still missing one.</summary>
        void Sweep()
        {
            var people = Object.FindObjectsByType<ModularPerson>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            int added = 0;
            for (int i = 0; i < people.Length; i++)
            {
                if (!people[i]) continue;
                if (people[i].GetComponent<LocomotionPolish>()) continue;
                people[i].gameObject.AddComponent<LocomotionPolish>();
                added++;
            }
            if (added > 0)
                Debug.Log("[LocomotionPolish] turn lag attached to " + added + " person(s)");
        }

        static Transform FindBone(Transform root, params string[] names)
        {
            var all = root.GetComponentsInChildren<Transform>(true);
            for (int n = 0; n < names.Length; n++)
                for (int i = 0; i < all.Length; i++)
                    if (string.Equals(all[i].name, names[n], System.StringComparison.Ordinal))
                        return all[i];
            return null;
        }
    }
}
