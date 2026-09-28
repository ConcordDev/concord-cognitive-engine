using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace Concordia
{
    /// <summary>
    /// Per-cell NavMesh — bake a local NavMeshData for this cell only.
    /// No world-wide bake. WorldStreamManager loads/unloads via Ensure/Release.
    /// </summary>
    public sealed class StreamNavChunk : MonoBehaviour
    {
        [System.NonSerialized] public StreamCellId Cell;
        public readonly List<Vector3> Waypoints = new List<Vector3>(16);
        public bool Ready { get; private set; }

        NavMeshData _data;
        NavMeshDataInstance _instance;
        float _halfExtent = 48f;

        static readonly Dictionary<string, StreamNavChunk> _live = new Dictionary<string, StreamNavChunk>();

        public static StreamNavChunk Ensure(StreamCellId cell, Transform parent, Vector3 center)
        {
            if (_live.TryGetValue(cell.Key, out var have) && have) return have;
            var go = new GameObject("NavChunk_" + cell.Kind + "_" + cell.Cx + "_" + cell.Cz);
            if (parent) go.transform.SetParent(parent, false);
            go.transform.position = center;
            var chunk = go.AddComponent<StreamNavChunk>();
            chunk.Cell = cell;
            chunk.BakeLocal(center);
            _live[cell.Key] = chunk;
            WorldStreamManager.Ensure()?.MarkResident(cell, StreamLodBand.Simulation);
            return chunk;
        }

        public static void Release(StreamCellId cell)
        {
            if (!_live.TryGetValue(cell.Key, out var chunk) || !chunk) return;
            _live.Remove(cell.Key);
            Object.Destroy(chunk.gameObject);
        }

        public static bool TryGet(StreamCellId cell, out StreamNavChunk chunk) =>
            _live.TryGetValue(cell.Key, out chunk) && chunk;

        public static bool TryNearestPoint(Vector3 from, out Vector3 point)
        {
            if (NavMesh.SamplePosition(from, out var hit, 24f, NavMesh.AllAreas))
            {
                point = hit.position;
                return true;
            }
            point = from;
            var best = float.MaxValue;
            var ok = false;
            foreach (var kv in _live)
            {
                var c = kv.Value;
                if (!c || !c.Ready) continue;
                for (var i = 0; i < c.Waypoints.Count; i++)
                {
                    var d = (c.Waypoints[i] - from).sqrMagnitude;
                    if (d >= best) continue;
                    best = d;
                    point = c.Waypoints[i];
                    ok = true;
                }
            }
            return ok;
        }

        void BakeLocal(Vector3 center)
        {
            Waypoints.Clear();
            const int n = 8;
            const float r = 12f;
            for (var i = 0; i < n; i++)
            {
                var a = i / (float)n * Mathf.PI * 2f;
                Waypoints.Add(center + new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r));
            }
            Waypoints.Add(center);

            // Per-cell NavMesh bake (modules.ai) — bounds local to this chunk only.
            try
            {
                var bounds = new Bounds(center, new Vector3(_halfExtent * 2f, 40f, _halfExtent * 2f));
                var sources = new List<NavMeshBuildSource>(64);
                var markups = new List<NavMeshBuildMarkup>(4);
                NavMeshBuilder.CollectSources(
                    bounds,
                    ~0,
                    NavMeshCollectGeometry.PhysicsColliders,
                    0,
                    markups,
                    sources);
                var render = new List<NavMeshBuildSource>(64);
                NavMeshBuilder.CollectSources(
                    bounds,
                    ~0,
                    NavMeshCollectGeometry.RenderMeshes,
                    0,
                    markups,
                    render);
                if (sources.Count < 4)
                    sources.AddRange(render);
                else if (sources.Count == 0)
                    sources = render;

                var settings = NavMesh.GetSettingsByIndex(0);
                settings.overrideVoxelSize = true;
                settings.voxelSize = 0.2f;
                settings.overrideTileSize = true;
                settings.tileSize = 32;

                if (_instance.valid) _instance.Remove();
                if (_data) Object.Destroy(_data);

                _data = NavMeshBuilder.BuildNavMeshData(
                    settings,
                    sources,
                    bounds,
                    center,
                    Quaternion.identity);
                if (_data)
                {
                    _instance = NavMesh.AddNavMeshData(_data);
                    Ready = true;
                }
                else
                    Ready = Waypoints.Count > 0;
            }
            catch (System.Exception ex)
            {
                Debug.LogWarning("[Concordia] StreamNavChunk bake soft-fail: " + ex.Message);
                Ready = Waypoints.Count > 0;
            }
        }

        void OnDestroy()
        {
            if (_instance.valid) _instance.Remove();
            if (_data) Object.Destroy(_data);
            if (_live.TryGetValue(Cell.Key, out var self) && self == this)
                _live.Remove(Cell.Key);
        }
    }
}
