using System;
using UnityEngine;
using Concordia.GameplayCore.Movement;

namespace Concordia.GameplayCore
{
    /// <summary>Additive presentation director; it consumes existing player and camera state.</summary>
    public sealed class ConcordiaPresentationDirector : MonoBehaviour, ILocomotionAnimationSink
    {
        [Serializable] class WorldPresentation
        {
            public string world;
            public float cameraDistance = 3.4f;
            public float cameraHeight = 1.55f;
            public float shoulder = 0.62f;
            public string animationContext;
            public string vfxKey;
            public string audioHook;
        }
        [Serializable] class Manifest { public int version = 1; public WorldPresentation[] worlds; }

        public ConcordiaPresentationFeedback Feedback { get; private set; }
        public LocomotionSnapshot LastSnapshot { get; private set; }
        public string LastToast { get; private set; }
        GameplayCoreBridge _bridge;
        ConcordiaPlayer _player;
        ChaseCamera _camera;
        Manifest _manifest;
        WorldId _lastWorld;

        public void Bind(GameplayCoreBridge bridge, ConcordiaPlayer player, ChaseCamera camera)
        {
            _bridge = bridge;
            _player = player;
            _camera = camera;
            _manifest = LoadManifest();
            Feedback = GetComponent<ConcordiaPresentationFeedback>() ?? gameObject.AddComponent<ConcordiaPresentationFeedback>();
            if (_player != null)
            {
                _player.onToast -= HandleToast;
                _player.onToast += HandleToast;
            }
            _lastWorld = _player ? _player.world : WorldId.Hub;
            ApplyWorld(_lastWorld);
            EnsureActorLods();
        }

        public void ApplySnapshot(LocomotionSnapshot snapshot, LocomotionTransition transition)
        {
            LastSnapshot = snapshot;
            Apply(snapshot);
            if (transition.Changed) Feedback?.Pulse(transition.To.ToString());
            if (_player && _lastWorld != _player.world)
            {
                _lastWorld = _player.world;
                ApplyWorld(_lastWorld);
                EnsureActorLods();
            }
        }

        public void Apply(LocomotionSnapshot snapshot)
        {
            if (_bridge != null && _bridge.LocomotionBindings != null)
                _bridge.LocomotionBindings.ApplyAnimation(snapshot);
        }

        void ApplyWorld(WorldId world)
        {
            if (!_camera || _manifest == null || _manifest.worlds == null) return;
            for (var i = 0; i < _manifest.worlds.Length; i++)
            {
                var item = _manifest.worlds[i];
                if (item == null || !string.Equals(item.world, world.ToString(), StringComparison.OrdinalIgnoreCase)) continue;
                _camera.height = item.cameraHeight;
                _camera.shoulder = item.shoulder;
                _camera.pitch = Mathf.Clamp(_camera.pitch, -0.35f, 0.45f);
                return;
            }
        }

        void HandleToast(string toast)
        {
            LastToast = toast;
            Feedback?.Pulse(toast);
        }

        void EnsureActorLods()
        {
            var actors = FindObjectsByType<ModularPerson>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (var i = 0; i < actors.Length; i++)
            {
                var actor = actors[i];
                if (!actor || actor.transform.IsChildOf(transform) || actor.transform == _player?.transform) continue;
                var lod = actor.GetComponent<LODGroup>();
                if (!lod) continue;
                var renderers = actor.GetComponentsInChildren<Renderer>(true);
                if (renderers.Length == 0) continue;
                lod.SetLODs(new[]
                {
                    new LOD(0.55f, renderers),
                    new LOD(0.12f, Array.Empty<Renderer>())
                });
                lod.RecalculateBounds();
            }
        }

        static Manifest LoadManifest()
        {
            var asset = Resources.Load<TextAsset>("Concordia/Presentation/concordia_presentation_manifest");
            if (!asset) return new Manifest { worlds = Array.Empty<WorldPresentation>() };
            try { return JsonUtility.FromJson<Manifest>(asset.text) ?? new Manifest { worlds = Array.Empty<WorldPresentation>() }; }
            catch (Exception e) { Debug.LogWarning("[Concordia] Presentation manifest failed: " + e.Message); return new Manifest { worlds = Array.Empty<WorldPresentation>() }; }
        }
    }
}
