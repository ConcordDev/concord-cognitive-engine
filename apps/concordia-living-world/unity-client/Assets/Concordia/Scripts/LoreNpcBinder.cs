using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.WorldSystems;

namespace Concordia
{
    /// <summary>
    /// Bound lore identity on a spawned ModularPerson — sparks, inventory id, gear stems.
    /// Generated from authored WorldBook.Person fields; never invents a second NPC.
    /// </summary>
    public sealed class NpcLoreIdentity : MonoBehaviour
    {
        public string personId;
        public string factionId;
        public string archetype;
        public int sparks;
        public string inventoryId;
        public string primaryWeapon;
        public string offhand;
        public string backGear;
        public string[] inventoryItems;
        public string lookSummary;

        public string SparkLine => sparks + " sparks";
    }

    /// <summary>
    /// Turns authored Canon NPC lore into Appearance, unique gear, inventory, and spark wallets.
    /// Deterministic per person id. Extends PersonKit / CharacterGear / WorldSystemsEconomy —
    /// does not invent a parallel people system.
    /// </summary>
    public static class LoreNpcBinder
    {
        public const string SparksResource = "sparks";

        public struct Kit
        {
            public Appearance Look;
            public string PrimaryWeapon;
            public string Offhand;
            public string BackGear;
            public int Sparks;
            public string[] InventoryItems;
            public string InventoryId;
            public string LookSummary;
        }

        public static Kit Build(WorldId world, WorldBook.Person person, WorldBook.Faction faction, int salt)
        {
            var kit = new Kit();
            if (person == null)
            {
                kit.Look = Appearance.Random(salt);
                kit.Sparks = 10;
                kit.InventoryItems = Array.Empty<string>();
                kit.InventoryId = "npc-inventory/unknown";
                return kit;
            }

            var seed = StableHash(person.id ?? person.name ?? ("npc-" + salt));
            kit.Look = LookFromLore(world, person, faction, seed);
            kit.PrimaryWeapon = WeaponFromLore(person, faction, seed);
            kit.Offhand = OffhandFromLore(person, faction, seed);
            kit.BackGear = BackFromLore(person, seed);
            kit.Sparks = SparksFromLore(person, faction, seed);
            kit.InventoryItems = InventoryFromLore(person, faction, seed);
            kit.InventoryId = "npc-inventory/" + WorldBook.Folder(world) + "/" +
                              (string.IsNullOrEmpty(person.id) ? SettlementId.Normalize(person.name) : person.id);
            kit.LookSummary = Summarize(person, kit);
            return kit;
        }

        /// <summary>Apply kit to an already-spawned body and register economy inventory.</summary>
        public static NpcLoreIdentity Bind(GameObject go, WorldId world, WorldBook.Person person,
                                           WorldBook.Faction faction, int salt,
                                           WorldSystemsEconomyService economy = null)
        {
            if (!go || person == null) return null;
            var kit = Build(world, person, faction, salt);
            var personBody = go.GetComponentInChildren<ModularPerson>() ?? go.GetComponent<ModularPerson>();
            if (personBody != null)
                personBody.Apply(kit.Look);

            CharacterGear.ClearSlot(CharacterGear.Socket(go, personBody, CharacterGear.Slot.HandR));
            CharacterGear.ClearSlot(CharacterGear.Socket(go, personBody, CharacterGear.Slot.HandL));
            CharacterGear.ClearSlot(CharacterGear.Socket(go, personBody, CharacterGear.Slot.Back));
            // Owner-flagged 2026-09-21: NPCs used to hand-equip PrimaryWeapon
            // permanently (Slot.HandR, every frame, forever) — nobody stands
            // around with a drawn blade at rest, and it's what made the idle
            // arm-behind-back pose read as a floating weapon. Sheathe on the
            // back by default, same slot/pattern CxDress.HeroKit already uses
            // for the player. Offhand (shields) still hand-mounts — a shield
            // strapped to the forearm reads fine at rest; only edged weapons
            // needed this fix. Drawing on actual attack is future work.
            if (!string.IsNullOrEmpty(kit.PrimaryWeapon))
                CharacterGear.Equip(go, kit.PrimaryWeapon, CharacterGear.Slot.Back, WeaponSize(kit.PrimaryWeapon));
            if (!string.IsNullOrEmpty(kit.Offhand))
                CharacterGear.Attach(go, kit.Offhand, false, 0.75f);
            if (!string.IsNullOrEmpty(kit.BackGear))
                CharacterGear.Equip(go, kit.BackGear, CharacterGear.Slot.Back, 0.9f);

            if (faction?.visual != null && !string.IsNullOrEmpty(faction.visual.primary_color)
                && ColorUtility.TryParseHtmlString(faction.visual.primary_color, out var sash))
                ModularPerson.StampSash(go, sash);

            var id = go.GetComponent<NpcLoreIdentity>() ?? go.AddComponent<NpcLoreIdentity>();
            id.personId = person.id;
            id.factionId = person.faction_id;
            id.archetype = person.archetype;
            id.sparks = kit.Sparks;
            id.inventoryId = kit.InventoryId;
            id.primaryWeapon = kit.PrimaryWeapon;
            id.offhand = kit.Offhand;
            id.backGear = kit.BackGear;
            id.inventoryItems = kit.InventoryItems;
            id.lookSummary = kit.LookSummary;

            RegisterEconomy(economy, world, person, kit);
            return id;
        }

        static void RegisterEconomy(WorldSystemsEconomyService economy, WorldId world,
                                    WorldBook.Person person, Kit kit)
        {
            if (economy == null)
            {
                try { economy = WorldSystemsEconomyService.ForActiveHost(); }
                catch { economy = null; }
            }
            if (economy == null) return;

            var inv = new WorldSystemsInventoryContract
            {
                inventoryId = kit.InventoryId,
                ownerId = person.id ?? person.name,
                settlementId = SettlementHint(world, person),
                capacity = 64f
            };
            inv.resources.Add(new WorldSystemsResourceStack(SparksResource, kit.Sparks));
            if (kit.InventoryItems != null)
            {
                foreach (var item in kit.InventoryItems)
                {
                    if (string.IsNullOrEmpty(item)) continue;
                    inv.resources.Add(new WorldSystemsResourceStack(item, 1f));
                }
            }
            economy.RegisterInventory(inv);

            // Seed a sparks market once so trade can clear.
            economy.RegisterMarket(new WorldSystemsMarketContract
            {
                storefrontId = "market/" + WorldBook.Folder(world) + "/sparks",
                resourceId = SparksResource,
                basePrice = 1f,
                targetStock = 40f,
                minimumPrice = 0.25f,
                maximumPrice = 12f
            });
        }

        static string SettlementHint(WorldId world, WorldBook.Person person)
        {
            var city = CityAtlas.ForPerson(world, person);
            if (city != null && !string.IsNullOrEmpty(city.id))
                return "settlement/" + WorldBook.Folder(world) + "/" + city.id;
            return WorldBook.Folder(world) + "/arrival";
        }

        public static Appearance LookFromLore(WorldId world, WorldBook.Person person,
                                              WorldBook.Faction faction, int seed)
        {
            var look = Appearance.Random(seed);
            look.displayName = person.name ?? "Walker";
            var text = ((person.appearance ?? "") + " " + (person.personality ?? "") + " " +
                        (person.archetype ?? "") + " " + (person.title ?? "")).ToLowerInvariant();

            if (Contains(text, "tall", "towering", "long-limbed")) look.height = 1.08f + (seed % 7) * 0.01f;
            else if (Contains(text, "short", "compact", "small")) look.height = 0.90f + (seed % 5) * 0.01f;
            else look.height = 0.96f + (seed % 11) * 0.01f;

            if (Contains(text, "muscled", "broad", "stocky", "heavy"))
            {
                look.width = 1.08f;
                look.shoulders = 1.12f;
                look.chest = 1.1f;
                look.walkStyle = 3;
            }
            else if (Contains(text, "slim", "slight", "lean", "wiry"))
            {
                look.width = 0.92f;
                look.shoulders = 0.94f;
                look.chest = 0.94f;
                look.walkStyle = 4;
            }

            if (Contains(text, "shaved", "bald", "crop")) look.hairStyle = 0;
            else if (Contains(text, "braid", "braided", "plait")) look.hairStyle = 5;
            else if (Contains(text, "bun", "knot")) look.hairStyle = 3;
            else if (Contains(text, "long hair", "long dark", "cascade")) look.hairStyle = 4;
            else look.hairStyle = seed % Appearance.HairNames.Length;

            if (Contains(text, "scar", "burn", "stern", "warlord", "guard")) look.attitude = 2;
            else if (Contains(text, "warm", "kind", "healer", "laugh")) look.attitude = 3;
            else if (Contains(text, "wry", "dry", "gallows")) look.attitude = 1;
            else look.attitude = seed % 4;

            look.outfit = OutfitFrom(world, person, faction, text, seed);
            look.skin = SkinFrom(text, seed);
            look.hairHue = HairHueFrom(text, seed);
            look.hairSat = Contains(text, "grey", "silver", "white hair") ? 0.08f : 0.35f + (seed % 20) * 0.01f;
            look.hairVal = Contains(text, "dark hair", "black hair") ? 0.12f : 0.2f + (seed % 40) * 0.01f;
            return look;
        }

        static int OutfitFrom(WorldId world, WorldBook.Person person, WorldBook.Faction faction,
                              string text, int seed)
        {
            if (Contains(text, "court", "linen", "diplomat", "ambassador")) return 0;
            if (Contains(text, "bronze", "traveler", "courier", "scout")) return 1;
            if (Contains(text, "grid", "neon", "runner", "chrome")) return 2;
            if (Contains(text, "duster", "frontier", "dust", "coat")) return 3;
            if (Contains(text, "crimson", "warlord", "blood", "fire", "sanguire")) return 4;
            if (Contains(text, "night", "market", "shadow", "noir", "fixer")) return 5;
            if (faction?.visual != null && !string.IsNullOrEmpty(faction.visual.architecture_style))
            {
                var arch = faction.visual.architecture_style.ToLowerInvariant();
                if (arch.Contains("obsidian") || arch.Contains("spire")) return 4;
                if (arch.Contains("ice") || arch.Contains("stepped")) return 0;
                if (arch.Contains("industrial") || arch.Contains("neon")) return 2;
                if (arch.Contains("longhouse") || arch.Contains("hide")) return 3;
            }
            return world switch
            {
                WorldId.Cyber => 2,
                WorldId.Crime => 5,
                WorldId.Frontier => 3,
                WorldId.Fantasy => 1,
                WorldId.Tunya => Contains(text, "forge", "fire") ? 4 : 1,
                WorldId.Hub => 0,
                _ => seed % 6
            };
        }

        static float SkinFrom(string text, int seed)
        {
            if (Contains(text, "dark", "deep brown", "ebony")) return 0.18f + (seed % 8) * 0.01f;
            if (Contains(text, "pale", "ashen", "fair", "ice")) return 0.78f + (seed % 10) * 0.01f;
            if (Contains(text, "olive", "tan", "sun")) return 0.48f + (seed % 10) * 0.01f;
            return 0.35f + (seed % 45) * 0.01f;
        }

        static float HairHueFrom(string text, int seed)
        {
            if (Contains(text, "red hair", "copper", "auburn", "fire hair")) return 0.02f;
            if (Contains(text, "blonde", "gold hair", "fair hair")) return 0.12f;
            if (Contains(text, "white hair", "silver hair", "grey")) return 0.0f;
            if (Contains(text, "blue hair", "dyed")) return 0.58f;
            return 0.05f + (seed % 30) * 0.01f;
        }

        public static string WeaponFromLore(WorldBook.Person person, WorldBook.Faction faction, int seed)
        {
            var text = ((person?.appearance ?? "") + " " + (person?.title ?? "") + " " +
                        (person?.archetype ?? "")).ToLowerInvariant();
            if (Contains(text, "greatsword", "great sword")) return PersonKit.MapWeapon("greatsword");
            if (Contains(text, "spear", "lance")) return PersonKit.MapWeapon("spear");
            if (Contains(text, "staff", "wand")) return PersonKit.MapWeapon(Contains(text, "wand") ? "wand" : "staff");
            if (Contains(text, "dagger", "knife", "blade")) return PersonKit.MapWeapon("dagger");
            if (Contains(text, "axe")) return PersonKit.MapWeapon("axe");
            if (Contains(text, "bow", "archer")) return PersonKit.MapWeapon("bow");
            if (Contains(text, "mace", "hammer")) return PersonKit.MapWeapon("mace");
            if (Contains(text, "sword")) return PersonKit.MapWeapon("sword");
            return PersonKit.WeaponStem(faction, seed);
        }

        static string OffhandFromLore(WorldBook.Person person, WorldBook.Faction faction, int seed)
        {
            var text = ((person?.appearance ?? "") + " " + (person?.archetype ?? "")).ToLowerInvariant();
            var arch = (person?.archetype ?? "").ToLowerInvariant();
            if (Contains(text, "shield") || arch is "warrior" or "warlord" or "guard")
                return PersonKit.MapWeapon("shield");
            if (arch is "healer" or "mystic" or "scholar")
                return null;
            if (faction?.visual?.preferred_weapon_archetypes != null)
            {
                foreach (var w in faction.visual.preferred_weapon_archetypes)
                    if ((w ?? "").ToLowerInvariant().Contains("shield"))
                        return PersonKit.MapWeapon("shield");
            }
            return (seed % 5 == 0) ? PersonKit.MapWeapon("dagger") : null;
        }

        static string BackFromLore(WorldBook.Person person, int seed)
        {
            var arch = (person?.archetype ?? "").ToLowerInvariant();
            if (arch is "trader" or "merchant" or "courier") return "bag";
            if (arch is "scholar" or "curator") return "bag";
            if (Contains((person?.appearance ?? "").ToLowerInvariant(), "pack", "satchel", "bag"))
                return "bag";
            return (seed % 7 == 0) ? "bag" : null;
        }

        public static int SparksFromLore(WorldBook.Person person, WorldBook.Faction faction, int seed)
        {
            var arch = (person?.archetype ?? "").ToLowerInvariant();
            var title = (person?.title ?? "").ToLowerInvariant();
            int baseAmt = arch switch
            {
                "warlord" or "noble" or "chancellor" or "king" or "queen" => 120,
                "trader" or "merchant" => 85,
                "scholar" or "curator" or "priest" or "healer" or "mystic" => 55,
                "warrior" or "guard" or "warden" or "hunter" => 35,
                "fixer" or "runner" or "scout" => 40,
                _ => 22
            };
            if (Contains(title, "warlord", "lord", "lady", "chancellor", "high", "master", "mother", "elder"))
                baseAmt += 25;
            if (person != null && person.quest_giver) baseAmt += 18;
            if (faction != null && !string.IsNullOrEmpty(faction.id)) baseAmt += 8;
            // Stable jitter ±15%
            var jitter = 0.85f + (seed % 31) / 100f;
            return Mathf.Clamp(Mathf.RoundToInt(baseAmt * jitter), 8, 220);
        }

        static string[] InventoryFromLore(WorldBook.Person person, WorldBook.Faction faction, int seed)
        {
            var list = new List<string>();
            var arch = (person?.archetype ?? "default").ToLowerInvariant();
            switch (arch)
            {
                case "warlord":
                case "warrior":
                case "guard":
                    list.Add("whetstone"); list.Add("travel ration"); list.Add("ash-mark token");
                    break;
                case "healer":
                case "mystic":
                    list.Add("herb pouch"); list.Add("salve"); list.Add("travel ration");
                    break;
                case "scholar":
                case "curator":
                    list.Add("field codex"); list.Add("ink vial"); list.Add("travel ration");
                    break;
                case "trader":
                case "merchant":
                    list.Add("ledger scrap"); list.Add("trade seal"); list.Add("travel ration"); list.Add("lantern oil");
                    break;
                case "hunter":
                case "scout":
                    list.Add("trail jerky"); list.Add("bone charm"); list.Add("travel ration");
                    break;
                default:
                    list.Add("travel ration");
                    if (seed % 2 == 0) list.Add("lantern oil");
                    break;
            }
            if (person != null && person.quest_giver) list.Add("quest writ");
            if (faction != null && !string.IsNullOrEmpty(faction.name))
                list.Add("token/" + SettlementId.Normalize(faction.name));
            // Unique personal token from id
            if (!string.IsNullOrEmpty(person?.id))
                list.Add("keepsake/" + person.id);
            return list.ToArray();
        }

        static float WeaponSize(string stem)
        {
            var s = (stem ?? "").ToLowerInvariant();
            if (s.Contains("great")) return 1.15f;
            if (s.Contains("dagger") || s.Contains("wand")) return 0.75f;
            if (s.Contains("staff") || s.Contains("spear")) return 1.05f;
            return 0.95f;
        }

        static string Summarize(WorldBook.Person person, Kit kit)
        {
            return (person.name ?? "?") + " · " + (person.archetype ?? "folk")
                   + " · " + kit.Sparks + " sparks · " + (kit.PrimaryWeapon ?? "unarmed");
        }

        static bool Contains(string text, params string[] keys)
        {
            if (string.IsNullOrEmpty(text)) return false;
            for (int i = 0; i < keys.Length; i++)
                if (text.IndexOf(keys[i], StringComparison.Ordinal) >= 0) return true;
            return false;
        }

        static int StableHash(string text)
        {
            unchecked
            {
                int hash = 23;
                if (!string.IsNullOrEmpty(text))
                    for (int i = 0; i < text.Length; i++) hash = hash * 31 + text[i];
                return hash & 0x7fffffff;
            }
        }
    }
}
