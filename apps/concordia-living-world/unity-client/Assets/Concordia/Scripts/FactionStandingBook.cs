using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    [Serializable]
    public sealed class FactionStandingRecord
    {
        public string world;
        public string factionId;
        public float standing;
        public float witnessHeat;
        public int updatedDay;
    }

    /// <summary>
    /// Persistent per-world, per-faction standing. FactionHeat remains a world-wide
    /// simulation pressure; this book stores the scoped relationship state.
    /// </summary>
    public static class FactionStandingBook
    {
        static readonly List<FactionStandingRecord> Records = new List<FactionStandingRecord>(64);
        public static IReadOnlyList<FactionStandingRecord> All => Records;

        public static float Get(WorldId world, string factionId)
        {
            var record = Find(world, factionId);
            return record != null ? record.standing : 0f;
        }

        public static float WitnessHeat(WorldId world, string factionId)
        {
            var record = Find(world, factionId);
            return record != null ? record.witnessHeat : 0f;
        }

public static float Adjust(WorldId world, string factionId, float delta, bool witnessed = false)
        {
            return Adjust(world, factionId, delta, witnessed, "adjust");
        }

        public static float Adjust(WorldId world, string factionId, float delta, bool witnessed, string cause)
        {
            factionId = NormalizeFactionId(factionId);
            if (string.IsNullOrWhiteSpace(factionId)) return 0f;
            var record = Find(world, factionId);
            if (record == null)
            {
                record = new FactionStandingRecord { world = world.ToString(), factionId = factionId };
                Records.Add(record);
            }
            record.standing = Mathf.Clamp(record.standing + delta, -1f, 1f);
            if (witnessed) record.witnessHeat = Mathf.Clamp01(record.witnessHeat + Mathf.Abs(delta));
            record.updatedDay = WorldClock.Day;
            WorldEventLog.Record("faction-standing", factionId + " standing " + record.standing.ToString("0.00") + " cause=" + (cause ?? "adjust"), "player", factionId);
            return record.standing;
        }

        public static float AddWitnessHeat(WorldId world, string factionId, float amount, string cause = "witness")
        {
            factionId = NormalizeFactionId(factionId);
            if (string.IsNullOrWhiteSpace(factionId)) return 0f;
            var record = Find(world, factionId);
            if (record == null)
            {
                record = new FactionStandingRecord { world = world.ToString(), factionId = factionId };
                Records.Add(record);
            }
            record.witnessHeat = Mathf.Clamp01(record.witnessHeat + Mathf.Abs(amount));
            record.updatedDay = WorldClock.Day;
            WorldEventLog.Record("witness-heat", factionId + " witness heat " + record.witnessHeat.ToString("0.00") + " cause=" + (cause ?? "witness"), "player", factionId);
            return record.witnessHeat;
        }

        public static string NormalizeFactionId(string raw)
        {
            return string.IsNullOrWhiteSpace(raw) ? string.Empty : raw.Trim().ToLowerInvariant();
        }

        public static string Line(WorldId world)
        {
            var parts = new List<string>();
            foreach (var record in Records)
                if (record != null && string.Equals(record.world, world.ToString(), StringComparison.OrdinalIgnoreCase))
                    parts.Add(record.factionId + " " + record.standing.ToString("0.00") +
                             (record.witnessHeat > 0.01f ? " heat " + record.witnessHeat.ToString("0.00") : ""));
            return parts.Count == 0 ? "" : string.Join(" · ", parts);
        }

        public static List<FactionStandingRecord> Snapshot()
        {
            var copy = new List<FactionStandingRecord>(Records.Count);
            foreach (var record in Records)
                if (record != null)
                    copy.Add(new FactionStandingRecord
                    {
                        world = record.world,
                        factionId = record.factionId,
                        standing = record.standing,
                        witnessHeat = record.witnessHeat,
                        updatedDay = record.updatedDay
                    });
            return copy;
        }

        public static void Restore(IEnumerable<FactionStandingRecord> source)
        {
            Records.Clear();
            if (source == null) return;
            foreach (var record in source)
            {
                if (record == null || string.IsNullOrWhiteSpace(record.factionId)) continue;
                Records.Add(new FactionStandingRecord
                {
                    world = record.world ?? "Hub",
                    factionId = NormalizeFactionId(record.factionId),
                    standing = Mathf.Clamp(record.standing, -1f, 1f),
                    witnessHeat = Mathf.Clamp01(record.witnessHeat),
                    updatedDay = record.updatedDay
                });
            }
        }

        static FactionStandingRecord Find(WorldId world, string factionId)
        {
            factionId = NormalizeFactionId(factionId);
            if (string.IsNullOrWhiteSpace(factionId)) return null;
            for (var i = 0; i < Records.Count; i++)
            {
                var record = Records[i];
                if (record != null && string.Equals(record.world, world.ToString(), StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(NormalizeFactionId(record.factionId), factionId, StringComparison.OrdinalIgnoreCase))
                    return record;
            }
            return null;
        }
    }
}
