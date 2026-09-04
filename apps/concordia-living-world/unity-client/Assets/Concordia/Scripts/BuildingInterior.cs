using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Hollow floorplan + court-facing door. Solid store/Kenney shells hide
    /// while you are inside. FakeWindows is the density LOD — glow only.
    /// </summary>
    public class BuildingInterior : MonoBehaviour
    {
        public string plan;
        public bool entered;
        float _w = 8f, _d = 7f, _h = 3.15f;
        Renderer[] _shell;

        public static void FakeWindows(GameObject shell)
        {
            if (!shell) return;
            var rends = shell.GetComponentsInChildren<Renderer>();
            if (rends.Length == 0) return;
            var b = rends[0].bounds;
            for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
            var glow = new Color(1f, 0.78f, 0.42f);
            var mat = HubLook.Lit(glow, 0f, 0.04f);
            float face = Mathf.Max(0.8f, b.size.z * 0.48f);
            for (int i = 0; i < 3; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                go.name = "FakeWindow";
                go.transform.SetParent(shell.transform, false);
                go.transform.localPosition = new Vector3(-1.35f + i * 1.35f, 1.55f, -face);
                go.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
                go.transform.localScale = new Vector3(0.52f, 0.68f, 1f);
                var r = go.GetComponent<Renderer>();
                if (r) r.sharedMaterial = mat;
                var col = go.GetComponent<Collider>();
                if (col) Object.Destroy(col);
            }
        }

        public static BuildingInterior Open(GameObject shell, string plan, Vector3 worldPos)
        {
            if (!shell) return null;
            var toCourt = -new Vector3(worldPos.x, 0, worldPos.z);
            if (toCourt.sqrMagnitude > 0.2f)
                shell.transform.rotation = Quaternion.LookRotation(-toCourt.normalized);

            foreach (var c in shell.GetComponentsInChildren<Collider>())
                Object.Destroy(c);

            var bi = shell.GetComponent<BuildingInterior>() ?? shell.AddComponent<BuildingInterior>();
            bi.plan = plan;
            bi._shell = shell.GetComponentsInChildren<Renderer>();
            bi.Build();
            var place = shell.GetComponent<BuildingPlace>() ?? shell.AddComponent<BuildingPlace>();
            place.plan = plan;
            place.door = shell.transform.position + shell.transform.forward * -2.4f;
            return bi;
        }

        void Build()
        {
            var rends = GetComponentsInChildren<Renderer>();
            if (rends.Length > 0)
            {
                var b = rends[0].bounds;
                for (int i = 1; i < rends.Length; i++) b.Encapsulate(rends[i].bounds);
                _w = Mathf.Clamp(b.size.x * 0.88f, 6.5f, 12f);
                _d = Mathf.Clamp(b.size.z * 0.88f, 6f, 11f);
            }

            var roomGo = new GameObject("Interior");
            var room = roomGo.transform;
            room.SetParent(transform, false);
            room.localPosition = Vector3.zero;
            room.localRotation = Quaternion.identity;

            var plaster = new Color(0.82f, 0.76f, 0.66f);
            var wood = new Color(0.38f, 0.26f, 0.16f);
            var floorC = new Color(0.45f, 0.32f, 0.20f);

            Slab(room, new Vector3(0, 0.04f, 0), new Vector3(_w, 0.08f, _d), floorC, "packed_earth");
            Slab(room, new Vector3(0, _h, 0), new Vector3(_w, 0.08f, _d), wood, "plastered_wall");

            float t = 0.28f;
            float doorW = 1.7f, doorH = 2.35f;
            Slab(room, new Vector3(0, _h * 0.5f, _d * 0.5f - t * 0.5f), new Vector3(_w, _h, t), plaster, "plastered_wall");
            Slab(room, new Vector3(-_w * 0.5f + t * 0.5f, _h * 0.5f, 0), new Vector3(t, _h, _d), plaster, "plastered_wall");
            Slab(room, new Vector3(_w * 0.5f - t * 0.5f, _h * 0.5f, 0), new Vector3(t, _h, _d), plaster, "plastered_wall");

            float side = (_w - doorW) * 0.5f;
            Slab(room, new Vector3(-(_w * 0.5f - side * 0.5f), _h * 0.5f, -_d * 0.5f + t * 0.5f), new Vector3(side, _h, t), plaster, "plastered_wall");
            Slab(room, new Vector3(_w * 0.5f - side * 0.5f, _h * 0.5f, -_d * 0.5f + t * 0.5f), new Vector3(side, _h, t), plaster, "plastered_wall");
            Slab(room, new Vector3(0, doorH + (_h - doorH) * 0.5f, -_d * 0.5f + t * 0.5f), new Vector3(doorW, _h - doorH, t), plaster, "plastered_wall");

            var doorPos = transform.TransformPoint(new Vector3(0, 1.15f, -_d * 0.5f));
            var frame = FreePacks.Spawn("doorwayOpen", transform, doorPos, transform.eulerAngles.y, 2.4f)
                        ?? FreePacks.Spawn("doorway", transform, doorPos, transform.eulerAngles.y, 2.4f)
                        ?? FreePacks.Spawn("door", transform, doorPos, transform.eulerAngles.y, 2.4f);
            if (frame)
            {
                foreach (var c in frame.GetComponentsInChildren<Collider>()) Object.Destroy(c);
            }

            var lamp = new GameObject("InteriorLight");
            lamp.transform.SetParent(room, false);
            lamp.transform.localPosition = new Vector3(0, _h - 0.35f, 0);
            var l = lamp.AddComponent<Light>();
            l.type = LightType.Point;
            l.color = new Color(1f, 0.84f, 0.62f);
            l.intensity = 2.4f;
            l.range = Mathf.Max(_w, _d) * 0.9f;
            l.shadows = LightShadows.Soft;

            Furnish(room);
        }

        void Furnish(Transform room)
        {
            switch (plan)
            {
                case "tavern":
                    Put(room, "kitchenBar", new Vector3(0, 0, _d * 0.28f), 180, 1.1f);
                    Put(room, "kitchenStove", new Vector3(-_w * 0.28f, 0, _d * 0.28f), 180, 1.2f);
                    Put(room, "table", new Vector3(-1.6f, 0, -0.4f), 10, 0.85f);
                    Put(room, "chair", new Vector3(-1.6f, 0, -1.3f), 0, 0.9f);
                    Put(room, "chair", new Vector3(-1.6f, 0, 0.4f), 180, 0.9f);
                    Put(room, "table", new Vector3(1.7f, 0, -0.2f), -8, 0.85f);
                    Put(room, "chair", new Vector3(1.7f, 0, -1.1f), 0, 0.9f);
                    Put(room, "loungeSofa", new Vector3(_w * 0.28f, 0, _d * 0.12f), 90, 1.2f);
                    Put(room, "barrel", new Vector3(-_w * 0.32f, 0, -_d * 0.22f), 0, 0.8f);
                    Put(room, "lampRoundFloor", new Vector3(_w * 0.3f, 0, -_d * 0.22f), 0, 1.3f);
                    break;
                case "forge":
                    Put(room, "campfire_stones", new Vector3(0, 0, _d * 0.18f), 0, 1.3f);
                    Put(room, "campfire_logs", new Vector3(0, 0, _d * 0.18f), 20, 1.0f);
                    Put(room, "weapon-rack", new Vector3(-_w * 0.32f, 0, 0.4f), 90, 1.7f);
                    Put(room, "weapon-rack", new Vector3(_w * 0.32f, 0, 0.4f), -90, 1.7f);
                    Put(room, "weapon-sword", new Vector3(1.1f, 0, -_d * 0.15f), 40, 0.9f);
                    Put(room, "barrel", new Vector3(-1.4f, 0, -_d * 0.2f), 0, 0.8f);
                    break;
                case "archive":
                    Put(room, "bookcaseOpen", new Vector3(-_w * 0.32f, 0, 0.6f), 90, 2.1f);
                    Put(room, "bookcaseClosed", new Vector3(_w * 0.32f, 0, 0.6f), -90, 2.1f);
                    Put(room, "bookcaseOpen", new Vector3(-_w * 0.32f, 0, -0.8f), 90, 2.1f);
                    Put(room, "desk", new Vector3(0, 0, _d * 0.18f), 180, 1.1f);
                    Put(room, "chairDesk", new Vector3(0, 0, _d * 0.05f), 180, 0.9f);
                    Put(room, "lampRoundFloor", new Vector3(_w * 0.22f, 0, _d * 0.2f), 0, 1.3f);
                    Put(room, "books", new Vector3(0.4f, 0.85f, _d * 0.18f), 0, 0.35f);
                    break;
                case "market":
                    Put(room, "table", new Vector3(-1.8f, 0, 0.3f), 0, 0.85f);
                    Put(room, "table", new Vector3(1.8f, 0, 0.3f), 0, 0.85f);
                    Put(room, "crate", new Vector3(-_w * 0.28f, 0, _d * 0.22f), 15, 0.8f);
                    Put(room, "market_barrel", new Vector3(_w * 0.28f, 0, _d * 0.2f), 0, 0.85f);
                    Put(room, "cart", new Vector3(0, 0, -_d * 0.12f), 180, 1.6f);
                    Put(room, "apple", new Vector3(-1.8f, 0.7f, 0.3f), 0, 0.2f);
                    Put(room, "bread", new Vector3(1.6f, 0.7f, 0.3f), 0, 0.22f);
                    break;
                case "tower":
                    Put(room, "banner", new Vector3(0, 0, _d * 0.28f), 180, 2.2f);
                    Put(room, "weapon-rack", new Vector3(-_w * 0.28f, 0, 0), 90, 1.6f);
                    Put(room, "trophy", new Vector3(_w * 0.22f, 0, _d * 0.1f), 0, 1.0f);
                    break;
                default:
                    Put(room, "desk", new Vector3(0, 0, _d * 0.16f), 180, 1.1f);
                    Put(room, "chairDesk", new Vector3(0, 0, 0.05f), 180, 0.9f);
                    Put(room, "flag-banner-short", new Vector3(_w * 0.28f, 0, _d * 0.22f), 0, 2.0f);
                    Put(room, "lampRoundFloor", new Vector3(-_w * 0.28f, 0, -_d * 0.18f), 0, 1.3f);
                    break;
            }
        }

        void Put(Transform room, string stem, Vector3 local, float yaw, float h)
        {
            var hh = FreePacks.HumanHeight(stem);
            if (hh > 0.01f) h = hh;
            var world = room.TransformPoint(local);
            var go = FreePacks.Spawn(DressVocab.Resolve(stem), room, world, room.eulerAngles.y + yaw, h);
            if (!go) return;
            go.transform.SetParent(room, true);
            if (stem == "kitchenStove") CookStation.Stamp(go);
        }

        static void Slab(Transform parent, Vector3 local, Vector3 scale, Color c, string pbr = null)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Plan";
            go.transform.SetParent(parent, false);
            go.transform.localPosition = local;
            go.transform.localScale = scale;
            var r = go.GetComponent<Renderer>();
            if (!r) return;
            r.sharedMaterial = string.IsNullOrEmpty(pbr)
                ? HubLook.Lit(c, 0.04f, 0.22f)
                : HubLook.Pbr(pbr, c, 0.03f, 0.2f, 4f);
        }

        public string Prompt => "E  ·  Enter";

        public Vector3 Inside()
        {
            return transform.position + Vector3.up * 0.12f;
        }

        void LateUpdate()
        {
            var player = FindFirstObjectByType<ConcordiaPlayer>();
            if (!player || _shell == null) return;
            var lp = transform.InverseTransformPoint(player.transform.position);
            bool inside = Mathf.Abs(lp.x) < _w * 0.5f - 0.2f
                          && lp.y > -0.15f && lp.y < _h + 0.2f
                          && lp.z > -_d * 0.5f + 0.05f && lp.z < _d * 0.5f - 0.2f;
            foreach (var r in _shell)
                if (r) r.enabled = !inside;
        }
    }
}
