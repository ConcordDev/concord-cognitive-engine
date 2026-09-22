using System.Collections.Generic;
using UnityEngine;
using Concordia.WorldSystems;

namespace Concordia
{
    /// <summary>
    /// Activates WorldGeography trade routes as living traffic:
    /// CrossRing caravans on inter-world routes + local merchant walkers on regional roads.
    /// Extends CrossRing / GeographyRuntime — does not invent a second cargo system.
    /// </summary>
    public static class TradeRouteTraffic
    {
        static bool _seeded;
        static float _presentCooldown;
        static readonly HashSet<string> ActiveWalkers = new HashSet<string>();

        /// <summary>Open every authored inter-world trade route with an opening caravan + sparks markets.</summary>
        public static void ActivateOpeningEconomy(WorldSystemsEconomyService economy = null)
        {
            WorldGeography.EnsureBuilt();
            SeedSparksMarkets(economy);
            if (_seeded) return;
            _seeded = true;

            int dispatched = 0;
            foreach (var route in WorldGeography.Routes)
            {
                if (route == null) continue;
                if (route.worldA == route.worldB) continue; // regional roads — walkers handle these
                if (CrossRing.HasActiveCaravan(route.worldA, route.worldB)) continue;
                var fromSlice = WorldMemory.Load(route.worldA);
                KingdomBook.Ensure(fromSlice, route.worldA);
                // Opening stock so caravans can leave without waiting for AwayTick grind.
                if (fromSlice.stock < 1.05f) fromSlice.stock = 1.15f;
                CrossRing.DispatchOpeningCaravan(route.worldA, route.worldB, fromSlice, 0.14f);
                WorldMemory.Put(route.worldA, fromSlice);
                dispatched++;
            }

            // Seed player sparks if inventory exists.
            if (economy != null)
            {
                economy.RegisterMarket(new WorldSystemsMarketContract
                {
                    storefrontId = "concordia-hub-market",
                    resourceId = LoreNpcBinder.SparksResource,
                    basePrice = 1f,
                    targetStock = 80f,
                    minimumPrice = 0.2f,
                    maximumPrice = 20f
                });
            }

            UnityEngine.Debug.Log("[Concordia] TradeRouteTraffic: opening caravans=" + dispatched
                                  + " routes=" + WorldGeography.Routes.Count);
        }

        static void SeedSparksMarkets(WorldSystemsEconomyService economy)
        {
            if (economy == null)
            {
                try { economy = WorldSystemsEconomyService.ForActiveHost(); }
                catch { return; }
            }
            if (economy == null) return;
            foreach (WorldId w in System.Enum.GetValues(typeof(WorldId)))
            {
                economy.RegisterMarket(new WorldSystemsMarketContract
                {
                    storefrontId = "market/" + WorldBook.Folder(w) + "/sparks",
                    resourceId = LoreNpcBinder.SparksResource,
                    basePrice = 1f,
                    targetStock = 50f,
                    minimumPrice = 0.2f,
                    maximumPrice = 18f
                });
            }
        }

        /// <summary>Frame tick: keep caravans moving and present merchants on nearby regional roads.</summary>
        public static void Tick(float dt)
        {
            CrossRing.TickCaravans(dt * 0.08f);
            CrossRing.PresentNearPlayer();
            _presentCooldown -= dt;
            if (_presentCooldown > 0f) return;
            _presentCooldown = 1.4f;
            PresentRegionalTraffic();
        }

        static void PresentRegionalTraffic()
        {
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            var world = WorldClock.World;
            var pos = new Vector2(player.transform.position.x, player.transform.position.z);
            int shown = 0;
            foreach (var route in WorldGeography.Routes)
            {
                if (route == null || route.waypoints == null || route.waypoints.Length < 2) continue;
                if (route.worldA != world && route.worldB != world) continue;
                if (route.worldA != route.worldB) continue; // inter-world = caravan carts
                var mid = route.waypoints[route.waypoints.Length / 2];
                if (Vector2.Distance(pos, mid) > 90f) continue;
                var key = route.id != null ? route.id.value : ("anon-" + shown);
                if (ActiveWalkers.Contains(key)) continue;
                if (GameObject.Find("TradeWalker_" + key.Replace('/', '_'))) continue;

                var parent = player.transform.root;
                var routesGo = GameObject.Find("GeographicRoutes");
                if (routesGo) parent = routesGo.transform;
                var a = route.waypoints[0];
                var b = route.waypoints[route.waypoints.Length - 1];
                var spawn = new Vector3(a.x, 0.05f, a.y);
                var look = Appearance.Random(key.GetHashCode());
                look.displayName = "Caravan walker";
                look.outfit = 1;
                var go = ModularPerson.SpawnNpc(parent, spawn, 0f, look, true, 6f);
                go.name = "TradeWalker_" + key.Replace('/', '_');
                var life = go.GetComponent<NpcLife>() ?? go.AddComponent<NpcLife>();
                life.job = NpcLife.Job.Wander;
                CharacterGear.Attach(go, PersonKit.MapWeapon("dagger"), true, 0.8f);
                CharacterGear.Equip(go, "bag", CharacterGear.Slot.Back, 0.85f);
                var tag = go.AddComponent<TradeRouteWalker>();
                tag.routeId = key;
                tag.world = world;
                tag.destination = new Vector3(b.x, 0.05f, b.y);
                ActiveWalkers.Add(key);
                shown++;
                if (shown >= 6) break;
            }
        }

        public static void ResetSession()
        {
            _seeded = false;
            ActiveWalkers.Clear();
            _presentCooldown = 0f;
        }
    }

    /// <summary>Merchant body walking an authored regional TradeRouteDef.</summary>
    public sealed class TradeRouteWalker : MonoBehaviour
    {
        public string routeId;
        public WorldId world;
        public Vector3 destination;
        float _speed = 2.4f;

        void Update()
        {
            var p = transform.position;
            var target = destination;
            target.y = p.y;
            var delta = target - p;
            if (delta.sqrMagnitude < 0.4f)
            {
                // Bounce to the other end using stored route midpoints if available.
                destination = p + (p - destination).normalized * 12f;
                return;
            }
            var step = delta.normalized * (_speed * Time.deltaTime);
            transform.position = p + step;
            if (step.sqrMagnitude > 0.0001f)
                transform.rotation = Quaternion.Slerp(transform.rotation,
                    Quaternion.LookRotation(step, Vector3.up), 8f * Time.deltaTime);
        }
    }
}
