using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    [Serializable]
    public sealed class WorldEventRecord
    {
        public string eventId;
        public string type;
        public string world;
        public string actorId;
        public string targetId;
        public string text;
        public float occurredAt;
        public int day;
    }

    /// <summary>
    /// Bounded causal memory for world, quest, dialogue, crime, faction, and combat events.
    /// WorldClock.LastEvent remains a presentation summary; it is not the event store.
    /// </summary>
    public static class WorldEventLog
    {
        public const int Capacity = 128;
        static readonly List<WorldEventRecord> Events = new List<WorldEventRecord>(Capacity);

        public static IReadOnlyList<WorldEventRecord> All => Events;
        public static int Count => Events.Count;

        public static WorldEventRecord Record(string type, string text, string actorId = null, string targetId = null)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var record = new WorldEventRecord
            {
                eventId = Guid.NewGuid().ToString("N"),
                type = string.IsNullOrEmpty(type) ? "world" : type,
                world = WorldClock.World.ToString(),
                actorId = actorId ?? "",
                targetId = targetId ?? "",
                text = text,
                occurredAt = Time.unscaledTime,
                day = WorldClock.Day
            };
            Events.Add(record);
            if (Events.Count > Capacity) Events.RemoveAt(0);
            return record;
        }

        public static void Restore(IEnumerable<WorldEventRecord> records)
        {
            Events.Clear();
            if (records == null) return;
            foreach (var source in records)
            {
                if (source == null || string.IsNullOrEmpty(source.text)) continue;
                Events.Add(new WorldEventRecord
                {
                    eventId = source.eventId ?? Guid.NewGuid().ToString("N"),
                    type = source.type ?? "world",
                    world = source.world ?? "Hub",
                    actorId = source.actorId ?? "",
                    targetId = source.targetId ?? "",
                    text = source.text,
                    occurredAt = source.occurredAt,
                    day = source.day
                });
                if (Events.Count >= Capacity) break;
            }
        }

        public static string RecentLine(int max = 4)
        {
            if (Events.Count == 0) return "";
            var start = Mathf.Max(0, Events.Count - Mathf.Max(1, max));
            var lines = new List<string>(Events.Count - start);
            for (var i = start; i < Events.Count; i++)
                lines.Add(Events[i].type + ": " + Events[i].text);
            return string.Join("\n", lines);
        }
    }
}
