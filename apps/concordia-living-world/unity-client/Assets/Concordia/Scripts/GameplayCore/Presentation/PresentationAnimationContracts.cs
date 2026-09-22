using System;
using UnityEngine;
using Concordia.GameplayCore.Movement;

namespace Concordia.GameplayCore.Presentation
{
    /// <summary>Adapter for existing Animator controllers; no controller or clip is required.</summary>
    public sealed class PresentationAnimationBridge : MonoBehaviour
    {
        public Animator animator;
        public bool driveParameters = true;
        public string stateParameter = "PresentationStateHash";
        public string speedParameter = "PresentationSpeed";
        public string groundedParameter = "PresentationGrounded";
        public string slopeParameter = "PresentationSlope";

        void Awake()
        {
            if (!animator) animator = GetComponentInChildren<Animator>();
        }

        public void ApplyLocomotion(LocomotionSnapshot snapshot)
        {
            if (driveParameters && animator)
            {
                SetFloatIfPresent(speedParameter, snapshot.Velocity.magnitude);
                SetBoolIfPresent(groundedParameter, snapshot.Grounded);
                SetFloatIfPresent(slopeParameter, snapshot.SlopeAngle);
                if (!string.IsNullOrEmpty(snapshot.Animation)) SetIntegerIfPresent(stateParameter, Animator.StringToHash(snapshot.Animation));
            }
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Animation, snapshot.Animation, transform.position, snapshot.Velocity, Mathf.Clamp01(snapshot.Velocity.magnitude / 8f), 0.12f, gameObject));
        }

        public void SetReaction(PresentationReactionContract reaction)
        {
            if (animator && animator.runtimeAnimatorController)
            {
                var trigger = "Reaction_" + reaction.Kind;
                for (var i = 0; i < animator.parameters.Length; i++)
                    if (animator.parameters[i].type == AnimatorControllerParameterType.Trigger && animator.parameters[i].name == trigger) animator.SetTrigger(trigger);
            }
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Reaction, reaction.Kind.ToString(), transform.position, reaction.Direction, reaction.Intensity, reaction.Duration, gameObject));
        }

        void SetFloatIfPresent(string parameter, float value)
        {
            if (animator && HasParameter(parameter, AnimatorControllerParameterType.Float)) animator.SetFloat(parameter, value);
        }
        void SetBoolIfPresent(string parameter, bool value)
        {
            if (animator && HasParameter(parameter, AnimatorControllerParameterType.Bool)) animator.SetBool(parameter, value);
        }
        void SetIntegerIfPresent(string parameter, int value)
        {
            if (animator && HasParameter(parameter, AnimatorControllerParameterType.Int)) animator.SetInteger(parameter, value);
        }
        bool HasParameter(string parameter, AnimatorControllerParameterType type)
        {
            if (string.IsNullOrEmpty(parameter) || !animator || !animator.runtimeAnimatorController) return false;
            for (var i = 0; i < animator.parameters.Length; i++)
                if (animator.parameters[i].name == parameter && animator.parameters[i].type == type) return true;
            return false;
        }
    }

    /// <summary>Humanoid IK/grip hook. Existing authored sockets win; absent rigs safely do nothing.</summary>
    public sealed class PresentationIkGripAdapter : MonoBehaviour
    {
        public Animator animator;
        public Transform lookAt;
        public Transform leftGrip;
        public Transform rightGrip;
        [Range(0f, 1f)] public float lookWeight = 0.65f;
        [Range(0f, 1f)] public float gripWeight = 1f;
        public bool resolveGripSockets = true;

        void Awake()
        {
            if (!animator) animator = GetComponentInChildren<Animator>();
            if (resolveGripSockets)
            {
                if (!leftGrip) leftGrip = FindSocket(transform, "CX_Grip_L", "Grip_L", "LeftHand");
                if (!rightGrip) rightGrip = FindSocket(transform, "CX_Grip_R", "Grip_R", "RightHand");
            }
        }

        public void BindLookAt(Transform target) => lookAt = target;
        public void BindGrip(PresentationGripContract grip)
        {
            if (grip.Hand == PresentationGripHand.Left || grip.Hand == PresentationGripHand.Both) leftGrip = grip.Target;
            if (grip.Hand == PresentationGripHand.Right || grip.Hand == PresentationGripHand.Both) rightGrip = grip.Target;
            gripWeight = Mathf.Clamp01(grip.Weight <= 0f ? 1f : grip.Weight);
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Grip, grip.SocketName, transform.position, transform.forward, gripWeight, 0.1f, gameObject));
        }

        void OnAnimatorIK(int layerIndex)
        {
            if (!animator || !animator.isHuman) return;
            if (lookAt)
            {
                animator.SetLookAtPosition(lookAt.position);
                animator.SetLookAtWeight(lookWeight);
            }
            ApplyGrip(AvatarIKGoal.LeftHand, leftGrip);
            ApplyGrip(AvatarIKGoal.RightHand, rightGrip);
        }

        void ApplyGrip(AvatarIKGoal goal, Transform target)
        {
            if (!target) return;
            animator.SetIKPositionWeight(goal, gripWeight);
            animator.SetIKRotationWeight(goal, gripWeight);
            animator.SetIKPosition(goal, target.position);
            animator.SetIKRotation(goal, target.rotation);
        }

        public static Transform FindSocket(Transform root, params string[] names)
        {
            if (!root || names == null) return null;
            var all = root.GetComponentsInChildren<Transform>(true);
            for (var i = 0; i < all.Length; i++)
            {
                var candidate = all[i];
                if (!candidate) continue;
                for (var j = 0; j < names.Length; j++)
                    if (string.Equals(candidate.name, names[j], StringComparison.OrdinalIgnoreCase)) return candidate;
            }
            return null;
        }
    }

    /// <summary>Additive reaction impulse contract for controllers that already own hit resolution.</summary>
    public sealed class PresentationReactionReceiver : MonoBehaviour
    {
        public PresentationAnimationBridge animationBridge;
        public Vector3 LastDirection { get; private set; }
        public float LastIntensity { get; private set; }
        public float LastAt { get; private set; }

        void Awake()
        {
            if (!animationBridge) animationBridge = GetComponent<PresentationAnimationBridge>();
        }

        public void Play(PresentationReactionContract reaction)
        {
            LastDirection = reaction.Direction;
            LastIntensity = Mathf.Max(0f, reaction.Intensity);
            LastAt = Time.unscaledTime;
            if (animationBridge) animationBridge.SetReaction(reaction);
            else PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Reaction, reaction.Kind.ToString(), transform.position, reaction.Direction, reaction.Intensity, reaction.Duration, gameObject));
        }
    }

    /// <summary>Optional camera impulse receiver; it only offsets its own transform and never replaces ChaseCamera.</summary>
    public sealed class PresentationCameraResponse : MonoBehaviour, IPresentationEventSink
    {
        public float positionDecay = 7f;
        public float rotationDecay = 9f;
        Vector3 _positionImpulse;
        Vector3 _rotationImpulse;
        Vector3 _baseLocalPosition;
        Quaternion _baseLocalRotation;
        bool _started;

        void OnEnable()
        {
            _baseLocalPosition = transform.localPosition;
            _baseLocalRotation = transform.localRotation;
            _started = true;
            PresentationEventBus.EventRaised += OnPresentationEvent;
        }
        void OnDisable() => PresentationEventBus.EventRaised -= OnPresentationEvent;
        void LateUpdate()
        {
            if (!_started) return;
            var dt = Mathf.Max(0.0001f, Time.unscaledDeltaTime);
            _positionImpulse = Vector3.Lerp(_positionImpulse, Vector3.zero, 1f - Mathf.Exp(-positionDecay * dt));
            _rotationImpulse = Vector3.Lerp(_rotationImpulse, Vector3.zero, 1f - Mathf.Exp(-rotationDecay * dt));
            transform.localPosition = _baseLocalPosition + _positionImpulse;
            transform.localRotation = _baseLocalRotation * Quaternion.Euler(_rotationImpulse);
        }
        public void AddImpulse(PresentationCameraContract camera)
        {
            _positionImpulse += camera.PositionOffset * Mathf.Max(0f, camera.Intensity);
            _rotationImpulse += camera.EulerOffset * Mathf.Max(0f, camera.Intensity);
        }
        public void OnPresentationEvent(PresentationEvent presentationEvent)
        {
            if (presentationEvent.Type != PresentationEventType.Camera) return;
            AddImpulse(new PresentationCameraContract { Key = presentationEvent.Key, PositionOffset = presentationEvent.Direction * 0.02f, EulerOffset = Vector3.one * presentationEvent.Intensity, Intensity = 1f, Duration = presentationEvent.Duration });
        }
    }

    /// <summary>Routes event contracts into already-authored local ParticleSystem/AudioSource components.</summary>
    public sealed class PresentationVfxAudioRouter : MonoBehaviour, IPresentationEventSink
    {
        public ParticleSystem particles;
        public AudioSource audioSource;
        public AudioClip defaultClip;
        public bool routeContact = true;
        public bool routeActivity = false;

        void Awake()
        {
            if (!particles) particles = GetComponentInChildren<ParticleSystem>();
            if (!audioSource) audioSource = GetComponent<AudioSource>();
        }
        void OnEnable() => PresentationEventBus.EventRaised += OnPresentationEvent;
        void OnDisable() => PresentationEventBus.EventRaised -= OnPresentationEvent;

        public void OnPresentationEvent(PresentationEvent presentationEvent)
        {
            if ((presentationEvent.Type == PresentationEventType.Contact || presentationEvent.Type == PresentationEventType.Intersection) && !routeContact) return;
            if (presentationEvent.Type == PresentationEventType.Activity && !routeActivity) return;
            if (presentationEvent.Type == PresentationEventType.Vfx || presentationEvent.Type == PresentationEventType.Contact || presentationEvent.Type == PresentationEventType.Intersection || presentationEvent.Type == PresentationEventType.Activity)
            {
                if (particles)
                {
                    particles.transform.position = presentationEvent.Position;
                    particles.Emit(Mathf.Clamp(2 + Mathf.RoundToInt(presentationEvent.Intensity * 6f), 1, 18));
                }
            }
            if (presentationEvent.Type == PresentationEventType.Audio && audioSource && defaultClip)
                audioSource.PlayOneShot(defaultClip, Mathf.Clamp01(presentationEvent.Intensity));
        }
    }

    public static class PresentationEventContracts
    {
        public static void Animation(PresentationAnimationContract contract, GameObject source = null)
        {
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Animation, contract.State, source ? source.transform.position : Vector3.zero, contract.Velocity, contract.Weight, 0.1f, source));
        }
        public static void Grip(PresentationGripContract contract, GameObject source = null)
        {
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Grip, contract.SocketName, contract.Target ? contract.Target.position : source ? source.transform.position : Vector3.zero, Vector3.up, contract.Weight, 0.1f, source));
        }
        public static void Reaction(PresentationReactionContract contract, GameObject source = null)
        {
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Reaction, contract.Kind.ToString(), source ? source.transform.position : Vector3.zero, contract.Direction, contract.Intensity, contract.Duration, source));
        }
        public static void Camera(PresentationCameraContract contract, GameObject source = null)
        {
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Camera, contract.Key, source ? source.transform.position : Vector3.zero, contract.EulerOffset, contract.Intensity, contract.Duration, source));
        }
        public static void Vfx(PresentationVfxContract contract, GameObject source = null)
        {
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Vfx, contract.Key, contract.Position, contract.Direction, contract.Intensity, 0.4f, source));
        }
        public static void Audio(PresentationAudioContract contract, GameObject source = null)
        {
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Audio, contract.Key, contract.Position, Vector3.up, contract.Volume, 0.2f, source));
        }
    }
}
