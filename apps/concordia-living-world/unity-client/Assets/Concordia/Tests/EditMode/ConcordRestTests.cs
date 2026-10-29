using NUnit.Framework;

namespace Concordia.Tests
{
    /// <summary>G-05: REST reaches the socket's own server, and only top-level ok:false is a refusal.</summary>
    public class ConcordRestTests
    {
        [Test]
        public void HttpOriginFollowsTheSocketScheme()
        {
            Assert.AreEqual("http://127.0.0.1:5050", ConcordClient.HttpOrigin("ws://127.0.0.1:5050/unity-ws"));
            Assert.AreEqual("https://concord-os.org", ConcordClient.HttpOrigin("wss://concord-os.org/unity-ws"));
            Assert.AreEqual("https://concord-os.org:8443", ConcordClient.HttpOrigin("wss://concord-os.org:8443/unity-ws?x=1"));
        }

        [Test]
        public void HttpOriginRefusesAnythingElse()
        {
            Assert.IsNull(ConcordClient.HttpOrigin(null));
            Assert.IsNull(ConcordClient.HttpOrigin(""));
            Assert.IsNull(ConcordClient.HttpOrigin("http://127.0.0.1:5050"));
            Assert.IsNull(ConcordClient.HttpOrigin("not a url"));
        }

        [Test]
        public void OnlyTopLevelOkFalseIsARefusal()
        {
            Assert.IsTrue(ConcordRest.SaysNotOk("{\"ok\":false,\"reason\":\"no_token\"}"));
            Assert.IsTrue(ConcordRest.SaysNotOk("{ \"ok\" : false }"));
            Assert.IsFalse(ConcordRest.SaysNotOk("{\"ok\":true,\"rows\":[{\"ok\":false}]}"));
            Assert.IsFalse(ConcordRest.SaysNotOk("{\"rows\":[{\"ok\":false}],\"count\":1}"));
            Assert.IsFalse(ConcordRest.SaysNotOk("{\"status\":\"ok\",\"note\":\"\\\"ok\\\":false\"}"));
            Assert.IsFalse(ConcordRest.SaysNotOk("[]"));
            Assert.IsFalse(ConcordRest.SaysNotOk(""));
        }
    }
}
