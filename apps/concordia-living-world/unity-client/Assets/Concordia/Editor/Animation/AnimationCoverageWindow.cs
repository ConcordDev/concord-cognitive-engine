using Concordia.Animation;
using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    public sealed class AnimationCoverageWindow : EditorWindow
    {
        AnimationCoverageReport _report;
        Vector2 _scroll;

        [MenuItem("Concordia/Animation/Coverage Dashboard")]
        public static void Open()
        {
            var w = GetWindow<AnimationCoverageWindow>("Anim Coverage");
            w.minSize = new Vector2(420, 320);
            w.Refresh();
        }

        void Refresh() => _report = AnimationCoverage.Build();

        void OnGUI()
        {
            if (_report == null) Refresh();
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Refresh", GUILayout.Width(80))) Refresh();
            if (GUILayout.Button("Write report", GUILayout.Width(110)))
            {
                AnimationCoverageAuditor.Run();
                Refresh();
            }
            EditorGUILayout.LabelField("verbs " + (_report != null ? _report.VerbCount : 0));
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.HelpBox(
                "Imagine video is reference only. Humanoid retargets with a valid Avatar. Creatures stay Generic.",
                MessageType.Info);

            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            if (_report != null)
            {
                foreach (var slice in _report.Slices)
                {
                    var usable = slice.PercentRealOrProcedural;
                    EditorGUILayout.LabelField(slice.Name, AnimationCoverage.Bar(usable, 24));
                    EditorGUI.ProgressBar(
                        EditorGUILayout.GetControlRect(false, 8f),
                        Mathf.Clamp01(usable / 100f),
                        "");
                }
                EditorGUILayout.Space();
                EditorGUILayout.LabelField("Honesty", EditorStyles.boldLabel);
                foreach (var f in _report.HonestyFailures)
                    EditorGUILayout.HelpBox(f, MessageType.Warning);
            }
            EditorGUILayout.EndScrollView();
        }
    }
}
