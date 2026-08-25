import { GATES, NPCS, OBJECTIVES, RING_RADIUS, SCHEMES, THEMES, WALL_RADIUS } from "@/game/content";
import { settlementsOf } from "@/game/realms";
import { isMuted, setMuted, sfxUi } from "@/game/audio";
import { useOverlay } from "@/game/store";
import { MAX_HP, MAX_POISE, MAX_STAMINA } from "@/game/combat";
import { Pause, Volume2, VolumeX } from "lucide-react";
import { findSpeaker, WORLD_ORDER, worldKit } from "@/game/worlds";
import { hourLabel } from "@/game/kernel";
import { livingLines } from "@/game/cross";

function Bar({
  value,
  max,
  tone,
  label,
}: {
  value: number;
  max: number;
  tone: string;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs tracking-wide text-paper/70">
        <span>{label}</span>
        <span className="font-mono tabular-nums">
          {Math.round(value)}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-paper/15">
        <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}

function Minimap() {
  const heading = useOverlay((s) => s.heading);
  const px = useOverlay((s) => s.px);
  const pz = useOverlay((s) => s.pz);
  const worldId = useOverlay((s) => s.worldId);
  const size = 118;
  const cx = size / 2;
  const viewR = worldId === "concordia-hub" ? WALL_RADIUS : 240;
  const sc = (size * 0.4) / viewR;
  const sx = (x: number) => cx + (x - (worldId === "concordia-hub" ? 0 : px * 0.15)) * sc;
  const sz = (z: number) => cx + (z - (worldId === "concordia-hub" ? 0 : pz * 0.15)) * sc;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const towns = settlementsOf(worldId);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-xl border border-paper/10 bg-hud/70">
      {worldId === "concordia-hub" ? (
        <>
          <circle cx={cx} cy={cx} r={RING_RADIUS * sc} fill="none" stroke="rgba(244,236,218,0.22)" strokeWidth="1" />
          <circle cx={cx} cy={cx} r={11 * sc} fill="rgba(216,201,164,0.18)" />
          {GATES.map((g) => (
            <circle
              key={g.id}
              cx={sx(Math.cos(g.angle) * RING_RADIUS)}
              cy={sz(Math.sin(g.angle) * RING_RADIUS)}
              r={worldId === g.worldId ? 3.4 : 2.2}
              fill={g.color}
              opacity={worldId === g.worldId ? 1 : 0.85}
            />
          ))}
        </>
      ) : (
        <>
          <circle cx={cx} cy={cx} r={40} fill="none" stroke="rgba(244,236,218,0.18)" strokeWidth="1" />
          {towns.map((t) => (
            <circle key={t.id} cx={sx(t.x)} cy={sz(t.z)} r="3" fill="#e8c070" />
          ))}
        </>
      )}
      <circle cx={sx(px)} cy={sz(pz)} r="3.2" fill="#f4ecda" />
      <line
        x1={sx(px)}
        y1={sz(pz)}
        x2={sx(px) + fx * 10}
        y2={sz(pz) + fz * 10}
        stroke="#f4ecda"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TitleOverlay({ onPlay, loading }: { onPlay: () => void; loading?: boolean }) {
  return (
    <div
      data-testid="title-overlay"
      className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-end bg-gradient-to-t from-ink/85 via-ink/25 to-transparent p-6 sm:p-10"
    >
      <div className="pointer-events-auto max-w-xl">
        <p className="text-xs font-medium uppercase tracking-[0.28em] text-olive-fg/80">The Ninth Refusal</p>
        <h1 className="mt-2 font-display text-5xl leading-[0.95] text-paper sm:text-7xl">Concordia</h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-paper/80 sm:text-base">
          Nine realities, three kilometres across. Kingdoms on the roads, packs that hunt in weather, births that mix bloodlines. Walk the Unburned Court, cross a door, fight with mass and momentum — never dice. Leave. Come back. The world will have moved.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="walk-in"
            onClick={onPlay}
            disabled={loading}
            className="rounded-xl bg-paper px-6 py-3 text-sm font-medium text-ink transition-transform duration-150 hover:scale-[0.99] active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? "Lighting the lanterns" : "Walk in"}
          </button>
          <p className="text-xs text-paper/60">WASD · RMB look · E talk / gate · G world-art · 1 weather-art · Space dodge · F parry</p>
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
  const theme = THEMES[worldId];

  return (
    <div data-testid="play-hud" className="pointer-events-none absolute inset-0 z-20 text-paper">
      <div className="pointer-events-auto absolute left-4 top-4 flex max-w-[min(100%-2rem,20rem)] flex-col gap-3 sm:left-6 sm:top-6">
        <div className="rounded-xl border border-paper/10 bg-hud/75 p-4 backdrop-blur-sm">
          <p data-testid="world-title" className="font-display text-lg leading-none text-paper">{worldTitle || (theme.id === "concordia-hub" ? "The Hub" : theme.id)}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-paper/50">
            {GATES.find((g) => g.worldId === worldId)?.refusal ?? "Concordant Law"}
          </p>
          <p className="mt-1 text-[11px] text-paper/55">
            {hourLabel(hour)} · {weather} · {styleName}
            {beastName ? ` · ${beastName}` : ""}
          </p>
          {km ? <p className="mt-1 text-[11px] text-paper/45">{km}{poi ? ` · ${poi}` : ""}</p> : null}
          {politics ? <p className="mt-1 text-[11px] leading-snug text-paper/50">{politics}</p> : null}
          {plotLine ? <p className="mt-1 text-[11px] leading-snug text-olive-fg/80">{plotLine}</p> : null}
          <div className="mt-3 flex flex-col gap-2">
            <Bar value={hp} max={MAX_HP} tone="#c45a52" label="Vital" />
            <Bar value={stamina} max={MAX_STAMINA} tone="#d8c48a" label="Gas" />
            {inCombat ? <Bar value={poise} max={MAX_POISE} tone="#7aa3c7" label="Poise" /> : null}
            {uncounted > 0 ? <Bar value={uncounted} max={80} tone="#30e8ff" label="Uncounted" /> : null}
            {hostility > 2 ? <Bar value={hostility} max={14} tone="#60ffc0" label="Hostility" /> : null}
            {worldId !== "concordia-hub" ? <Bar value={ecology * 100} max={100} tone="#7aab62" label="Ecology" /> : null}
          </div>
        </div>
        <div className="rounded-lg border border-paper/10 bg-hud/60 px-3 py-2.5 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-[0.18em] text-paper/45">{questTitle ? "Living hour" : "Hour one"}</p>
          {questTitle ? (
            <div className="mt-2">
              <p className="text-xs font-medium text-paper/90">{questTitle}</p>
              <p className="mt-1 text-[11px] leading-snug text-paper/65">{questDetail}</p>
            </div>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {OBJECTIVES.map((o) => (
                <li key={o.id} className="flex items-start gap-2 text-xs leading-snug">
                  <span
                    className={`mt-0.5 inline-block size-2 shrink-0 rounded-full ${done[o.id] ? "bg-olive" : "bg-paper/25"}`}
                  />
                  <span className={done[o.id] ? "text-paper/45 line-through" : "text-paper/85"}>{o.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="pointer-events-auto absolute right-4 top-4 flex flex-col items-end gap-2 sm:right-6 sm:top-6">
        <div className="flex gap-2">
          <button
            type="button"
            aria-label={muted ? "Unmute" : "Mute"}
            className="grid size-11 place-items-center rounded-lg border border-paper/10 bg-hud/70"
            onClick={() => {
              const next = !isMuted();
              setMuted(next);
              useOverlay.getState().set({ muted: next });
              sfxUi();
            }}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <button
            type="button"
            aria-label="Pause"
            className="grid size-11 place-items-center rounded-lg border border-paper/10 bg-hud/70"
            onClick={onPause}
          >
            <Pause className="size-4" />
          </button>
        </div>
        <div className="hidden sm:block">
          <Minimap />
        </div>
        <div className="hidden max-w-[16rem] rounded-lg border border-paper/10 bg-hud/55 p-3 text-xs leading-relaxed text-paper/70 sm:block">
          <p className="mb-1 uppercase tracking-[0.16em] text-paper/40">Live court</p>
          {feed.slice(0, 3).map((f, i) => (
            <p key={i} className={i === 0 ? "text-paper/85" : "mt-1 text-paper/50"}>
              {f}
            </p>
          ))}
        </div>
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
          <div
            key={a.key}
            className="min-w-[4.4rem] rounded-lg border border-paper/12 bg-hud/75 px-2.5 py-1.5 text-center backdrop-blur-sm"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper/45">{a.key}</p>
            <p className="text-[11px] text-paper/85">{a.name}</p>
          </div>
        ))}
      </div>

      {toast ? (
        <div className="pointer-events-auto absolute bottom-40 left-1/2 w-[min(92vw,26rem)] -translate-x-1/2 rounded-xl border border-paper/15 bg-hud/90 p-4 backdrop-blur-sm">
          <p className="text-sm leading-relaxed text-paper/90">{toast.text}</p>
          {toast.schemeId && toast.action ? (
            <button
              type="button"
              className="mt-3 rounded-lg bg-paper px-4 py-2 text-sm font-medium text-ink"
              onClick={() => onBarge(toast.schemeId!)}
            >
              {toast.action}
            </button>
          ) : null}
        </div>
      ) : null}
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
    <div data-testid="dialogue" className="absolute inset-0 z-30 flex items-end justify-center bg-ink/40 p-4 sm:p-8">
      <div className="w-full max-w-xl rounded-xl border border-ink/10 bg-paper p-5 text-ink shadow-sm sm:p-7">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">{npc.title}</p>
        <h2 className="mt-1 font-display text-3xl leading-none">{npc.name}</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/85">{line}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-4 py-2.5 text-sm text-muted"
            onClick={() => useOverlay.getState().set({ phase: "play", dialogue: null })}
          >
            Close
          </button>
          <button
            type="button"
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-paper"
            onClick={() => {
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
  const complete = OBJECTIVES.every((o) => done[o.id]);
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink/55 p-4">
      <div className="w-full max-w-md rounded-xl border border-paper/10 bg-surface-dark p-6 text-paper">
        <p className="text-xs uppercase tracking-[0.22em] text-paper/50">{complete ? "The Court remembers you" : "Paused"}</p>
        <h2 className="mt-1 font-display text-4xl">{complete ? "Hour one, kept" : "Still yourself"}</h2>
        <p className="mt-3 text-sm leading-relaxed text-paper/70">
          {complete
            ? "You spoke, walked the Ring, overheard a plot, trained without dice, and crossed a door. The rest of Concordia is still running."
            : "WASD walk. RMB look. E talk or cross. G is each world's art. 1 is weather-art. Space dodge. F parry. Eight doors, eight combat laws, creatures that remember."}
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
        <button type="button" className="mt-5 w-full rounded-lg bg-paper py-3 text-sm font-medium text-ink" onClick={onResume}>
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
    <div className="pointer-events-none absolute inset-0 z-20 sm:hidden">
      <div
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
      <div className="pointer-events-auto absolute bottom-6 right-4 flex gap-2">
        <button type="button" className="size-12 rounded-full bg-paper/90 text-xs font-medium text-ink" onClick={onInteract}>
          E
        </button>
        <button type="button" className="size-12 rounded-full bg-paper/80 text-xs font-medium text-ink" onClick={onSpecial}>
          G
        </button>
        <button type="button" className="size-12 rounded-full bg-paper/80 text-xs font-medium text-ink" onClick={onPower}>
          1
        </button>
        <button type="button" className="size-12 rounded-full bg-paper/80 text-xs font-medium text-ink" onClick={onDodge}>
          Dodge
        </button>
        <button type="button" className="size-14 rounded-full bg-olive text-xs font-medium text-olive-fg" onClick={onAttack}>
          Strike
        </button>
      </div>
    </div>
  );
}

export { SCHEMES };
