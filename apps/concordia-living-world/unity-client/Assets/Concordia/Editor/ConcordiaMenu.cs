using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
namespace Concordia.Editor
{
    public static class ConcordiaMenu
    {
        [MenuItem("Concordia/Build Hub Scene")]
        public static void BuildHubScene()
        {
            BuildHubSceneSilent();
            EditorUtility.DisplayDialog("Concordia", "Hub scene is ready.\n\nPress the Play button (top center).\nRMB = look  ·  WASD = walk  ·  LMB in Court = flowers  ·  north sand circle = live steel  ·  E on a colored door to travel.", "Got it");
        }

        public static void BuildHubSceneSilent()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var light = new GameObject("Directional Light");
            var l = light.AddComponent<Light>();
            l.type = LightType.Directional;
            l.color = new Color(1f, 0.9f, 0.75f);
            light.transform.rotation = Quaternion.Euler(42, 40, 0);
            RenderSettings.ambientLight = new Color(0.45f, 0.4f, 0.35f);

            var go = new GameObject("ConcordiaGame");
            go.AddComponent<ConcordiaGame>();

            System.IO.Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/ConcordiaHub.unity");
            var scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/ConcordiaHub.unity", true) };
            EditorBuildSettings.scenes = scenes;
            Debug.Log("Concordia hub scene saved. Press Play.");
        }

        [MenuItem("Concordia/Focus Game View")]
        public static void FocusGame()
        {
            EditorApplication.ExecuteMenuItem("Window/General/Game");
        }
    }
}
