#if UNITY_EDITOR
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Playable Alive Slice capture tooling (owner request, 2026-09-20).
    ///
    /// The remaining ps-*.png acceptance captures (jump/slash/grip/npc-react)
    /// need the hero mid-action or an NPC mid-transition, and none of that was
    /// reachable through screenshot tooling alone — nothing drives real
    /// keyboard input, and no menu existed to trigger the same state changes
    /// directly. This is that menu: each item calls the exact same public
    /// method real input would have called (ConcordiaPlayer already wires
    /// person?.Jump() / person?.Slash() / person?.Dodge() from Space / mouse /
    /// X), so what you see after clicking one of these is the same animation
    /// state a real keypress would produce — not a fabricated stand-in.
    ///
    /// Play mode only. Results print to the Console; camera framing and the
    /// actual screenshot are still a separate step (Unity MCP's manage_camera,
    /// or the Game view directly).
    /// </summary>
    static class PlayableSliceCaptureRig
    {
        const string Menu = "Concordia/Captures/";

        static ModularPerson Player()
        {
            var p = ConcordiaPlayer.Live;
            if (!p)
            {
                Debug.LogWarning("[CaptureRig] No live ConcordiaPlayer — enter Play and wait for the hero to attach.");
                return null;
            }
            if (!p.person)
            {
                Debug.LogWarning("[CaptureRig] ConcordiaPlayer.Live.person is null — hero body hasn't attached yet (AttachHero runs after Hub settle).");
                return null;
            }
            return p.person;
        }

        [MenuItem(Menu + "Trigger Player Jump")]
        static void TriggerJump()
        {
            var person = Player();
            if (!person) return;
            person.Jump();
            Debug.Log("[CaptureRig] Jump trigger fired on " + person.name + ". JumpStart clip is playing now — screenshot within ~1-2s while airborne pose reads.");
        }

        [MenuItem(Menu + "Trigger Player Slash")]
        static void TriggerSlash()
        {
            var person = Player();
            if (!person) return;
            person.Slash();
            Debug.Log("[CaptureRig] Slash triggered on " + person.name + ". Procedural ApplyAuthoredStrike overlay is live for the swing duration — screenshot now.");
        }

        [MenuItem(Menu + "Equip Test Weapon On Player")]
        static void EquipTestWeapon()
        {
            var person = Player();
            if (!person) return;
            var stem = DressVocab.Weapon("estoc");
            var held = CharacterGear.Attach(person.gameObject, stem, true, 0.95f);
            if (!held)
            {
                Debug.LogWarning("[CaptureRig] Attach(" + stem + ") returned null — no real hand bone resolved (expected: null, not a root-glued weapon, per the Rank 2 grip fix) or FreePacks.Mesh(" + stem + ") is missing. Try a different DressVocab.Weapon(kind) stem.");
                return;
            }
            Debug.Log("[CaptureRig] Equipped '" + stem + "' on " + person.name + ", parented to " + held.transform.parent.name + ". Screenshot the right hand now.");
        }

        [MenuItem(Menu + "Force Hour - Day (09:00)")]
        static void ForceDay() => ForceHour(9f);

        [MenuItem(Menu + "Force Hour - Dusk (21:30, pre-shelter)")]
        static void ForceDusk() => ForceHour(21.5f);

        [MenuItem(Menu + "Force Hour - Night (23:00)")]
        static void ForceNight() => ForceHour(23f);

        static void ForceHour(float hour)
        {
            if (!Application.isPlaying)
            {
                Debug.LogWarning("[CaptureRig] Enter Play first.");
                return;
            }
            WorldClock.Hour = hour;
            HubLook.ApplyHour(WorldId.Hub, hour);
            Debug.Log("[CaptureRig] WorldClock.Hour forced to " + hour.ToString("F1") + " and HubLook.ApplyHour reapplied.");
        }

        /// <summary>
        /// Rank 5 capture setup: teleports one Hub NPC (skips Watch/Sweep —
        /// they patrol through the night, they don't shelter) to just outside
        /// its own authored `home` point and forces night, so TryEnter("sleep")
        /// fires in seconds instead of however long real pathing would take.
        /// This is staging a real reaction on a real NPC's real home point —
        /// not faking the reaction itself, which is still NpcLife's own code.
        /// </summary>
        [MenuItem(Menu + "Stage NPC Shelter Reaction (rank 5)")]
        static void StageNpcReaction()
        {
            if (!Application.isPlaying)
            {
                Debug.LogWarning("[CaptureRig] Enter Play first.");
                return;
            }
            var all = Object.FindObjectsByType<NpcLife>(FindObjectsSortMode.None);
            var jobField = typeof(NpcLife).GetField("job", BindingFlags.Public | BindingFlags.Instance)
                           ?? typeof(NpcLife).GetField("job", BindingFlags.NonPublic | BindingFlags.Instance);
            NpcLife pick = null;
            foreach (var n in all)
            {
                if (!n || n.transform.position.y < -3f || n.transform.position.y > 3f) continue;
                if (jobField != null)
                {
                    var jobVal = jobField.GetValue(n);
                    var jobName = jobVal != null ? jobVal.ToString() : "";
                    if (jobName == "Watch" || jobName == "Sweep") continue;
                }
                pick = n;
                break;
            }
            if (!pick)
            {
                Debug.LogWarning("[CaptureRig] No eligible Hub NPC found (need one not on Watch/Sweep duty).");
                return;
            }
            pick.transform.position = pick.home + new Vector3(1.5f, 0f, 0f);
            ForceHour(23f);
            Debug.Log("[CaptureRig] Staged '" + pick.name + "' 1.5m from home " + pick.home.ToString("F1")
                + ". It should walk the last step and call TryEnter(\"sleep\") within a few seconds — poll its _indoors field or just watch it vanish indoors, then screenshot the empty doorway (or catch it mid-approach for the 'before' half).");
        }

        [MenuItem(Menu + "Report NPC Indoor/Outdoor Counts")]
        static void ReportIndoorCounts()
        {
            if (!Application.isPlaying)
            {
                Debug.LogWarning("[CaptureRig] Enter Play first.");
                return;
            }
            var all = Object.FindObjectsByType<NpcLife>(FindObjectsSortMode.None);
            var indoorsField = typeof(NpcLife).GetField("_indoors", BindingFlags.NonPublic | BindingFlags.Instance);
            int indoors = 0, outdoors = 0;
            foreach (var n in all)
            {
                if (!n) continue;
                bool isIndoors = indoorsField != null && (bool)indoorsField.GetValue(n);
                if (isIndoors) indoors++; else outdoors++;
            }
            Debug.Log("[CaptureRig] NPCs indoors=" + indoors + " outdoors=" + outdoors + " (hour=" + WorldClock.Hour.ToString("F1") + ")");
        }
    }
}
#endif
