using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Idle atmosphere owned by HubLook. Ground mist + motes + cloth sway so a
    /// standing Court still moves. Not volumetric fog. LeanPlay thins count.
    /// </summary>
    [DefaultExecutionOrder(20)]
    public class WorldBreath : MonoBehaviour
    {
        public static WorldBreath Live { get; private set; }

        WorldId _world;
        ParticleSystem _mist;
        ParticleSystem _motes;
        Transform _follow;
        float _wind;
        Transform[] _cloth;
        Quaternion[] _clothRest;
        int _clothN;

        public static Vector3 Wind
        {
            get
            {
                var angle = WorldClock.World == WorldId.Cyber ? 0.2f
                    : WorldClock.World == WorldId.Frontier ? 1.4f
                    : 0.65f;
                var weather = (WorldClock.Weather ?? "").ToLowerInvariant();
                if (weather == "storm" || weather == "wind") angle += 0.8f;
                var mag = weather == "storm" ? 3.4f : weather == "wind" ? 2.6f : 1.4f;
                return new Vector3(Mathf.Cos(angle) * mag, 0.08f, Mathf.Sin(angle) * mag);
            }
        }

        public static WorldBreath Ensure(WorldId world, Camera cam)
        {
            var go = GameObject.Find("WorldBreath");
            if (!go) go = new GameObject("WorldBreath");
            var breath = go.GetComponent<WorldBreath>() ?? go.AddComponent<WorldBreath>();
            breath.Bind(world, cam ? cam.transform : null);
            return breath;
        }

        public void Bind(WorldId world, Transform follow)
        {
            Live = this;
            _world = world;
            _follow = follow;
            EnsureLayers();
            CollectCloth();
        }

        void OnEnable() => Live = this;

        void OnDisable()
        {
            if (Live == this) Live = null;
        }

        void LateUpdate()
        {
            var dt = Time.deltaTime;
            if (dt <= 0f) dt = 0.016f;
            _wind += dt * 0.35f;
            var origin = _follow ? _follow.position : Vector3.zero;
            origin.y = 0f;
            transform.position = origin;

            var wind = Wind;
            SwayCloth(wind);
        }

        void EnsureLayers()
        {
            bool lean = ConcordiaHost.LeanPlay;
            if (!_mist) _mist = MakeLayer("GroundMist", lean ? 28 : 70);
            if (!_motes && !lean) _motes = MakeLayer("Motes", 36);
            TuneMist(lean);
            if (_motes) TuneMotes();
        }

        ParticleSystem MakeLayer(string n, int max)
        {
            var hold = transform.Find(n);
            var go = hold ? hold.gameObject : new GameObject(n);
            if (!hold) go.transform.SetParent(transform, false);
            var ps = go.GetComponent<ParticleSystem>() ?? go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.loop = true;
            main.maxParticles = max;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.playOnAwake = true;
            var emission = ps.emission;
            emission.rateOverTime = max * 0.35f;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Box;
            var rend = go.GetComponent<ParticleSystemRenderer>();
            rend.renderMode = ParticleSystemRenderMode.Billboard;
            if (!ps.isPlaying) ps.Play();
            return ps;
        }

        void TuneMist(bool lean)
        {
            if (!_mist) return;
            var main = _mist.main;
            main.startLifetime = new ParticleSystem.MinMaxCurve(6f, 11f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(0.08f, 0.28f);
            main.startSize = new ParticleSystem.MinMaxCurve(1.6f, lean ? 2.8f : 3.6f);
            var fog = RenderSettings.fogColor;
            main.startColor = new Color(fog.r, fog.g, fog.b, lean ? 0.07f : 0.11f);
            var shape = _mist.shape;
            shape.scale = new Vector3(48f, 0.55f, 48f);
            _mist.transform.localPosition = new Vector3(0f, 0.42f, 0f);
            var vel = _mist.velocityOverLifetime;
            vel.enabled = true;
            vel.space = ParticleSystemSimulationSpace.World;
            var w = Wind;
            vel.x = new ParticleSystem.MinMaxCurve(w.x * 0.22f);
            vel.y = new ParticleSystem.MinMaxCurve(0.02f);
            vel.z = new ParticleSystem.MinMaxCurve(w.z * 0.22f);
            var rend = _mist.GetComponent<ParticleSystemRenderer>();
            rend.material = HubLook.ParticleMat(new Color(fog.r, fog.g, fog.b, 0.18f), false);
            rend.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            rend.receiveShadows = false;
        }

        void TuneMotes()
        {
            var main = _motes.main;
            main.startLifetime = new ParticleSystem.MinMaxCurve(4f, 8f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(0.04f, 0.16f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.04f, 0.09f);
            main.startColor = new Color(1f, 0.94f, 0.78f, 0.22f);
            var shape = _motes.shape;
            shape.scale = new Vector3(28f, 6f, 28f);
            _motes.transform.localPosition = new Vector3(0f, 3.2f, 0f);
            var rend = _motes.GetComponent<ParticleSystemRenderer>();
            rend.material = HubLook.ParticleMat(new Color(1f, 0.92f, 0.7f, 0.35f), true);
            rend.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }

        void CollectCloth()
        {
            var found = FindObjectsByType<Transform>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            int cap = ConcordiaHost.LeanPlay ? 6 : 18;
            _cloth = new Transform[cap];
            _clothRest = new Quaternion[cap];
            _clothN = 0;
            for (int i = 0; i < found.Length && _clothN < cap; i++)
            {
                var t = found[i];
                if (!t) continue;
                var n = t.name ?? "";
                if (n.IndexOf("banner", System.StringComparison.OrdinalIgnoreCase) < 0
                    && n.IndexOf("flag", System.StringComparison.OrdinalIgnoreCase) < 0
                    && n.IndexOf("cloth", System.StringComparison.OrdinalIgnoreCase) < 0
                    && n.IndexOf("tunic", System.StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                if (t.GetComponent<ModularPerson>()) continue;
                _cloth[_clothN] = t;
                _clothRest[_clothN] = t.localRotation;
                _clothN++;
            }
        }

        void SwayCloth(Vector3 wind)
        {
            if (_clothN <= 0) return;
            float a = Mathf.Sin(_wind) * 4.2f + Mathf.Sin(_wind * 1.7f) * 1.8f;
            var tilt = Quaternion.Euler(wind.z * 1.1f + a * 0.15f, 0f, -wind.x * 1.1f);
            for (int i = 0; i < _clothN; i++)
            {
                var t = _cloth[i];
                if (!t) continue;
                t.localRotation = Quaternion.Slerp(t.localRotation, _clothRest[i] * tilt, 1f - Mathf.Exp(-3f * Time.deltaTime));
            }
        }
    }
}
