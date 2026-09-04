import { GATES, NPCS, OBJECTIVES, RING_RADIUS, SCHEMES, THEMES, WALL_RADIUS } from "@/game/content";
import { settlementsOf } from "@/game/realms";
import { isMuted, setMuted, sfxUi } from "@/game/audio";
import { useOverlay } from "@/game/store";
import { MAX_HP, MAX_POISE, MAX_STAMINA } from "@/game/combat";
import { Pause, Volume2, VolumeX } from "lucide-react";
import { findSpeaker, WORLD_ORDER, worldKit } from "@/game/worlds";
import { hourLabel } from "@/game/kernel";
import { livingLines } from "@/game/cross";

function Ring({
  value,
  max,
  tone,
  size = 72,
  children,
}: {
  value: number;
  max: number;
  tone: string;
  size?: number;
  children?: React.ReactNode;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 72 72" className="rotate-[-90deg]">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(12,10,8,0.65)" strokeWidth="7" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

function Minimap() {
  const heading = useOverlay((s) => s.heading);
  const px = useOverlay((s) => s.px);
  const pz = useOverlay((s) => s.pz);
  const worldId = useOverlay((s) => s.worldId);
  const size = 148;
  const cx = size / 2;
  const viewR = worldId === "concordia-hub" ? WALL_RADIUS : 240;
  const sc = (size * 0.38) / viewR;
  const sx = (x: number) => cx + (x - (worldId === "concordia-hub" ? 0 : px * 0.15)) * sc;
  const sz = (z: number) => cx + (z - (worldId === "concordia-hub" ? 0 : pz * 0.15)) * sc;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const towns = settlementsOf(worldId);
  return (
    <div data-hud-ui className="relative size-[148px] overflow-hidden rounded-full border-4 border-[#1a1610] shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="bg-[#1c2418]">
        {worldId === "concordia-hub" ? (
          <>
            <circle cx={cx} cy={cx} r={RING_RADIUS * sc} fill="none" stroke="rgba(200,190,150,0.35)" strokeWidth="2" />
            <circle cx={cx} cy={cx} r={11 * sc} fill="rgba(160,180,90,0.25)" />
            {GATES.map((g) => (
              <circle
                key={g.id}
                cx={sx(Math.cos(g.angle) * RING_RADIUS)}
                cy={sz(Math.sin(g.angle) * RING_RADIUS)}
                r={worldId === g.worldId ? 4 : 2.6}
                fill={g.color}
              />
            ))}
          </>
        ) : (
          <>
            <circle cx={cx} cy={cx} r={52} fill="none" stroke="rgba(200,190,150,0.25)" strokeWidth="1" />
            {towns.map((t) => (
              <circle key={t.id} cx={sx(t.x)} cy={sz(t.z)} r="3" fill="#e8c070" />
            ))}
          </>
        )}
        <circle cx={sx(px)} cy={sz(pz)} r="4" fill="#f4ecda" />
        <line
          x1={sx(px)}
          y1={sz(pz)}
          x2={sx(px) + fx * 12}
          y2={sz(pz) + fz * 12}
          stroke="#f4ecda"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function TitleOverlay({ onPlay, loading }: { onPlay: () => void; loading?: boolean }) {
  return (
    <div
      data-testid="title-overlay"
      className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-end bg-gradient-to-t from-ink/85 via-ink/20 to-transparent p-6 sm:p-10"
      style={{ transform: "translateZ(0)" }}
    >
      <div data-hud-ui className="pointer-events-auto max-w-xl">
        <p className="text-xs font-medium uppercase tracking-[0.28em] text-olive-fg/80">The Ninth Refusal</p>
        <h1 className="mt-2 font-display text-5xl leading-[0.95] text-paper sm:text-7xl">Concordia</h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-paper/80 sm:text-base">
          Nine realities, three kilometres across. Walk the Unburned Court, cross a door, fight with mass and momentum — never dice.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="walk-in"
            onClick={(e) => {
              e.stopPropagation();
              if (!loading) onPlay();
            }}
            disabled={loading}
            className="rounded-xl bg-paper px-8 py-3.5 text-sm font-medium text-ink transition-transform duration-150 hover:scale-[0.99] active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? "Lighting the lanterns" : "Walk in"}
          </button>
          <p className="text-xs text-paper/60">WASD · click to look · Shift sprint · Space jump · X dodge</p>
        </div>
      </div>
    </div>
  );
}

export function PlayHUD({
  onPause,
  onBarge,
}: {
  onPause: () => void;
  onBarge: (id: string) => void;
}) {
  const hp = useOverlay((s) => s.hp);
  const stamina = useOverlay((s) => s.stamina);
  const poise = useOverlay((s) => s.poise);
  const inCombat = useOverlay((s) => s.inCombat);
  const telegraph = useOverlay((s) => s.telegraph);
  const prompt = useOverlay((s) => s.prompt);
  const toast = useOverlay((s) => s.toast);
  const feed = useOverlay((s) => s.feed);
  const done = useOverlay((s) => s.done);
  const worldId = useOverlay((s) => s.worldId);
  const muted = useOverlay((s) => s.muted);
  const billboard = useOverlay((s) => s.billboard);
  const worldTitle = useOverlay((s) => s.worldTitle);
  const refusal = useOverlay((s) => s.refusal);
  const lawText = useOverlay((s) => s.lawText);
  const styleName = useOverlay((s) => s.styleName);
  const hour = useOverlay((s) => s.hour);
  const weather = useOverlay((s) => s.weather);
  const uncounted = useOverlay((s) => s.uncounted);
  const hostility = useOverlay((s) => s.hostility);
  const beastName = useOverlay((s) => s.beastName);
  const arts = useOverlay((s) => s.arts);
  const questTitle = useOverlay((s) => s.questTitle);
  const questDetail = useOverlay((s) => s.questDetail);
  const poi = useOverlay((s) => s.poi);
  const ecology = useOverlay((s) => s.ecology);
  const km = useOverlay((s) => s.km);
  const plotLine = useOverlay((s) => s.plotLine);
  const politics = useOverlay((s) => s.politics);
  const flash = useOverlay((s) => s.flash);
  const theme = THEMES[worldId];

  const stop = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    document.exitPointerLock?.();
  };

  return (
    <div data-testid="play-hud" className="pointer-events-none absolute inset-0 z-30 text-paper" style={{ transform: "translateZ(0)" }}>
      {flash > 0.04 ? (
        <div className="absolute inset-0 bg-[#fff4dc]" style={{ opacity: Math.min(0.42, flash * 0.38) }} />
      ) : null}
      <div className="absolute left-4 top-4 max-w-[16rem] sm:left-6 sm:top-6">
        <p data-testid="world-title" className="font-display text-2xl leading-none text-paper drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
          {worldTitle || (theme.id === "concordia-hub" ? "The Hub" : theme.id)}
        </p>
        {refusal ? (
          <p className="mt-1 max-w-[16rem] text-[12px] italic leading-snug text-olive-fg/90 drop-shadow">{refusal}</p>
        ) : null}
        {lawText ? <p className="mt-0.5 text-[11px] text-paper/55">{lawText}</p> : null}
        <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-paper/70 drop-shadow">
          {hourLabel(hour)} · {weather}
          {beastName ? ` · ${beastName}` : ""}
        </p>
        {km ? <p className="mt-0.5 text-[11px] text-paper/55">{km}{poi ? ` · ${poi}` : ""}</p> : null}
        {questTitle ? (
          <p className="mt-2 max-w-[14rem] text-[12px] leading-snug text-paper/80 drop-shadow">
            {questTitle}
            {questDetail ? ` — ${questDetail}` : ""}
          </p>
        ) : null}
        {plotLine ? <p className="mt-1 text-[11px] text-olive-fg/85">{plotLine}</p> : null}
      </div>

      <div data-hud-ui className="pointer-events-auto absolute right-4 top-4 z-50 flex flex-col items-end gap-2 sm:right-6 sm:top-6" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <Ring value={hp} max={MAX_HP} tone="#d45a48">
            <span className="font-mono text-[11px] text-paper">{Math.round(hp)}</span>
          </Ring>
          <Ring value={stamina} max={MAX_STAMINA} tone="#e0c56a">
            <span className="font-mono text-[11px] text-paper">{Math.round(stamina)}</span>
          </Ring>
          {inCombat ? (
            <Ring value={poise} max={MAX_POISE} tone="#7aa3c7" size={56}>
              <span className="font-mono text-[10px] text-paper">{Math.round(poise)}</span>
            </Ring>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-hud-ui
            aria-label={muted ? "Unmute" : "Mute"}
            className="grid size-11 place-items-center rounded-lg border border-paper/15 bg-hud/80"
            onClick={(e) => {
              stop(e);
              const next = !isMuted();
              setMuted(next);
              useOverlay.getState().set({ muted: next });
              sfxUi();
            }}
          >
            {muted ? <VolumeX className="pointer-events-none size-4" /> : <Volume2 className="pointer-events-none size-4" />}
          </button>
          <button
            type="button"
            data-hud-ui
            aria-label="Pause"
            className="grid size-11 place-items-center rounded-lg border border-paper/15 bg-hud/80"
            onClick={(e) => {
              stop(e);
              onPause();
            }}
          >
            <Pause className="pointer-events-none size-4" />
          </button>
        </div>
        <p className="hidden max-w-[11rem] text-right text-[11px] leading-snug text-paper/60 sm:block">{styleName}</p>
      </div>

      <div className="pointer-events-none absolute bottom-5 left-4 sm:bottom-6 sm:left-6">
        <Minimap />
        {uncounted > 0 || hostility > 2 || (worldId !== "concordia-hub" && ecology) ? (
          <p className="mt-2 text-[11px] text-paper/60">
            {uncounted > 0 ? `Uncounted ${Math.round(uncounted)}  ` : ""}
            {hostility > 2 ? `Hostility ${Math.round(hostility)}  ` : ""}
            {worldId !== "concordia-hub" ? `Ecology ${Math.round(ecology * 100)}` : ""}
          </p>
        ) : null}
      </div>

      {telegraph ? (
        <div className="absolute left-1/2 top-[22%] -translate-x-1/2 rounded-full border border-paper/20 bg-danger/80 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em]">
          {telegraph === "thrust" ? "Thrust — parry" : telegraph === "sweep" ? "Sweep — dodge" : "Grab — dodge"}
        </div>
      ) : null}

      {billboard ? (
        <div className="absolute left-1/2 top-[38%] -translate-x-1/2 font-display text-3xl text-paper">{billboard.text}</div>
      ) : null}

      {prompt ? (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-paper/15 bg-hud/80 px-4 py-2 text-sm text-paper backdrop-blur-sm">
          {prompt}
          <span className="ml-2 rounded-full bg-paper/15 px-2 py-0.5 font-mono text-xs">E</span>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 gap-1.5 sm:flex">
        {(arts ?? []).map((a) => (
          <div key={a.key} className="min-w-[4.4rem] rounded-lg border border-paper/12 bg-hud/70 px-2.5 py-1.5 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper/45">{a.key}</p>
            <p className="text-[11px] text-paper/85">{a.name}</p>
          </div>
        ))}
      </div>

      {toast ? (
        <div
          data-hud-ui
          className="pointer-events-auto absolute bottom-40 left-1/2 w-[min(92vw,26rem)] -translate-x-1/2 rounded-xl border border-paper/15 bg-hud/90 p-4 backdrop-blur-sm"
        >
          <p className="text-sm leading-relaxed text-paper/90">{toast.text}</p>
          {toast.schemeId && toast.action ? (
            <button
              type="button"
              data-hud-ui
              className="mt-3 rounded-lg bg-paper px-4 py-2 text-sm font-medium text-ink"
              onClick={(e) => {
                stop(e);
                onBarge(toast.schemeId!);
              }}
            >
              {toast.action}
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="pointer-events-none absolute bottom-6 right-6 hidden max-w-[12rem] flex-col gap-1 text-[11px] text-paper/55 sm:flex">
        {OBJECTIVES.map((o) => (
          <li key={o.id} className={done[o.id] ? "text-paper/35 line-through" : ""}>
            {o.label}
          </li>
        ))}
        {politics ? <li className="mt-1 text-paper/45">{politics}</li> : null}
        {feed[0] ? <li className="mt-1 text-paper/70">{feed[0]}</li> : null}
      </ul>
    </div>
  );
}

export function DialogueOverlay() {
  const dialogue = useOverlay((s) => s.dialogue);
  if (!dialogue) return null;
  const npc = NPCS.find((n) => n.id === dialogue.npcId) ?? findSpeaker(dialogue.npcId);
  if (!npc) return null;
  const lines = [...npc.lines, ...livingLines(npc.id)];
  const line = lines[dialogue.index] ?? lines[0]!;
  const last = dialogue.index >= lines.length - 1;
  return (
    <div data-testid="dialogue" data-hud-ui className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:p-8">
      <div className="w-full max-w-xl rounded-xl border border-ink/10 bg-paper p-5 text-ink shadow-sm sm:p-7">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">{npc.title}</p>
        <h2 className="mt-1 font-display text-3xl leading-none">{npc.name}</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/85">{line}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-hud-ui
            className="rounded-lg px-4 py-2.5 text-sm text-muted"
            onClick={(e) => {
              e.stopPropagation();
              useOverlay.getState().set({ phase: "play", dialogue: null });
            }}
          >
            Close
          </button>
          <button
            type="button"
            data-hud-ui
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-paper"
            onClick={(e) => {
              e.stopPropagation();
              if (last) useOverlay.getState().set({ phase: "play", dialogue: null });
              else useOverlay.getState().set({ dialogue: { npcId: npc.id, index: dialogue.index + 1 } });
            }}
          >
            {last ? "Walk on" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PauseOverlay({ onResume }: { onResume: () => void }) {
  const done = useOverlay((s) => s.done);
  const shake = useOverlay((s) => s.shake);
  const quality = useOverlay((s) => s.quality);
  const complete = OBJECTIVES.every((o) => done[o.id]);
  return (
    <div data-hud-ui className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-ink/55 p-4">
      <div className="w-full max-w-md rounded-xl border border-paper/10 bg-surface-dark p-6 text-paper">
        <p className="text-xs uppercase tracking-[0.22em] text-paper/50">{complete ? "The Court remembers you" : "Paused"}</p>
        <h2 className="mt-1 font-display text-4xl">{complete ? "Hour one, kept" : "Still yourself"}</h2>
        <p className="mt-3 text-sm leading-relaxed text-paper/70">
          {complete
            ? "You spoke, walked the Ring, overheard a plot, trained without dice, and crossed a door."
            : "WASD walk. Click the world to look. Shift sprint. Space jump. Ctrl crouch. X dodge. F parry. C lock-on."}
        </p>
        <div className="mt-4 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto text-[11px] text-paper/70">
          {WORLD_ORDER.map((id) => {
            const k = worldKit(id);
            return (
              <p key={id}>
                <span className="text-paper/90">{k.title}</span>
                <span className="text-paper/45"> — {k.style.name}</span>
              </p>
            );
          })}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-paper/80">
          <input
            type="checkbox"
            checked={shake}
            onChange={(e) => useOverlay.getState().set({ shake: e.target.checked })}
          />
          Camera hit-feel
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-paper/80">
          Quality
          <select
            className="rounded-md border border-paper/20 bg-ink px-2 py-1 text-paper"
            value={quality}
            onChange={(e) => useOverlay.getState().set({ quality: e.target.value as "low" | "medium" | "high" | "ultra" })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="ultra">Ultra</option>
          </select>
        </label>
        <button
          type="button"
          data-hud-ui
          className="mt-5 w-full rounded-lg bg-paper py-3 text-sm font-medium text-ink"
          onClick={(e) => {
            e.stopPropagation();
            onResume();
          }}
        >
          Return
        </button>
      </div>
    </div>
  );
}

export function TouchPad({
  onJoy,
  onLook,
  onAttack,
  onDodge,
  onInteract,
  onSpecial,
  onPower,
}: {
  onJoy: (x: number, y: number) => void;
  onLook: (x: number, y: number) => void;
  onAttack: () => void;
  onDodge: () => void;
  onInteract: () => void;
  onSpecial?: () => void;
  onPower?: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 sm:hidden">
      <div
        data-hud-ui
        className="pointer-events-auto absolute bottom-6 left-4 size-32 rounded-full border border-paper/15 bg-hud/40"
        onPointerDown={(e) => {
          const el = e.currentTarget;
          const move = (ev: PointerEvent) => {
            const r = el.getBoundingClientRect();
            const x = ((ev.clientX - r.left) / r.width) * 2 - 1;
            const y = -(((ev.clientY - r.top) / r.height) * 2 - 1);
            onJoy(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
          };
          const up = () => {
            onJoy(0, 0);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          move(e.nativeEvent);
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <div
        data-hud-ui
        className="pointer-events-auto absolute bottom-24 right-4 h-24 w-28"
        onPointerDown={(e) => {
          const x0 = e.clientX;
          const y0 = e.clientY;
          const move = (ev: PointerEvent) => onLook(ev.clientX - x0, ev.clientY - y0);
          const up = () => {
            onLook(0, 0);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <div data-hud-ui className="pointer-events-auto absolute bottom-6 right-4 flex gap-2">
        <button type="button" className="size-12 rounded-full bg-paper/90 text-xs font-medium text-ink" onPointerDown={onInteract}>
          E
        </button>
        <button type="button" className="size-12 rounded-full bg-paper/80 text-xs font-medium text-ink" onPointerDown={onSpecial}>
          G
        </button>
        <button type="button" className="size-12 rounded-full bg-paper/80 text-xs font-medium text-ink" onPointerDown={onPower}>
          1
        </button>
        <button type="button" className="size-12 rounded-full bg-paper/80 text-xs font-medium text-ink" onPointerDown={onDodge}>
          Dodge
        </button>
        <button type="button" className="size-14 rounded-full bg-olive text-xs font-medium text-olive-fg" onPointerDown={onAttack}>
          Strike
        </button>
      </div>
    </div>
  );
}

export { SCHEMES };
