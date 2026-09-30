using NUnit.Framework;
using UnityEngine;

namespace Concordia.Tests
{
    public class ContinentStreamContractTests
    {
        [TestCase(0f, 3)]
        [TestCase(ContinentStream.L3NearM, 3)]
        [TestCase(55.01f, 2)]
        [TestCase(ContinentStream.StreamInM, 2)]
        [TestCase(175.01f, 1)]
        [TestCase(ContinentStream.StreamOutM, 0)]
        [TestCase(400f, 0)]
        public void LodOf_UsesStreamingBoundaries(float distance, int expectedLod)
        {
            Assert.AreEqual(expectedLod, ContinentStream.LodOf(distance));
        }

        [Test]
        public void Grounding_ClampsStepOffsetToScaledControllerBounds()
        {
            var go = new GameObject("GroundingContract");
            try
            {
                // Add controller at scale 1 first — AddComponent defaults (step 0.3) error under 0.08 scale.
                var cc = go.AddComponent<CharacterController>();
                cc.stepOffset = 0f;
                go.transform.localScale = new Vector3(0.08f, 0.08f, 0.08f);
                cc.height = 1.8f;
                cc.radius = 0.28f;
                Grounding.ClampStepOffset(cc, 0.48f);

                var radialScale = Mathf.Max(Mathf.Abs(go.transform.lossyScale.x), Mathf.Abs(go.transform.lossyScale.z));
                var maximum = Mathf.Abs(cc.height * go.transform.lossyScale.y)
                    + Mathf.Abs(cc.radius * radialScale) * 2f;
                Assert.LessOrEqual(cc.stepOffset, maximum);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void Grounding_EnsureControllerHandlesPreScaledObject()
        {
            var go = new GameObject("GroundingEnsureControllerContract");
            try
            {
                go.transform.localScale = new Vector3(0.08f, 0.08f, 0.08f);
                var cc = Grounding.EnsureController(go, 1.8f);
                var radialScale = Mathf.Max(Mathf.Abs(go.transform.lossyScale.x), Mathf.Abs(go.transform.lossyScale.z));
                var maximum = Mathf.Abs(cc.height * go.transform.lossyScale.y)
                    + Mathf.Abs(cc.radius * radialScale) * 2f;
                Assert.LessOrEqual(cc.stepOffset, maximum);
                Assert.IsTrue(Grounding.CanMove(cc));
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void Grounding_CanMoveRejectsDisabledOrInactiveControllers()
        {
            var go = new GameObject("GroundingCanMoveContract");
            try
            {
                var cc = go.AddComponent<CharacterController>();
                Assert.IsTrue(Grounding.CanMove(cc));
                cc.enabled = false;
                Assert.IsFalse(Grounding.CanMove(cc));
                cc.enabled = true;
                go.SetActive(false);
                Assert.IsFalse(Grounding.CanMove(cc));
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }
    }
}
