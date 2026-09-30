import { useEffect, useRef, useSyncExternalStore } from "react";
import { bindInput, createInput } from "@/game/input";
import { SCHEMES } from "@/game/content";
import { unlockAudio, startDrone, sfxUi, sfxScheme } from "@/game/audio";
import { useOverlay } from "@/game/store";
import { makeSim } from "@/game/sim";
import { GameCanvas } from "./GameCanvas";
import { DialogueOverlay, PauseOverlay, PlayHUD, TitleOverlay, TouchPad } from "./HUD";

const clientTrue = () => true;
const serverFalse = () => false;
const noopSubscribe = () => () => {};

export function GameRoot() {
  const phase = useOverlay((s) => s.phase);
  const inputRef = useRef(createInput());
  const simRef = useRef(makeSim("concordia-hub"));
  const wrapRef = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(noopSubscribe, clientTrue, serverFalse);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    return bindInput(inputRef.current, el);
  }, [mounted]);

  useEffect(() => {
    if (phase !== "play") document.exitPointerLock?.();
  }, [phase]);

  const play = () => {
    unlockAudio();
    startDrone();
    sfxUi();
    useOverlay.getState().set({
      phase: "play",
      toast: {
        text: "Click the world to look. WASD walks. The Lamplighter is on the eastern path.",
      },
    });
    window.setTimeout(() => {
      const t = useOverlay.getState().toast;
      if (t?.text.startsWith("Click the world")) {
        useOverlay.getState().set({ toast: null });
      }
    }, 5600);
    wrapRef.current?.focus();
  };

  const resume = () => {
    useOverlay.getState().set({ phase: "play" });
    wrapRef.current?.focus();
  };

  const barge = (id: string) => {
    const sch = SCHEMES.find((s) => s.id === id);
    sfxScheme();
    useOverlay.getState().set({
      toast: { text: sch?.barge ?? "You step into the plot. It will remember." },
      bargeCount: useOverlay.getState().bargeCount + 1,
    });
    useOverlay.getState().mark("scheme");
    window.setTimeout(() => useOverlay.getState().set({ toast: null }), 4200);
  };

  const pause = () => {
    document.exitPointerLock?.();
    useOverlay.getState().set({ phase: "pause" });
  };

  return (
    <div
      ref={wrapRef}
      data-phase={phase}
      data-mounted={mounted ? "1" : "0"}
      tabIndex={0}
      className="relative h-full w-full isolate overflow-hidden bg-ink outline-none"
    >
      {mounted ? (
        <div
          className="absolute inset-0 z-0"
          style={{ pointerEvents: phase === "play" ? "auto" : "none" }}
        >
          <GameCanvas input={inputRef.current} simRef={simRef} phase={phase} />
        </div>
      ) : null}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at 50% 42%, transparent 48%, rgba(8,6,4,0.38) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-30 isolate"
        style={{ transform: "translateZ(0)" }}
      >
        {phase === "title" ? <TitleOverlay onPlay={play} loading={!mounted} /> : null}
        {phase === "play" ? <PlayHUD onPause={pause} onBarge={barge} /> : null}
        {phase === "dialogue" ? <DialogueOverlay /> : null}
        {phase === "pause" ? <PauseOverlay onResume={resume} /> : null}
        {phase === "play" ? (
          <TouchPad
            onJoy={(x, y) => {
              inputRef.current.joyX = x;
              inputRef.current.joyY = y;
            }}
            onLook={(x, y) => {
              inputRef.current.lookX = x;
              inputRef.current.lookY = y;
            }}
            onAttack={() => {
              inputRef.current.attack = true;
            }}
            onDodge={() => {
              inputRef.current.dodge = true;
            }}
            onInteract={() => {
              inputRef.current.interact = true;
            }}
            onSpecial={() => {
              inputRef.current.special = true;
            }}
            onPower={() => {
              inputRef.current.power = true;
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
