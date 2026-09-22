using System;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Runtime presentation for authored/deterministic geography. It owns
    /// route geometry and border checkpoints, not world state or streaming.
    /// </summary>
    public static class GeographyRuntime
    {
        public static void BuildRoutes(Transform continent)
        {
            if (!continent || continent.Find("GeographicRoutes")) return;
            var root = new GameObject("GeographicRoutes").transform;
            root.SetParent(continent, false);
            foreach (var route in WorldGeography.Routes)
            {
                if (route == null || route.waypoints == null || route.waypoints.Length < 2) continue;
                for (int i = 0; i < route.waypoints.Length - 1; i++)
                    DrawRoad(root, route, route.waypoints[i], route.waypoints[i + 1], i);
                var border = WorldGeography.FindBorder(route.border);
                if (border != null) BuildBorder(root, route, border);
            }
            WorldGeography.ReportValidationOnce();
        }

        public static System.Collections.IEnumerator BuildRoutesStaged(Transform continent)
        {
            if (!continent) yield break;
            var existing = continent.Find("GeographicRoutes");
            if (existing) yield break;

            var root = new GameObject("GeographicRoutes").transform;
            root.SetParent(continent, false);
            foreach (var route in WorldGeography.Routes)
            {
                if (route == null || route.waypoints == null || route.waypoints.Length < 2)
                    continue;

                for (int i = 0; i < route.waypoints.Length - 1; i++)
                {
                    DrawRoad(root, route, route.waypoints[i], route.waypoints[i + 1], i);
                    yield return null;
                }

                var border = WorldGeography.FindBorder(route.border);
                if (border != null)
                {
                    BuildBorder(root, route, border);
                    yield return null;
                }
            }

            WorldGeography.ReportValidationOnce();
            yield return null;
        }


        public static void BuildLocalSamples(Transform chunk, WorldId world)
        {
            if (!chunk || world == WorldId.Hub || chunk.Find("GeographySamples")) return;
            var root = new GameObject("GeographySamples").transform;
            root.SetParent(chunk, false);

            foreach (var territory in WorldGeography.Territories(world))
            {
                if (territory == null || territory.polygon == null || territory.polygon.Length < 3) continue;
                for (int i = 0; i < territory.polygon.Length; i++)
                {
                    var a = territory.polygon[i];
                    var b = territory.polygon[(i + 1) % territory.polygon.Length];
                    DrawTerritoryEdge(root, territory, a, b, i);
                }
                var marker = HubLook.Prim(root, PrimitiveType.Cylinder,
                    new Vector3(territory.center.x, 0.45f, territory.center.y),
                    new Vector3(0.55f, 0.9f, 0.55f),
                    HubLook.Lit(Canon.Get(world).sun, 0.14f, 0.32f),
                    "Kingdom_" + (territory.countryId ?? "x").Replace('/', '_'), false);
                if (marker)
                {
                    var stone = marker.AddComponent<LoreStone>();
                    stone.title = territory.name;
                    stone.text = "Kingdom territory\n" + territory.theme + "\nFaction " + territory.factionId
                        + "\nRadius " + territory.radius.ToString("0.0") + "m";
                }
            }

            foreach (var region in WorldGeography.Regions(world))
            {
                if (region == null || region.id == null) continue;
                if (region.id.value != null && region.id.value.EndsWith("/wilds", StringComparison.OrdinalIgnoreCase))
                    continue; // country regions + territories carry the readable markers
                var local = RegionMarkerPosition(region);
                var marker = HubLook.Prim(root, PrimitiveType.Cylinder, local + Vector3.up * 0.45f,
                    new Vector3(0.5f, 0.9f, 0.5f), HubLook.Lit(Canon.Get(world).sun, 0.12f, 0.28f),
                    "RegionMarker_" + region.id.value.Replace('/', '_'), false);
                if (!marker) continue;
                var stone = marker.AddComponent<LoreStone>();
                stone.title = region.name;
                stone.text = "Geographic region\n" + region.terrainId + "\n" + region.climateId
                    + "\nPolitical ownership remains separate from this geographic boundary.";
            }

            foreach (var place in WorldGeography.Places(world))
            {
                if (place == null || !place.wilderness || place.id == null) continue;
                var marker = HubLook.Prim(root, PrimitiveType.Cube, new Vector3(place.localPosition.x, 0.42f, place.localPosition.y),
                    new Vector3(0.65f, 0.84f, 0.65f), HubLook.Lit(new Color(0.36f, 0.26f, 0.14f), 0.1f, 0.24f),
                    "Place_" + place.id.value.Replace('/', '_'), false);
                if (!marker) continue;
                var stone = marker.AddComponent<LoreStone>();
                stone.title = place.name;
                stone.text = place.kind + "\n" + WorldBook.Folder(world) + " → " + place.region;
            }
        }

        static void DrawTerritoryEdge(Transform root, KingdomTerritoryDef territory, Vector2 a, Vector2 b, int index)
        {
            var start = new Vector3(a.x, 0.04f, a.y);
            var end = new Vector3(b.x, 0.04f, b.y);
            var delta = end - start;
            delta.y = 0f;
            var length = delta.magnitude;
            if (length < 0.5f) return;
            var edge = GameObject.CreatePrimitive(PrimitiveType.Cube);
            edge.name = "TerritoryEdge_" + (territory.countryId ?? "x") + "_" + index;
            edge.transform.SetParent(root, false);
            edge.transform.position = (start + end) * 0.5f;
            edge.transform.rotation = Quaternion.LookRotation(delta.normalized, Vector3.up);
            edge.transform.localScale = new Vector3(0.35f, 0.08f, length);
            var col = edge.GetComponent<Collider>();
            if (col) UnityEngine.Object.Destroy(col);
            var rend = edge.GetComponent<Renderer>();
            if (rend) rend.sharedMaterial = HubLook.Lit(new Color(0.55f, 0.18f, 0.12f), 0.08f, 0.22f);
        }

        static Vector3 RegionMarkerPosition(RegionDef region)
        {
            if (region.bounds == null) return Vector3.zero;
            var radius = region.bounds.shape == GeoShape.Circle
                ? Mathf.Max(10f, region.bounds.outerRadius * 0.55f)
                : Mathf.Lerp(region.bounds.innerRadius, region.bounds.outerRadius, 0.55f);
            var offset = region.id != null && region.id.value.EndsWith("wilds", StringComparison.OrdinalIgnoreCase)
                ? new Vector2(0f, radius)
                : region.id != null && region.id.value.EndsWith("march", StringComparison.OrdinalIgnoreCase)
                    ? new Vector2(radius, 0f)
                    : new Vector2(0f, 8f);
            return new Vector3(region.bounds.center.x + offset.x, 0f, region.bounds.center.y + offset.y);
        }

        static void DrawRoad(Transform root, TradeRouteDef route, Vector2 a, Vector2 b, int index)
        {
            var start = new Vector3(a.x, 0.035f, a.y);
            var end = new Vector3(b.x, 0.035f, b.y);
            var delta = end - start;
            delta.y = 0f;
            var length = delta.magnitude;
            if (length < 1f) return;
            var road = GameObject.CreatePrimitive(PrimitiveType.Cube);
            road.name = "TradeRoute_" + route.id.value.Replace('/', '_') + "_" + index;
            road.transform.SetParent(root, false);
            road.transform.position = (start + end) * 0.5f;
            road.transform.rotation = Quaternion.LookRotation(delta.normalized, Vector3.up);
            road.transform.localScale = new Vector3(route.width, 0.06f, length);
            var color = Canon.Get(route.worldA).ground;
            var material = HubLook.Pbr("packed_earth", Color.Lerp(color, new Color(0.28f, 0.22f, 0.16f), 0.48f), 0.05f, 0.22f, 12f);
            var renderer = road.GetComponent<Renderer>();
            if (renderer && material) renderer.sharedMaterial = material;
        }

        static void BuildBorder(Transform root, TradeRouteDef route, BorderDef border)
        {
            var at = new Vector3(border.globalPosition.x, 0f, border.globalPosition.y);
            var from = route.waypoints[0];
            var to = route.waypoints[route.waypoints.Length - 1];
            var forward = new Vector3(to.x - from.x, 0f, to.y - from.y);
            if (forward.sqrMagnitude < 0.01f) forward = Vector3.forward;
            forward.Normalize();
            var side = Vector3.Cross(Vector3.up, forward).normalized;
            var checkpoint = new GameObject("BorderCrossing_" + border.id.value.Replace('/', '_'));
            checkpoint.transform.SetParent(root, false);
            checkpoint.transform.position = at;
            checkpoint.transform.rotation = Quaternion.LookRotation(forward, Vector3.up);
            var crossing = checkpoint.AddComponent<BorderCrossing>();
            crossing.borderId = border.id;
            crossing.routeId = route.id;
            crossing.worldA = border.worldA;
            crossing.worldB = border.worldB;
            var box = checkpoint.AddComponent<BoxCollider>();
            box.isTrigger = true;
            box.center = Vector3.up * 1.1f;
            box.size = new Vector3(8f, 2.4f, 4f);

            var material = HubLook.Lit(new Color(0.42f, 0.3f, 0.18f), 0.08f, 0.25f);
            MakePost(checkpoint.transform, at + side * 4f, material, "PostA");
            MakePost(checkpoint.transform, at - side * 4f, material, "PostB");
            var lintel = GameObject.CreatePrimitive(PrimitiveType.Cube);
            lintel.name = "BorderLintel";
            lintel.transform.SetParent(root, false);
            lintel.transform.position = at + Vector3.up * 3.2f;
            lintel.transform.rotation = checkpoint.transform.rotation;
            lintel.transform.localScale = new Vector3(9f, 0.45f, 0.55f);
            var lintelRenderer = lintel.GetComponent<Renderer>();
            if (lintelRenderer) lintelRenderer.sharedMaterial = material;

            var label = new GameObject("BorderName").AddComponent<TextMesh>();
            label.transform.SetParent(root, false);
            label.transform.position = at + Vector3.up * 3.7f + side * 0.1f;
            label.transform.rotation = Quaternion.LookRotation(label.transform.position - Camera.main.transform.position, Vector3.up);
            label.text = Canon.Get(border.worldA).title + " · " + Canon.Get(border.worldB).title;
            label.fontSize = 30;
            label.characterSize = 0.045f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = new Color(1f, 0.9f, 0.68f);
            HubLook.DressTextMesh(label);
        }

        static void MakePost(Transform parent, Vector3 position, Material material, string name)
        {
            var post = GameObject.CreatePrimitive(PrimitiveType.Cube);
            post.name = name;
            post.transform.SetParent(parent, false);
            post.transform.position = position + Vector3.up * 1.6f;
            post.transform.localScale = new Vector3(0.7f, 3.2f, 0.7f);
            var renderer = post.GetComponent<Renderer>();
            if (renderer) renderer.sharedMaterial = material;
        }
    }

    public class BorderCrossing : MonoBehaviour
    {
        public BorderId borderId;
        public TradeRouteId routeId;
        public WorldId worldA;
        public WorldId worldB;
        float _nextAt;

        void OnTriggerEnter(Collider other)
        {
            if (Time.unscaledTime < _nextAt) return;
            var player = other.GetComponent<ConcordiaPlayer>() ?? other.GetComponentInParent<ConcordiaPlayer>();
            if (!player) return;
            var from = player.world;
            if (from != worldA && from != worldB) return;
            var to = from == worldA ? worldB : worldA;
            _nextAt = Time.unscaledTime + 1.25f;
            WorldGeography.RecordBorderCrossing(borderId, from, to, "physical");
            player.Notice("Physical border crossed: " + Canon.Get(to).title + ".");
        }
    }
}
