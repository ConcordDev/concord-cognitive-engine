using System;
using System.Collections.Generic;
using System.Text;

namespace Concordia.Animation
{
    /// <summary>Pure coverage math. Editor auditor fills clip paths; this never invents Real.</summary>
    public static class AnimationCoverage
    {
        public static readonly string[] SliceOrder =
        {
            "locomotion", "traversal", "combat", "firearms", "magic", "reaction",
            "interaction", "work", "creatures", "boss", "hybrid", "sports", "fauna_social"
        };

        public static AnimationCoverageReport Build()
        {
            var report = new AnimationCoverageReport
            {
                GeneratedAt = DateTime.UtcNow.ToString("o"),
                VerbCount = AnimationVerbCatalog.All.Count
            };

            var sliceMap = new Dictionary<string, AnimationCoverageSlice>();
            foreach (var verb in AnimationVerbCatalog.All)
            {
                var status = AnimationVerbCatalog.StatusOf(verb.Id);
                AnimationLiveBindings.TryGet(verb.Id, out var live);
                var row = new AnimationVerbCoverageRow
                {
                    VerbId = verb.Id,
                    Domain = verb.Domain,
                    Family = verb.Family,
                    Rig = verb.Rig.ToString(),
                    Status = status.ToString(),
                    Source = verb.Source.ToString(),
                    ClipGuid = live != null ? live.ClipGuid : "",
                    ClipPath = live != null ? live.ClipPath : "",
                    Reason = live != null ? live.Reason : verb.Notes
                };
                report.Rows.Add(row);

                if (!sliceMap.TryGetValue(verb.Domain, out var slice))
                {
                    slice = new AnimationCoverageSlice { Name = verb.Domain };
                    sliceMap[verb.Domain] = slice;
                }
                slice.Total++;
                switch (status)
                {
                    case AnimationCoverageStatus.Real: slice.Real++; break;
                    case AnimationCoverageStatus.Procedural: slice.Procedural++; break;
                    case AnimationCoverageStatus.Reused: slice.Reused++; break;
                    case AnimationCoverageStatus.VideoReference: slice.VideoReference++; break;
                    default: slice.Missing++; break;
                }
            }

            foreach (var name in SliceOrder)
            {
                if (!sliceMap.TryGetValue(name, out var slice)) continue;
                var usable = slice.Real + slice.Procedural;
                slice.PercentRealOrProcedural = slice.Total == 0 ? 0f : (100f * usable / slice.Total);
                report.Slices.Add(slice);
            }
            foreach (var kv in sliceMap)
            {
                if (Array.IndexOf(SliceOrder, kv.Key) >= 0) continue;
                var slice = kv.Value;
                var usable = slice.Real + slice.Procedural;
                slice.PercentRealOrProcedural = slice.Total == 0 ? 0f : (100f * usable / slice.Total);
                report.Slices.Add(slice);
            }

            foreach (var trap in AnimationLiveBindings.HonestyTraps)
                report.HonestyFailures.Add(trap.StateName + ": " + trap.Reason);
            foreach (var id in new[] { "trav.dodge", "loc.sprint", "trav.jump_land", "combat.light", "react.hit_front", "death.front" })
            {
                if (AnimationLiveBindings.TryGet(id, out var live) && live.Status != AnimationCoverageStatus.Real)
                    report.HonestyFailures.Add(live.StateName + ": " + live.Reason);
            }

            return report;
        }

        public static string Bar(float percent, int width = 20)
        {
            var filled = (int)Math.Round(percent / 100f * width);
            if (filled < 0) filled = 0;
            if (filled > width) filled = width;
            var sb = new StringBuilder(width + 8);
            for (var i = 0; i < filled; i++) sb.Append('█');
            for (var i = filled; i < width; i++) sb.Append('░');
            sb.Append(' ').Append(percent.ToString("0")).Append('%');
            return sb.ToString();
        }

        public static string FormatDashboard(AnimationCoverageReport report)
        {
            var sb = new StringBuilder();
            sb.AppendLine("CONCORDIA ANIMATION COVERAGE");
            sb.AppendLine("Generated " + report.GeneratedAt);
            sb.AppendLine("Verbs " + report.VerbCount);
            sb.AppendLine();
            foreach (var slice in report.Slices)
            {
                var label = (slice.Name ?? "").PadRight(16);
                sb.Append(label).Append(Bar(slice.PercentRealOrProcedural));
                sb.Append("  real ").Append(slice.Real);
                sb.Append("  proc ").Append(slice.Procedural);
                sb.Append("  reused ").Append(slice.Reused);
                sb.Append("  missing ").Append(slice.Missing);
                sb.AppendLine();
            }
            sb.AppendLine();
            sb.AppendLine("HONESTY FAILURES");
            if (report.HonestyFailures.Count == 0) sb.AppendLine("(none)");
            else
                foreach (var f in report.HonestyFailures) sb.AppendLine("- " + f);
            sb.AppendLine();
            sb.AppendLine("IMMEDIATE PRIORITY");
            foreach (var id in new[]
            {
                "trav.dodge", "trav.dodge_roll", "trav.dodge_forward", "trav.dodge_left", "trav.dodge_right",
                "combat.light", "combat.heavy", "combat.light_2", "combat.light_3",
                "react.hit_front", "react.knockdown", "combat.sword.slash"
            })
                sb.Append(id.PadRight(22)).Append(AnimationVerbCatalog.StatusOf(id)).AppendLine();
            return sb.ToString();
        }
    }
}
