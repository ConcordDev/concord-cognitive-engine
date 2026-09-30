using Concordia.GameplayCore.Persistence;
using Concordia.WorldSimulation;
using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    public class ConcordiaPersistenceTests
    {

        [TearDown]
        public void ClearFactionStandingState()
        {
            FactionStandingBook.Restore(null);
            WorldEventLog.Restore(null);
            WorldMemory.ApplyPersistence(new WorldPersistenceRecord());
        }

        [Test]
        public void UnifiedSimulationSection_RoundTripsStateWithoutSharingRuntimeReferences()
        {
            var source = new WorldSimulationState
            {
                schemaVersion = 1,
                worldSeed = 42,
                clock = new WorldSimulationClock { tick = 17, day = 3, hour = 8.5f, elapsedSeconds = 510f }
            };
            source.npcs.Add(new NpcSocialState
            {
                npcId = "mara",
                displayName = "Mara",
                settlementId = "court",
                currentActivity = "farming",
                stress = 2
            });
            source.relationships.Add(new RelationshipState
            {
                relationshipId = "mara-lyra",
                subjectNpcId = "mara",
                targetNpcId = "lyra",
                kind = RelationshipKind.Friendship,
                strength = 0.75f,
                trust = 0.6f,
                lastInteractionTick = 16
            });

            var record = ConcordiaPersistenceService.CaptureWorldSimulationState(source);
            var envelope = new PersistenceEnvelope();
            envelope.payload.worldSimulation = record;
            var serialized = JsonUtility.ToJson(envelope);
            var decoded = JsonUtility.FromJson<PersistenceEnvelope>(serialized);
            var target = new WorldSimulationService(7);

            Assert.AreEqual(1, decoded.payload.worldSimulation.schemaVersion);
            Assert.IsTrue(ConcordiaPersistenceService.RestoreWorldSimulation(target, decoded.payload.worldSimulation));
            Assert.AreEqual(42, target.State.worldSeed);
            Assert.AreEqual(17, target.State.clock.tick);
            Assert.AreEqual(1, target.State.npcs.Count);
            Assert.AreEqual("mara", target.State.npcs[0].npcId);
            Assert.AreEqual(1, target.State.relationships.Count);
            Assert.AreEqual(RelationshipKind.Friendship, target.State.relationships[0].kind);
            Assert.AreNotSame(source, target.State);
            Assert.AreNotSame(source.npcs[0], target.State.npcs[0]);
        }

        [Test]
        public void LegacyRawSimulationState_IsExplicitlyImported()
        {
            var legacy = new WorldSimulationState
            {
                schemaVersion = 1,
                worldSeed = 99,
                clock = new WorldSimulationClock { tick = 8, day = 2, hour = 4f }
            };
            legacy.creatures.Add(new CreatureState { creatureId = "stag-1", speciesId = "stag", alive = true });
            var target = new WorldSimulationService(1);
            string error;

            var imported = ConcordiaPersistenceService.TryImportLegacyWorldSimulation(
                JsonUtility.ToJson(legacy), target, out error);

            Assert.IsTrue(imported, error);
            Assert.IsNull(error);
            Assert.AreEqual(99, target.State.worldSeed);
            Assert.AreEqual(8, target.State.clock.tick);
            Assert.AreEqual("stag-1", target.State.creatures[0].creatureId);
        }

        [Test]
        public void UnsupportedLegacySimulationSchema_IsRejectedWithoutReplacingState()
        {
            var target = new WorldSimulationService(7);
            var legacy = new WorldSimulationState { schemaVersion = 2, worldSeed = 99 };
            string error;

            var imported = ConcordiaPersistenceService.TryImportLegacyWorldSimulation(
                JsonUtility.ToJson(legacy), target, out error);

            Assert.IsFalse(imported);
            Assert.IsNotNull(error);
            Assert.AreEqual(7, target.State.worldSeed);
        }
    

        [Test]
        public void FactionStandingBook_RoundTripsClampedStandingAndSeparateWitnessHeat()
        {
            FactionStandingBook.Restore(null);
            var standing = FactionStandingBook.Adjust(WorldId.Crime, " Merchant_Collective ", 1.4f, false, "test");
            var heat = FactionStandingBook.AddWitnessHeat(WorldId.Crime, "merchant_collective", 0.75f, "test-witness");
            var snapshot = FactionStandingBook.Snapshot();

            FactionStandingBook.Restore(null);
            Assert.AreEqual(0f, FactionStandingBook.Get(WorldId.Crime, "merchant_collective"));
            Assert.AreEqual(0f, FactionStandingBook.WitnessHeat(WorldId.Crime, "merchant_collective"));

            FactionStandingBook.Restore(snapshot);
            Assert.AreEqual(1f, standing);
            Assert.AreEqual(0.75f, heat);
            Assert.AreEqual(1f, FactionStandingBook.Get(WorldId.Crime, "merchant_collective"));
            Assert.AreEqual(0.75f, FactionStandingBook.WitnessHeat(WorldId.Crime, "merchant_collective"));
            Assert.AreEqual(1f, snapshot[0].standing);
            Assert.AreEqual(0.75f, snapshot[0].witnessHeat);
        }

        [Test]
        public void LegacyWorldMemory_IsImportedIntoCanonicalCache()
        {
            var legacy = new LivingSaveRec
            {
                v = 1,
                plotsCsv = "plot-road:2",
                slices = new[]
                {
                    new WorldSliceRec
                    {
                        world = WorldId.Frontier.ToString(), hour = 14.5f, day = 9,
                        ecology = 0.4f, prices = 1.2f, deadCsv = "scout-1"
                    }
                }
            };
            string error;

            Assert.IsTrue(ConcordiaPersistenceService.TryImportLegacyWorldMemory(JsonUtility.ToJson(legacy), out error), error);
            Assert.IsNull(error);
            Assert.AreEqual(14.5f, WorldMemory.Load(WorldId.Frontier).hour);
            Assert.AreEqual(9, WorldMemory.Load(WorldId.Frontier).day);
            Assert.AreEqual("plot-road:2", WorldMemory.All().plotsCsv);
        }

        [Test]
        public void UnifiedWorldCapture_PreservesMemoryEventLogAndFactionStanding()
        {
            WorldMemory.ApplyPersistence(new WorldPersistenceRecord());
            WorldEventLog.Restore(null);
            FactionStandingBook.Restore(null);
            WorldMemory.Put(WorldId.Crime, new WorldSliceRec { world = WorldId.Crime.ToString(), hour = 11f, day = 4, deadCsv = "broker" });
            WorldEventLog.Record("test-memory", "the broker was remembered", "player", "broker");
            FactionStandingBook.Adjust(WorldId.Crime, "merchant_collective", 0.5f, false, "test-capture");

            var envelope = ConcordiaPersistenceService.Capture();
            var slice = envelope.payload.world.slices.Find(x => x.world == WorldId.Crime.ToString());
            var evt = envelope.payload.world.eventLog.Find(x => x.type == "test-memory");
            var standing = envelope.payload.world.factionStandings.Find(x => x.factionId == "merchant_collective");

            Assert.IsNotNull(slice);
            Assert.AreEqual(11f, slice.hour);
            Assert.IsNotNull(evt);
            Assert.AreEqual("the broker was remembered", evt.text);
            Assert.IsNotNull(standing);
            Assert.AreEqual(0.5f, standing.standing);
        }

        [Test]
        public void FactionStandingIntegration_CoversDialogueQuestAndGuardContracts()
        {
            FactionStandingBook.Restore(null);
            FactionStandingBook.Adjust(WorldId.Hub, "watch", -1f, false, "test-hostility");
            string reason;

            Assert.IsFalse(FactionStandingIntegration.CanDialogue(WorldId.Hub, "watch", out reason));
            Assert.IsFalse(FactionStandingIntegration.CanAcceptQuest(WorldId.Hub, "watch", out reason));
            var reaction = FactionStandingIntegration.EvaluateGuardReaction(WorldId.Hub, "watch", 0.8f, true);
            Assert.IsTrue(reaction.investigate);
            Assert.IsTrue(reaction.pursue);
        }

        [Test]
        public void FactionStandingIntegration_UsesNeutralDefaultsAndBlocksHostileTrade()
        {
            FactionStandingBook.Restore(null);
            string reason;
            Assert.IsTrue(FactionStandingIntegration.CanTrade(WorldId.Hub, "unknown-faction", out reason));
            Assert.AreEqual(1f, FactionStandingIntegration.MarketPriceMultiplier(WorldId.Hub, "unknown-faction"));

            FactionStandingBook.Adjust(WorldId.Hub, "merchant_collective", -1f, false, "test-hostility");
            Assert.IsFalse(FactionStandingIntegration.CanTrade(WorldId.Hub, "merchant_collective", out reason));
            Assert.IsTrue(reason.Contains("refuses"));

            FactionStandingBook.AddWitnessHeat(WorldId.Hub, "merchant_collective", 0.5f, "test-witness");
            Assert.AreEqual(-1f, FactionStandingBook.Get(WorldId.Hub, "merchant_collective"));
            Assert.AreEqual(0.5f, FactionStandingBook.WitnessHeat(WorldId.Hub, "merchant_collective"));
        }
}
}
