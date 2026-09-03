using System;
using System.IO;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Saved look. First boot has no file — CharacterCreator must run.
    /// </summary>
    [Serializable]
    public class Appearance
    {
        public string displayName = "Walker";
        public float height = 1f;
        public float width = 1f;
        public float shoulders = 1f;
        public float chest = 1f;
        public float hips = 1f;
        public float head = 1f;
        public float jaw = 1f;
        public float brow = 0.5f;
        public float nose = 0.5f;
        public float skin = 0.45f;
        public float hairHue = 0.08f;
        public float hairSat = 0.42f;
        public float hairVal = 0.16f;
        public int hairStyle;
        public float eyeHue = 0.58f;
        public float eyeVal = 0.38f;
        public int outfit;
        public int walkStyle;
        public int attitude;
        public float voice = 0.5f;

        public static readonly string[] HairNames = { "Crop", "Short", "Sweep", "Bun", "Long", "Topknot" };
        public static readonly string[] OutfitNames = { "Court linen", "Bronze traveler", "Grid runner", "Frontier duster", "Crimson court", "Night market" };
        public static readonly string[] WalkNames = { "Neutral", "Confident", "Cautious", "Heavy", "Light" };
        public static readonly string[] AttitudeNames = { "Calm", "Wry", "Stern", "Warm" };

        static readonly Color[] SkinRamp =
        {
            new Color(0.18f, 0.11f, 0.08f),
            new Color(0.32f, 0.18f, 0.12f),
            new Color(0.48f, 0.30f, 0.20f),
            new Color(0.66f, 0.44f, 0.30f),
            new Color(0.80f, 0.58f, 0.42f),
            new Color(0.90f, 0.72f, 0.56f),
            new Color(0.96f, 0.82f, 0.70f),
            new Color(0.99f, 0.90f, 0.82f)
        };

        public Color SkinColor()
        {
            float t = Mathf.Clamp01(skin) * (SkinRamp.Length - 1);
            int i = Mathf.FloorToInt(t);
            int j = Mathf.Min(i + 1, SkinRamp.Length - 1);
            return Color.Lerp(SkinRamp[i], SkinRamp[j], t - i);
        }

        public Color HairColor() => Color.HSVToRGB(Mathf.Repeat(hairHue, 1f), Mathf.Clamp01(hairSat), Mathf.Clamp01(hairVal));
        public Color EyeColor() => Color.HSVToRGB(Mathf.Repeat(eyeHue, 1f), 0.55f, Mathf.Lerp(0.18f, 0.7f, eyeVal));

        public Color ShirtColor()
        {
            switch (Mathf.Clamp(outfit, 0, 5))
            {
                case 1: return new Color(0.55f, 0.32f, 0.16f);
                case 2: return new Color(0.10f, 0.22f, 0.24f);
                case 3: return new Color(0.28f, 0.20f, 0.12f);
                case 4: return new Color(0.42f, 0.10f, 0.14f);
                case 5: return new Color(0.12f, 0.12f, 0.16f);
                default: return new Color(0.82f, 0.74f, 0.60f);
            }
        }

        public Color PantsColor()
        {
            switch (Mathf.Clamp(outfit, 0, 5))
            {
                case 1: return new Color(0.18f, 0.14f, 0.10f);
                case 2: return new Color(0.08f, 0.10f, 0.12f);
                case 3: return new Color(0.22f, 0.16f, 0.10f);
                case 4: return new Color(0.12f, 0.08f, 0.08f);
                case 5: return new Color(0.14f, 0.12f, 0.10f);
                default: return new Color(0.28f, 0.22f, 0.16f);
            }
        }

        public Color TrimColor()
        {
            switch (Mathf.Clamp(outfit, 0, 5))
            {
                case 1: return new Color(0.72f, 0.48f, 0.22f);
                case 2: return new Color(0.25f, 0.95f, 0.55f);
                case 3: return new Color(0.45f, 0.70f, 0.95f);
                case 4: return new Color(0.75f, 0.22f, 0.28f);
                case 5: return new Color(0.85f, 0.62f, 0.22f);
                default: return new Color(0.62f, 0.42f, 0.22f);
            }
        }

        public bool HasCoat => outfit == 3 || outfit == 4 || outfit == 1;
        public bool HasSash => outfit == 0 || outfit == 4 || outfit == 5;

        public string VoiceLine()
        {
            switch (Mathf.Clamp(attitude, 0, 3))
            {
                case 1: return "A wry mouth. The Court will hear it.";
                case 2: return "Stern. You did not come here to be owned.";
                case 3: return "Warm enough to pass for mercy.";
                default: return "Quiet. The hub was already here.";
            }
        }

        public static Appearance Random(int seed)
        {
            var rng = new System.Random(seed);
            float R() => (float)rng.NextDouble();
            return new Appearance
            {
                displayName = "Citizen",
                height = Mathf.Lerp(0.9f, 1.12f, R()),
                width = Mathf.Lerp(0.86f, 1.18f, R()),
                shoulders = Mathf.Lerp(0.88f, 1.2f, R()),
                chest = Mathf.Lerp(0.9f, 1.18f, R()),
                hips = Mathf.Lerp(0.88f, 1.16f, R()),
                head = Mathf.Lerp(0.92f, 1.1f, R()),
                jaw = Mathf.Lerp(0.85f, 1.2f, R()),
                brow = R(),
                nose = R(),
                skin = R(),
                hairHue = R(),
                hairSat = Mathf.Lerp(0.15f, 0.7f, R()),
                hairVal = Mathf.Lerp(0.08f, 0.45f, R()),
                hairStyle = rng.Next(0, HairNames.Length),
                eyeHue = R(),
                eyeVal = Mathf.Lerp(0.25f, 0.75f, R()),
                outfit = rng.Next(0, OutfitNames.Length),
                walkStyle = rng.Next(0, WalkNames.Length),
                attitude = rng.Next(0, AttitudeNames.Length),
                voice = R()
            };
        }
    }

    public static class AppearanceStore
    {
        public const string PrefsKey = "concordia.appearance.v1";
        public static string FilePath => Path.Combine(Application.persistentDataPath, "concordia_appearance.json");

        public static bool HasSaved
        {
            get
            {
                if (PlayerPrefs.GetInt(PrefsKey, 0) == 1 && File.Exists(FilePath)) return true;
                return File.Exists(FilePath);
            }
        }

        public static Appearance Load()
        {
            try
            {
                if (File.Exists(FilePath))
                {
                    var json = File.ReadAllText(FilePath);
                    var a = JsonUtility.FromJson<Appearance>(json);
                    if (a != null) return a;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning("Appearance load failed: " + e.Message);
            }
            return new Appearance();
        }

        public static void Save(Appearance a)
        {
            if (a == null) a = new Appearance();
            var json = JsonUtility.ToJson(a, true);
            try
            {
                File.WriteAllText(FilePath, json);
            }
            catch (Exception e)
            {
                Debug.LogWarning("Appearance save failed: " + e.Message);
            }
            PlayerPrefs.SetInt(PrefsKey, 1);
            PlayerPrefs.SetString(PrefsKey + ".json", json);
            PlayerPrefs.Save();
        }

        public static void Clear()
        {
            PlayerPrefs.DeleteKey(PrefsKey);
            try { if (File.Exists(FilePath)) File.Delete(FilePath); } catch { }
        }
    }
}
