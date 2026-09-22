using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.WorldField
{
    [Serializable]
    public struct WorldFieldCellKey : IEquatable<WorldFieldCellKey>
    {
        public int x;
        public int z;

        public WorldFieldCellKey(int x, int z)
        {
            this.x = x;
            this.z = z;
        }

        public bool Equals(WorldFieldCellKey other) { return x == other.x && z == other.z; }
        public override bool Equals(object obj) { return obj is WorldFieldCellKey && Equals((WorldFieldCellKey)obj); }
        public override int GetHashCode() { unchecked { return x * 397 ^ z; } }
        public override string ToString() { return x + ":" + z; }
    }

    [Serializable]
    public sealed class WorldFieldRawSample
    {
        public Vector2 globalKm;
        public string dominantInfluence;
        public bool isHubCourt;
        public float[] values = new float[9];
        public float terrainConnectivity;
        public float biomeAffinity;
        public float temporalModifier;
        public List<WorldFieldContribution> contributions = new List<WorldFieldContribution>();
    }

    /// <summary>Small deterministic corner cache. It contains no Unity objects and can be cleared safely.</summary>
    public sealed class WorldFieldCellCache
    {
        readonly Dictionary<WorldFieldCellKey, WorldFieldRawSample> samples = new Dictionary<WorldFieldCellKey, WorldFieldRawSample>();
        readonly float cellSizeKm;

        public WorldFieldCellCache(float cellSizeKm)
        {
            this.cellSizeKm = Mathf.Max(0.001f, cellSizeKm);
        }

        public int Count { get { return samples.Count; } }
        public float CellSizeKm { get { return cellSizeKm; } }

        public WorldFieldCellKey Key(Vector2 globalKm)
        {
            return new WorldFieldCellKey(Mathf.FloorToInt(globalKm.x / cellSizeKm), Mathf.FloorToInt(globalKm.y / cellSizeKm));
        }

        public Vector2 Origin(WorldFieldCellKey key)
        {
            return new Vector2(key.x * cellSizeKm, key.z * cellSizeKm);
        }

        public WorldFieldRawSample GetOrAdd(WorldFieldCellKey key, Func<Vector2, WorldFieldRawSample> factory)
        {
            WorldFieldRawSample result;
            if (samples.TryGetValue(key, out result)) return result;
            result = factory(Origin(key));
            samples[key] = result;
            return result;
        }

        public bool TryGet(WorldFieldCellKey key, out WorldFieldRawSample sample)
        {
            return samples.TryGetValue(key, out sample);
        }

        public void Clear() { samples.Clear(); }
    }
}
