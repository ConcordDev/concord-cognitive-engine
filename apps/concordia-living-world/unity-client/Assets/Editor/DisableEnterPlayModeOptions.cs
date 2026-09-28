#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

[InitializeOnLoad]
static class DisableEnterPlayModeOptions
{
    static DisableEnterPlayModeOptions()
    {
        EditorApplication.delayCall += Apply;
    }

    static void Apply()
    {
        if (!EditorSettings.enterPlayModeOptionsEnabled
            && EditorSettings.enterPlayModeOptions == EnterPlayModeOptions.None)
            return;
        EditorSettings.enterPlayModeOptionsEnabled = false;
        EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.None;
        Debug.Log("[Concordia] InitializeOnLoad: Enter Play Mode Options forced OFF");
    }
}
#endif
