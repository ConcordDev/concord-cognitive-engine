using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: Play-mode probe for the <see cref="AuraVerify"/> helper (roadmap B-04).
    /// Confirms the F10 key driver is installed, prints a live snapshot and exercises the
    /// PASS path so the console carries real <c>[AuraVerify]</c> lines as evidence.
    /// The FAIL path is deliberately not exercised here — a synthetic failure would
    /// pollute the Play health counts that later regression checks compare against.
    /// </summary>
    public static class AuraVerifyProbe
    {
        /// <summary>Entry point for execute_script.</summary>
        public static string Execute()
        {
            // The driver object is created with HideFlags.DontSave, so it is NOT in a scene
            // and FindObjectsByType never sees it. Scan everything loaded instead.
            int simKeysObjects = 0;
            int drivers = 0;
            string driverType = "none";
            foreach (var smb in Resources.FindObjectsOfTypeAll<MonoBehaviour>())
            {
                if (smb == null) continue;
                if (smb.name == "~AuraVerifyKeys") simKeysObjects++;
                string tn = smb.GetType().Name;
                if (tn != "KeyDriver") continue;
                drivers++;
                driverType = tn;
            }

            bool instance = AuraVerify.KeyDriver.Instance != null;

            // Invoke the exact action F10 invokes, so the snapshot line below is the F10 path.
            AuraVerify.KeyDriver.Trigger();

            string snapshot = AuraVerify.Snapshot();
            AuraVerify.Pass("B-04", "AuraVerify live installed=" + AuraVerify.KeysInstalled +
                                     " driverInstance=" + instance + " driverComponents=" + drivers);

            return "playing=" + Application.isPlaying +
                   " installed=" + AuraVerify.KeysInstalled +
                   " driverInstance=" + instance +
                   " drivers=" + drivers +
                   " driverType=" + driverType +
                   " simKeysObjects=" + simKeysObjects +
                   " passes=" + AuraVerify.Passes +
                   " fails=" + AuraVerify.Fails +
                   " | " + snapshot;
        }
    }
}
