using System.Collections;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Concordia.Tests
{
    public class ContinentStreamPlayModeTests
    {
        const int HubTimeoutFrames = 1800;
        const int ImpostorTimeoutFrames = 480;

        [UnityTest]
        public IEnumerator ReleaseDuringFullBuild_DoesNotCommitStaleChunk()
        {
            LogAssert.ignoreFailingMessages = true;
            SceneManager.LoadScene("ConcordiaHub", LoadSceneMode.Single);
            yield return null;

            ContinentStream stream = null;
            for (int i = 0; i < HubTimeoutFrames; i++)
            {
                stream = ContinentStream.Live;
                if (stream && stream.IsContinentReady && stream.IsReady(WorldId.Hub)) break;
                yield return null;
            }

            Assert.IsNotNull(stream, "ContinentStream was never bound during stale-build test.");
            Assert.IsTrue(stream.IsContinentReady, "Continent bootstrap never reached readiness for stale-build test.");

            var request = typeof(ContinentStream).GetMethod("RequestFull", BindingFlags.Instance | BindingFlags.NonPublic);
            var release = typeof(ContinentStream).GetMethod("Release", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(request, "RequestFull private test seam is missing.");
            Assert.IsNotNull(release, "Release private test seam is missing.");

            request.Invoke(stream, new object[] { WorldId.Cyber });
            release.Invoke(stream, new object[] { WorldId.Cyber });
            yield return null;

            for (int i = 0; i < 180; i++) yield return null;

            Assert.IsFalse(stream.IsReady(WorldId.Cyber), "A released full-build coroutine committed a stale Cyber chunk.");
            Assert.IsFalse(stream.TryGetReadiness(WorldId.Cyber, out var readiness)
                && readiness == ContinentStream.ChunkReadiness.Ready,
                "Released Cyber readiness incorrectly returned Ready.");
        }

        [UnityTest]
        public IEnumerator ConcordiaHubBoot_StagesContinent_AndPublishesReadyChunks()
        {
            LogAssert.ignoreFailingMessages = true;
            SceneManager.LoadScene("ConcordiaHub", LoadSceneMode.Single);
            yield return null;

            ContinentStream stream = null;
            for (int i = 0; i < HubTimeoutFrames; i++)
            {
                stream = ContinentStream.Live;
                if (stream && stream.IsContinentReady && stream.IsReady(WorldId.Hub))
                    break;
                yield return null;
            }

            Assert.IsNotNull(stream, "ContinentStream was never bound during ConcordiaHub boot.");
            Assert.IsNotNull(stream.continent, "ContinentStream created no Megaworld root.");
            Assert.IsTrue(stream.IsContinentReady, "Continent bootstrap never reached readiness.");
            Assert.IsTrue(stream.IsReady(WorldId.Hub), "Hub did not reach full-chunk readiness.");

            var hub = stream.ChunkOf(WorldId.Hub);
            Assert.IsNotNull(hub, "ContinentStream reported a ready Hub without a chunk.");
            Assert.AreEqual("Chunk_Hub", hub.name);
            Assert.AreSame(stream.continent, hub.parent);
            Assert.AreEqual(MegaworldMap.Present(WorldId.Hub), hub.position);

            for (int i = 0; i < ImpostorTimeoutFrames; i++)
            {
                if (stream.TryGetReadiness(WorldId.Cyber, out var readiness)
                    && readiness == ContinentStream.ChunkReadiness.Impostor)
                    break;
                yield return null;
            }

            Assert.IsTrue(stream.TryGetReadiness(WorldId.Cyber, out var cyberReadiness));
            Assert.AreEqual(ContinentStream.ChunkReadiness.Impostor, cyberReadiness);
            Assert.IsNotNull(stream.ChunkOf(WorldId.Cyber));
        }
    }
}
