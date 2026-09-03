using System;
using UnityEngine;

namespace Concordia
{
    public enum WorldId
    {
    Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, Sere
}

    [Serializable]
    public class GateDef
    {
        public WorldId world;
        public string name;
        public string shortName;
        public string refusal;
        public string theNo;
        public Color color;
        public float angle;
    }

    [Serializable]
    public class GuestDef
    {
        public string id, name, title, line;
        public Color color;
        public float x, z, height;
    }

    [Serializable]
    public class StyleDef
    {
        public string id, name, light, heavy, special, power;
        public float massMul, speedMul, poiseMul;
    }

    [Serializable]
    public class WorldDef
    {
        public WorldId id;
        public string title, refusal, theNo, fantasy, traversal, combat, weather;
        public Color ground, sun;
        public StyleDef style;
        public string[] fauna;
        public bool steelLive;
        public string law;
    }

    /// <summary>
    /// Lore → law → mechanic. Port of bible.ts + content.ts + world-contract.ts.
    /// </summary>
    public static class Canon
    {
        public const float RingRadius = 34f;
        public const float CourtRadius = 16f;
        public const float WallRadius = 56f;
        public static readonly Vector3 Arena = new Vector3(0, 0, 18);
        public static readonly Vector3 Spawn = new Vector3(0, 0, -11);

        public static readonly GateDef[] Gates =
        {
            new GateDef { world = WorldId.Cyber, shortName = "CYBER", name = "The Grid", refusal = "Refusal of Numbers", theNo = "I will not be counted.", color = Hex("3dffa0"), angle = 0 },
            new GateDef { world = WorldId.Ruins, shortName = "RUINS", name = "Sovereign Ruins", refusal = "Refusal of Death", theNo = "We will not allow our ending to be final.", color = Hex("b89060"), angle = Mathf.PI / 4 },
            new GateDef { world = WorldId.Fantasy, shortName = "SUNDERING", name = "The Sundering", refusal = "Refusal of Hostility", theNo = "I will not become the thing destroying me.", color = Hex("3a8a5c"), angle = Mathf.PI / 2 },
            new GateDef { world = WorldId.Tunya, shortName = "TUNYA", name = "Tunya", refusal = "Refusal of Harvest", theNo = "We will not be reaped.", color = Hex("c8721a"), angle = 3 * Mathf.PI / 4 },
            new GateDef { world = WorldId.Frontier, shortName = "FRONTIER", name = "The Frontier", refusal = "Refusal of the Dome", theNo = "The road is our door.", color = Hex("4aa8ff"), angle = Mathf.PI },
            new GateDef { world = WorldId.Crime, shortName = "CRIME", name = "Crime World", refusal = "Refusal of Consequence", theNo = "What we do will not catch up to us.", color = Hex("8a6a48"), angle = 5 * Mathf.PI / 4 },
            new GateDef { world = WorldId.Superhero, shortName = "DAWN", name = "The Permanent Dawn", refusal = "Refusal of the Win", theNo = "I will not take the final victory.", color = Hex("3a78ff"), angle = 3 * Mathf.PI / 2 },
            new GateDef { world = WorldId.Crucible, shortName = "CRUCIBLE", name = "The Crucible", refusal = "The Eighth Refusal", theNo = "A thing that refuses completion cannot be written down.", color = Hex("20ffd0"), angle = 7 * Mathf.PI / 4 },
        };

        public static readonly GuestDef[] HubGuests =
        {
            new GuestDef { id = "lamplighter", name = "The Lamplighter", title = "Eastern path", line = "The hub is not a place between the worlds. It is the refusal to choose among them. You cannot own the heart.", color = Hex("c8b48a"), x = 10.2f, z = -6.4f, height = 1.72f },
            new GuestDef { id = "elias", name = "Elias Voss", title = "Anti-Sovereign", line = "He watches from a tower. I work two streets over. That's the whole war.", color = Hex("3d4a62"), x = -9.5f, z = 8.2f, height = 1.84f },
            new GuestDef { id = "vesper", name = "Vesper Kane", title = "Luminary", line = "I keep half this city fed. The other half I keep honest.", color = Hex("e8e4dc"), x = 7.2f, z = 9.1f, height = 1.78f },
            new GuestDef { id = "seraphine", name = "Lady Seraphine Voss", title = "Crimson Court", line = "We trade in blackmail dressed as etiquette. Do smile when you object.", color = Hex("6a2030"), x = 16.4f, z = 4.2f, height = 1.76f },
            new GuestDef { id = "jax", name = "Jax Rivera", title = "The Ghost", line = "Contracts from all eight. Loyalty from none.", color = Hex("2a241c"), x = -18.2f, z = -5.5f, height = 1.8f },
            new GuestDef { id = "mama", name = "Mama Iron Rose", title = "Delgado Syndicate", line = "The hub is mercy. Do not confuse it with softness.", color = Hex("5c3038"), x = 22.5f, z = 8.8f, height = 1.62f },
            new GuestDef { id = "zero", name = "Kael Nakamura", title = "Zero", line = "The Sovereign is the one thing that cannot be counted. I am studying the gap.", color = Hex("1a1028"), x = -22f, z = 2.4f, height = 1.86f },
            new GuestDef { id = "nyx", name = "Nyx Torres", title = "Blackout", line = "He counts. I organize the uncounted.", color = Hex("12121a"), x = -14.5f, z = -12.2f, height = 1.7f },
            new GuestDef { id = "thorne", name = "Thorne Blackroot", title = "The Sundering", line = "I carry a curse I could turn outward and win with. I refuse, every day.", color = Hex("1a3028"), x = 12.8f, z = -14.5f, height = 1.96f },
            new GuestDef { id = "lyra", name = "Lyra Silentchant", title = "Second hour", line = "I have not taught a ninth Refusal because it cannot be taught. It can only be walked into.", color = Hex("3a3850"), x = 5.5f, z = 14.8f, height = 1.68f },
            new GuestDef { id = "warden", name = "Arena Warden Gale", title = "Iron Wardens", line = "The Court forbids conquest. The sand does not. Poise, not luck.", color = Hex("6a6860"), x = 0, z = 18, height = 1.9f },
            new GuestDef { id = "asbir", name = "Asbir Thelane", title = "Lord Curator", line = "I keep three notebooks. One for facts. One for inferences. One for the difference.", color = Hex("8aa0b4"), x = -6.8f, z = -8.4f, height = 1.74f },
            new GuestDef { id = "brackish", name = "Brackish", title = "Plaza urchin", line = "If you stand still the Court will tell you a secret. If you run it will still be there.", color = Hex("6a5a40"), x = 3.2f, z = -8.8f, height = 1.42f },
            new GuestDef { id = "oldseam", name = "Old Seam", title = "Lantern path", line = "I have mended this street since before the gates had names. Walk soft.", color = Hex("7a6a58"), x = -11.2f, z = -4.1f, height = 1.58f },
        };

        /// <summary>
        /// Founding Day stand on the unpaved ring. Concordia at the warm apex,
        /// Concord facing her, the Sovereign with his back to both.
        /// Do not put "Concord admits he loves her" in anyone's mouth.
        /// </summary>
        public static readonly GuestDef[] Pillars =
        {
            new GuestDef { id = "concordia", name = "Concordia", title = "The First Breath", line = "This ground is mine. Walk it. You cannot own the heart.", color = Hex("c8721a"), x = 0f, z = -6.4f, height = 1.78f },
            new GuestDef { id = "concord", name = "Concord", title = "The First Law", line = "I am measuring. That is enough.", color = Hex("8aa0b4"), x = 0f, z = 6.2f, height = 1.82f },
            new GuestDef { id = "sovereign", name = "The Sovereign", title = "The First Refusal", line = "…", color = Hex("2a1c14"), x = 8.6f, z = 0.3f, height = 1.94f },
        };

        public static WorldDef Hub => Get(WorldId.Hub);

        public static WorldDef Get(WorldId id)
        {
            switch (id)
            {
                case WorldId.Hub:
                    return new WorldDef { id = id, title = "The Unburned Court", refusal = "You cannot own the heart.", theNo = "I refuse to let my own refusal win.", fantasy = "court and lanterns", traversal = "plaza walk", combat = "unarmed court", weather = "clear", ground = Hex("c4b49a"), sun = Hex("ffe6c0"), steelLive = false, law = "No live steel in the Court. Blades die as flowers except in the Arena.", style = S("court", "Unarmed Court", "Palm", "Shoulder", "Flower-step", "Lantern step", 1.35f, 1.08f, 1.25f), fauna = Array.Empty<string>() };
                case WorldId.Ruins:
                    return new WorldDef { id = id, title = "Sovereign Ruins", refusal = "We will not allow our ending to be final.", theNo = "Nothing here has finished.", fantasy = "death that will not finish", traversal = "ruins climb, ash roads", combat = "heavy remnant", weather = "ash", ground = Hex("5a5044"), sun = Hex("c8a070"), steelLive = true, law = "Death is unstable. Catalogue, do not conquer.", style = S("keepers", "Glyph Keepers", "Ash cut", "Unburial", "Refuse ending", "Pull a fall back", 1.2f, 0.9f, 1.35f), fauna = new[] { "wraith", "wolf", "griffin" } };
                case WorldId.Tunya:
                    return new WorldDef { id = id, title = "Tunya", refusal = "We will not be reaped.", theNo = "Take fruit, not the tree.", fantasy = "soil that answers", traversal = "grove and mesa", combat = "living wood", weather = "grove", ground = Hex("6a7a3a"), sun = Hex("f0d080"), steelLive = true, law = "Grove restores poise if you are not striking.", style = S("veil", "Verdant Veil", "Reed", "Grove-root", "Do not reap", "Pollen ward", 1f, 1.05f, 1.2f), fauna = new[] { "sealie", "hound", "harpy" } };
                case WorldId.Fantasy:
                    return new WorldDef { id = id, title = "The Sundering", refusal = "I will not become the thing destroying me.", theNo = "Winning with the curse is becoming the dragon.", fantasy = "held curse", traversal = "wild climb", combat = "ward steel", weather = "clear", ground = Hex("3a6a48"), sun = Hex("88d0a0"), steelLive = true, law = "Hostility turns inward — your own poise pays the curse.", style = S("sundering", "Sundering Guard", "Ward-blade", "Curse-held", "Turn it inward", "Curse-fold", 1.1f, 1f, 1f), fauna = new[] { "wolf", "griffin", "basilisk" } };
                case WorldId.Crime:
                    return new WorldDef { id = id, title = "Crime World", refusal = "What we do will not catch up to us.", theNo = "Delay is not cancellation.", fantasy = "heat and witnesses", traversal = "streets and roofs", combat = "close knives", weather = "rain", ground = Hex("3a342c"), sun = Hex("887060"), steelLive = true, law = "The bill always arrives. Witnesses remember.", style = S("ghost", "Ghost Contracts", "Switch", "Iron", "Delay the bill", "Invoice", 0.95f, 1.15f, 0.85f), fauna = new[] { "hound", "drone" } };
                case WorldId.Cyber:
                    return new WorldDef { id = id, title = "The Grid", refusal = "I will not be counted.", theNo = "Identity is terrain.", fantasy = "identity as terrain", traversal = "parkour infrastructure", combat = "drone and pulse", weather = "neon", ground = Hex("1a1228"), sun = Hex("c45aa8"), steelLive = true, law = "Damage hides until you let it exist.", style = S("zero", "Uncounted", "Pulse", "Stack overflow", "Refuse the number", "Null flush", 0.9f, 1.2f, 0.9f), fauna = new[] { "drone", "sentinel", "construct" } };
                case WorldId.Frontier:
                    return new WorldDef { id = id, title = "The Frontier", refusal = "The road is our door.", theNo = "No dome means no shelter.", fantasy = "roads between refusals", traversal = "wagon and wind", combat = "open range", weather = "wind", ground = Hex("c8b070"), sun = Hex("ffe8b0"), steelLive = true, law = "Drop the dome; wind will do the rest.", style = S("road", "Open Road", "Dust-kick", "Wagon iron", "Leave the dome", "Dust sprint", 1.05f, 1.25f, 1f), fauna = new[] { "hound", "wolf" } };
                case WorldId.Superhero:
                    return new WorldDef { id = id, title = "The Permanent Dawn", refusal = "I will not take the final victory.", theNo = "If I win this sunrise I become the Luminary.", fantasy = "height as verb", traversal = "vertical city", combat = "impact", weather = "dawn", ground = Hex("4a5870"), sun = Hex("ffd0a0"), steelLive = true, law = "Mercy. They stand. The dawn does not end.", style = S("dawn", "Permanent Dawn", "Fist", "Shockwave", "Refuse the win", "Mercy shock", 1.3f, 1.1f, 1.4f), fauna = new[] { "drone", "sentinel" } };
                case WorldId.Sere:
                    return new WorldDef { id = id, title = "Sere", refusal = "No Refusal ever held here.", theNo = "Every attempt to build outside the machine was bought, hollowed, or crushed.", fantasy = "extraction that outlived its authors", traversal = "spire and furnace belt", combat = "close and paid-for", weather = "smog", ground = Hex("3a3428"), sun = Hex("c8a060"), steelLive = true, law = "The Mark is the only law that compounds. Live steel is allowed. Flower-law is the Court only.", style = S("tessera", "Tessera Hold", "Invoice", "Clearing", "Name the holder", "Broken tile", 1.05f, 1.05f, 0.95f), fauna = new[] { "hound", "drone" } };
                case WorldId.Crucible:
                    return new WorldDef { id = id, title = "The Crucible", refusal = "A system that refuses to close can never rest.", theNo = "There is no ninth.", fantasy = "rules that refuse to stay", traversal = "unstable ground", combat = "drift", weather = "drift", ground = Hex("204040"), sun = Hex("20ffd0"), steelLive = true, law = "If it would end, un-end it.", style = S("drift", "Open Lattice", "Shard", "Recycle", "Refuse completion", "Un-end", 1.15f, 1f, 1.1f), fauna = new[] { "drift", "wraith", "construct" } };
                default:
                    return new WorldDef { id = WorldId.Crucible, title = "The Crucible", refusal = "A system that refuses to close can never rest.", theNo = "There is no ninth.", fantasy = "rules that refuse to stay", traversal = "unstable ground", combat = "drift", weather = "drift", ground = Hex("204040"), sun = Hex("20ffd0"), steelLive = true, law = "If it would end, un-end it.", style = S("drift", "Open Lattice", "Shard", "Recycle", "Refuse completion", "Un-end", 1.15f, 1f, 1.1f), fauna = new[] { "drift", "wraith", "construct" } };
            }
        }

        public static bool InArena(Vector3 p) => Vector3.Distance(new Vector3(p.x, 0, p.z), Arena) < 8f;

        public static bool SteelLive(WorldId world, Vector3 p)
        {
            if (world != WorldId.Hub) return true;
            return InArena(p);
        }

        public static Color Hex(string h)
        {
            if (!ColorUtility.TryParseHtmlString("#" + h, out var c)) return Color.white;
            return c;
        }

        static StyleDef S(string id, string name, string light, string heavy, string special, string power, float m, float s, float p) =>
            new StyleDef { id = id, name = name, light = light, heavy = heavy, special = special, power = power, massMul = m, speedMul = s, poiseMul = p };
    }
}
