using UnityEngine;

namespace Concordia
{
    public class WorldGate : MonoBehaviour
    {
        public GateDef def;
        public string Prompt => "E  ·  " + def.name + "  —  " + def.refusal;
    }

    // City inside the current world. E walks you into that town plaza.
    public class CityGate : MonoBehaviour
    {
        public CityDef city;
        public string Prompt => city == null || string.IsNullOrEmpty(city.name)
            ? "E  ·  town"
            : "E  ·  Enter " + city.name;
    }

    public class LoreStone : MonoBehaviour
    {
        public string title, text;
        public string Prompt => "E  ·  " + title;
    }

    public class GuestNpc : MonoBehaviour
    {
        public GuestDef def;
        public string Prompt => "E  ·  " + def.name + ", " + def.title;
    }

    public class CourtBird : MonoBehaviour
    {
        public int seed;
        public float radius = 12f;
        public float height = 8f;
        float _phase, _speed, _bob;
        Transform _wingL, _wingR;

        void Start()
        {
            var rng = new System.Random(seed == 0 ? gameObject.GetHashCode() : seed);
            _phase = (float)rng.NextDouble() * Mathf.PI * 2f;
            _speed = 0.35f + (float)rng.NextDouble() * 0.45f;
            _bob = 0.4f + (float)rng.NextDouble() * 0.6f;
            radius = radius <= 0 ? 10f + (float)rng.NextDouble() * 12f : radius;
            height = height <= 0 ? 6f + (float)rng.NextDouble() * 5f : height;

            var body = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            body.name = "Body";
            body.transform.SetParent(transform, false);
            body.transform.localScale = new Vector3(0.22f, 0.14f, 0.28f);
            Object.Destroy(body.GetComponent<Collider>());
            var cream = HubLook.Lit(new Color(0.92f, 0.88f, 0.78f), 0.02f, 0.35f);
            body.GetComponent<Renderer>().sharedMaterial = cream;
            _wingL = MakeWing(new Vector3(-0.14f, 0.02f, 0f), cream);
            _wingR = MakeWing(new Vector3(0.14f, 0.02f, 0f), cream);
        }

        Transform MakeWing(Vector3 local, Material mat)
        {
            var w = GameObject.CreatePrimitive(PrimitiveType.Cube);
            w.name = "Wing";
            w.transform.SetParent(transform, false);
            w.transform.localPosition = local;
            w.transform.localScale = new Vector3(0.22f, 0.03f, 0.14f);
            Object.Destroy(w.GetComponent<Collider>());
            w.GetComponent<Renderer>().sharedMaterial = mat;
            return w.transform;
        }

        void Update()
        {
            _phase += Time.deltaTime * _speed;
            var p = new Vector3(Mathf.Cos(_phase) * radius, height + Mathf.Sin(_phase * 2.4f) * _bob, Mathf.Sin(_phase) * radius);
            var tan = new Vector3(-Mathf.Sin(_phase), 0f, Mathf.Cos(_phase));
            transform.position = p;
            if (tan.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(tan, Vector3.up), Time.deltaTime * 4f);
            float flap = Mathf.Sin(Time.time * 11f + _phase) * 28f;
            if (_wingL) _wingL.localRotation = Quaternion.Euler(0f, 0f, flap);
            if (_wingR) _wingR.localRotation = Quaternion.Euler(0f, 0f, -flap);
        }
    }
}
