#if UNITY_EDITOR
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEngine;

/// <summary>
/// REQUEST-HUB-AERIAL file or menu → CourtGroundDress.CaptureHubAerialStill (runtime still path).
/// </summary>
[InitializeOnLoad]
static class HubAerialOneShot
{
    const string RequestName = "REQUEST-HUB-AERIAL";
    static double _nextCheck;
    static int _waits;

    static HubAerialOneShot()
    {
        EditorApplication.update += Tick;
    }

    static string RemainingWork =>
        Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile),
            ".zuko", "remaining-work");

    static void Tick()
    {
        if (EditorApplication.timeSinceStartup < _nextCheck) return;
        _nextCheck = EditorApplication.timeSinceStartup + 0.75;
        if (!EditorApplication.isPlaying || EditorApplication.isCompiling || EditorApplication.isUpdating)
            return;
        string req = Path.Combine(RemainingWork, RequestName);
        if (!File.Exists(req)) return;

        int lean = CountLean();
        if (lean < 6)
        {
            _waits++;
            if (_waits % 8 == 0) Debug.Log("[Concordia] HubAerialOneShot waiting lean=" + lean);
            if (_waits > 100)
            {
                try { File.Delete(req); } catch { }
                File.WriteAllText(Path.Combine(RemainingWork, "HUB-AERIAL-FAIL.txt"), "timeout lean=" + lean);
            }
            return;
        }

        try { File.Delete(req); } catch { }
        string result = InvokeCapture();
        File.WriteAllText(Path.Combine(RemainingWork, "HUB-AERIAL-DONE.txt"), result + "\n" + System.DateTime.Now);
        Debug.Log("[Concordia] HubAerialOneShot " + result);
    }

    static int CountLean()
    {
        int n = 0;
        foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude))
        {
            if (t && t.name != null && t.name.StartsWith("LeanBuilding_", System.StringComparison.Ordinal))
                n++;
        }
        return n;
    }

    static string InvokeCapture()
    {
        var t = typeof(Concordia.CourtGroundDress);
        var m = t.GetMethod("CaptureHubAerialStill", BindingFlags.Public | BindingFlags.Static);
        if (m == null) return "NO_METHOD CaptureHubAerialStill";
        return (string)m.Invoke(null, new object[] { RemainingWork });
    }

    [MenuItem("Concordia/Capture Hub Aerial Now")]
    static void MenuCapture()
    {
        if (!EditorApplication.isPlaying)
        {
            Debug.LogWarning("[Concordia] Enter Play first.");
            return;
        }
        string result = InvokeCapture();
        Debug.Log("[Concordia] Menu aerial " + result);
        File.WriteAllText(Path.Combine(RemainingWork, "HUB-AERIAL-DONE.txt"), result + "\n" + System.DateTime.Now);
        var png = Path.Combine(RemainingWork, "HUB-AERIAL-2026-09-20.png");
        if (File.Exists(png)) EditorUtility.RevealInFinder(png);
    }
}
#endif
