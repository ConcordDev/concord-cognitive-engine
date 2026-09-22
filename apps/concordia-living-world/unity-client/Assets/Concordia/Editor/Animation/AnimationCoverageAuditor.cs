using System.IO;
using Concordia.Animation;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Scans live controllers and FBX import types. Never promotes a reused or missing clip to Real.
    /// </summary>
    public static class AnimationCoverageAuditor
    {
        const string OutDir = "Assets/Concordia/Generated/Animation";
        const string ReportMd = OutDir + "/COVERAGE.md";
        const string ReportJson = OutDir + "/coverage.json";

        [MenuItem("Concordia/Animation/Audit Coverage")]
        public static void AuditMenu()
        {
            var report = Run();
            EditorUtility.DisplayDialog("Concordia Animation",
                "Verbs " + report.VerbCount + "\nHonesty failures " + report.HonestyFailures.Count +
                "\n\nWrote " + ReportMd, "OK");
        }

        public static AnimationCoverageReport Run()
        {
            var report = AnimationCoverage.Build();
            foreach (var binding in AnimationLiveBindings.ConcordiaLocomotion)
                AuditBinding(report, binding);
            foreach (var trap in AnimationLiveBindings.HonestyTraps)
                AuditBinding(report, trap);

            var ual = AnimationLiveBindings.QuaterniusUalFbx;
            var ualImp = AssetImporter.GetAtPath(ual) as ModelImporter;
            if (ualImp != null && ualImp.animationType != ModelImporterAnimationType.Human)
                report.HonestyFailures.Add("UAL1 is not imported as Humanoid; UAL1 clips cannot drive ConcordiaLocomotion.");
            else if (ualImp == null)
                report.HonestyFailures.Add("UAL1 FBX missing at " + ual);

            Directory.CreateDirectory(OutDir);
            File.WriteAllText(ReportMd, AnimationCoverage.FormatDashboard(report) + ExtraAssetNotes());
            File.WriteAllText(ReportJson, JsonUtility.ToJson(ToDto(report), true));
            AssetDatabase.Refresh();
            Debug.Log("[Concordia] Animation coverage written to " + ReportMd);
            return report;
        }

        static void AuditBinding(AnimationCoverageReport report, AnimationLiveBinding binding)
        {
            if (string.IsNullOrEmpty(binding.ClipPath)) return;
            var separator = binding.ClipPath.IndexOf("::", System.StringComparison.Ordinal);
            if (separator >= 0)
            {
                var modelPath = binding.ClipPath.Substring(0, separator);
                var clipName = binding.ClipPath.Substring(separator + 2);
                var found = false;
                foreach (var asset in AssetDatabase.LoadAllAssetsAtPath(modelPath))
                {
                    var clip = asset as AnimationClip;
                    if (clip != null && clip.name == clipName) { found = true; break; }
                }
                if (!found)
                    report.HonestyFailures.Add(binding.StateName + " UAL1 clip does not resolve: " + binding.ClipPath);
                return;
            }
            if (string.IsNullOrEmpty(binding.ClipGuid)) return;
            var path = AssetDatabase.GUIDToAssetPath(binding.ClipGuid);
            if (string.IsNullOrEmpty(path))
            {
                var msg = binding.StateName + " clip GUID " + binding.ClipGuid + " does not resolve.";
                if (!report.HonestyFailures.Contains(msg) &&
                    !report.HonestyFailures.Exists(f => f.Contains(binding.StateName)))
                    report.HonestyFailures.Add(msg);
            }
            else if (path.Replace('\\', '/') != binding.ClipPath.Replace('\\', '/') &&
                     binding.Status == AnimationCoverageStatus.Real)
            {
                report.HonestyFailures.Add(binding.StateName + " GUID resolves to " + path + " not " + binding.ClipPath);
            }
        }

        static string ExtraAssetNotes()
        {
            return "\nPIPELINE\n" +
                   "- Humanoid retargeting requires Avatar.isHuman && Avatar.isValid.\n" +
                   "- UAL1 Standard is imported as Humanoid and is bound through Mecanim sub-assets.\n" +
                   "- Grok Imagine MP4 is motion reference, never a Mecanim clip.\n" +
                   "- Gameplay timing remains authoritative; bound UAL1 clips provide the visible motion.\n";
        }

        [System.Serializable]
        class ReportDto
        {
            public string generatedAt;
            public int verbCount;
            public string[] honestyFailures;
            public SliceDto[] slices;
        }

        [System.Serializable]
        class SliceDto
        {
            public string name;
            public int total, real, procedural, reused, missing;
            public float percent;
        }

        static ReportDto ToDto(AnimationCoverageReport report)
        {
            var slices = new SliceDto[report.Slices.Count];
            for (var i = 0; i < report.Slices.Count; i++)
            {
                var s = report.Slices[i];
                slices[i] = new SliceDto
                {
                    name = s.Name, total = s.Total, real = s.Real, procedural = s.Procedural,
                    reused = s.Reused, missing = s.Missing, percent = s.PercentRealOrProcedural
                };
            }
            return new ReportDto
            {
                generatedAt = report.GeneratedAt,
                verbCount = report.VerbCount,
                honestyFailures = report.HonestyFailures.ToArray(),
                slices = slices
            };
        }
    }
}
