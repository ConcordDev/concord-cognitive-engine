using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    /// <summary>
    /// Client halves of C-20 (server creature hp), C-21 (server creature loot)
    /// and A-32 (server skill progress). The online round trip is a Play check.
    /// </summary>
    public class ServerCombatClientTests
    {
        GameObject _go;

        [TearDown]
        public void Clean()
        {
            if (_go) Object.DestroyImmediate(_go);
            ServerProgress.Reset();
            KitBag.Reset();
        }

        TrainingDummy Creature(string serverId)
        {
            _go = new GameObject("Evo_" + (serverId ?? "local"));
            var d = _go.AddComponent<TrainingDummy>();
            d.living = true;
            d.hp = 63f; // the local massKg * 0.9 estimate
            d.ServerNpcId = serverId;
            return d;
        }

        [Test]
        public void ServerCreatureIsKernelAuthoredAndTakesTheServersHp()
        {
            var d = Creature("wolf_1");
            Assert.IsTrue(d.KernelAuthored, "the server owns a kernel creature's hp");
            d.ApplyServerHp(30f, 24f, WorldId.Hub);
            Assert.AreEqual(24f, d.hp, "hp is the server's hpAfter, not the local estimate minus damage");
        }

        [Test]
        public void LocalCreatureStaysLocal()
        {
            var d = Creature(null);
            Assert.IsFalse(d.KernelAuthored);
        }

        [Test]
        public void ServerCreatureDeathDropsNoLocalSpoils()
        {
            KitBag.Reset();
            var d = Creature("wolf_2");
            d.ApplyServerHp(5f, 0f, WorldId.Fantasy);
            Assert.LessOrEqual(d.hp, 0f);
            Assert.IsFalse(KitBag.Items.Exists(i => i != null && i.id == "road-spoils"), "server loot arrives as loot:dropped");
        }

        [Test]
        public void LocalCreatureDeathStillDropsRoadSpoils()
        {
            KitBag.Reset();
            var d = Creature(null);
            d.Hit(999f, WorldId.Fantasy);
            Assert.IsTrue(KitBag.Items.Exists(i => i != null && i.id == "road-spoils"));
        }

        [Test]
        public void ProgressSlotIsHiddenUntilTheServerSpeaks()
        {
            ServerProgress.Reset();
            Assert.IsFalse(ServerProgress.Has);
            Assert.AreEqual("", ServerProgress.Line);
            ServerProgress.Apply("{\"evt\":\"skill:progress\",\"data\":{\"skill\":\"combat\",\"level\":2,\"xp\":30,\"xpToNext\":200,\"xpGain\":130,\"leveled\":true,\"acquired\":false,\"atCap\":false}}");
            Assert.IsTrue(ServerProgress.Has);
            Assert.AreEqual("combat  ·  Lv 2  ·  30 / 200 xp", ServerProgress.Line);
            Assert.AreEqual("combat reached level 2.", ServerProgress.TakeNews());
            Assert.IsNull(ServerProgress.TakeNews(), "news is one-shot");
        }

        [Test]
        public void UnreadableProgressLeavesTheSlotHidden()
        {
            ServerProgress.Reset();
            LogAssertIgnore();
            ServerProgress.Apply("{\"data\":{}}");
            ServerProgress.Apply("not json");
            Assert.IsFalse(ServerProgress.Has);
        }

        static void LogAssertIgnore() => UnityEngine.TestTools.LogAssert.ignoreFailingMessages = true;
    }
}
