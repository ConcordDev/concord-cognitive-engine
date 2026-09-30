using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace Concordia.Tests
{
    public class ContentBindCatalogTests
    {
        [Test]
        public void VolumeQuestCatalog_LoadsAllAuthoredWorldBuckets()
        {
            Concordia.ContentBindCatalog.Preload();

            Assert.IsTrue(Concordia.ContentBindCatalog.Loaded, "volume quest catalog did not load");
            Assert.AreEqual(81, Concordia.ContentBindCatalog.QuestCount,
                "volume quest count must match QUESTS_BY_WORLD.json");

            var expected = new Dictionary<Concordia.WorldId, int>
            {
                { Concordia.WorldId.Hub, 9 },
                { Concordia.WorldId.Fantasy, 8 },
                { Concordia.WorldId.Tunya, 8 },
                { Concordia.WorldId.Crime, 8 },
                { Concordia.WorldId.Cyber, 8 },
                { Concordia.WorldId.Ruins, 8 },
                { Concordia.WorldId.Frontier, 8 },
                { Concordia.WorldId.Superhero, 8 },
                { Concordia.WorldId.Crucible, 8 },
                { Concordia.WorldId.Sere, 8 }
            };

            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var pair in expected)
            {
                var quests = Concordia.ContentBindCatalog.Quests(pair.Key);
                Assert.AreEqual(pair.Value, quests.Length, "unexpected volume quest count for " + pair.Key);
                foreach (var quest in quests)
                {
                    Assert.IsNotNull(quest, "volume quest row is null for " + pair.Key);
                    Assert.IsFalse(string.IsNullOrEmpty(quest.id), "volume quest id is empty for " + pair.Key);
                    Assert.IsTrue(ids.Add(quest.id), "duplicate volume quest id: " + quest.id);
                }
            }
        }

        [Test]
        public void VolumeQuestCatalog_NormalizesExistingQuestVerbs_AndPreservesCraftGap()
        {
            var quest = Find(Concordia.WorldId.Hub, "first_cycle_cook");

            Assert.IsNotNull(quest);
            Assert.AreEqual(3, quest.objectives.Length);
            Assert.AreEqual("reach_location", quest.objectives[0].type);
            Assert.AreEqual("gather", quest.objectives[1].type);
            Assert.AreEqual("craft", quest.objectives[2].type,
                "craft must remain explicit until QuestLog gains a craft resolver");
            Assert.AreEqual("concordia_first_breath", quest.giver_npc_id);
        }

        static Concordia.WorldBook.Quest Find(Concordia.WorldId world, string id)
        {
            foreach (var quest in Concordia.ContentBindCatalog.Quests(world))
                if (quest != null && string.Equals(quest.id, id, StringComparison.OrdinalIgnoreCase))
                    return quest;
            return null;
        }
    }
}
