import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { Hero, Member, WinLoss } from "../../../shared/types.ts";
import { pct, record, winRate } from "../format.ts";

// ---------- Lookup context (members & heroes) ----------

interface Lookup {
  members: Map<number, Member>;
  heroes: Record<number, Hero>;
}

const LookupContext = createContext<Lookup>({ members: new Map(), heroes: {} });
export const LookupProvider = LookupContext.Provider;
export const useLookup = () => useContext(LookupContext);

export function heroName(heroes: Record<number, Hero>, id: number) {
  return heroes[id]?.localizedName ?? `Hero ${id}`;
}

// Heat-cell fill on the diverging win-rate scale. Full strength at 25 points from 50%; cells
// with fewer than `lowSample` games stay neutral so one lucky game doesn't look like a trend.
export const HEAT_FULL_AT = 0.25;
export function heatStyle(r: WinLoss, lowSample = 3): CSSProperties {
  if (r.games < lowSample) return { background: "var(--mid)", color: "var(--muted)" };
  const delta = winRate(r) - 0.5;
  const strength = Math.min(1, Math.abs(delta) / HEAT_FULL_AT);
  const pole = delta >= 0 ? "var(--pos)" : "var(--neg)";
  return {
    background: `color-mix(in oklab, ${pole} ${Math.round(strength * 100)}%, var(--mid))`,
    color: strength > 0.6 ? "#ffffff" : "var(--ink)",
  };
}

export const playerStyle = (slot: number) => ({ "--player": `var(--p${slot})` }) as CSSProperties;

// ---------- Tooltip ----------

type ShowTip = (content: ReactNode | null, x?: number, y?: number) => void;
const TipContext = createContext<ShowTip>(() => {});

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ content: ReactNode; x: number; y: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const show = useCallback<ShowTip>((content, x = 0, y = 0) => {
    setTip(content === null ? null : { content, x, y });
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null);
    const { width, height } = ref.current.getBoundingClientRect();
    const gap = 14;
    let left = tip.x + gap;
    let top = tip.y + gap;
    if (left + width > window.innerWidth - 8) left = tip.x - width - gap;
    if (top + height > window.innerHeight - 8) top = tip.y - height - gap;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [tip]);

  return (
    <TipContext.Provider value={show}>
      {children}
      {tip && (
        <div
          ref={ref}
          className="tooltip"
          role="tooltip"
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
        >
          {tip.content}
        </div>
      )}
    </TipContext.Provider>
  );
}

/** Shows a tooltip at a point, or hides it with null. For charts that track the pointer. */
export const useShowTip = () => useContext(TipContext);

/** Returns a function that builds hover + keyboard-focus props for a mark. */
export function useTip() {
  const show = useContext(TipContext);
  return (content: () => ReactNode) => ({
    tabIndex: 0,
    onPointerMove: (e: PointerEvent) => show(content(), e.clientX, e.clientY),
    onPointerLeave: () => show(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      show(content(), r.left + r.width / 2, r.bottom);
    },
    onBlur: () => show(null),
  });
}

export function TipBody({ title, value, rows }: { title: ReactNode; value: ReactNode; rows?: [string, ReactNode][] }) {
  return (
    <>
      <div className="tt-value">{value}</div>
      <div className="tt-title">{title}</div>
      {rows?.map(([label, v]) => (
        <div className="tt-row" key={label}>
          <span>{label}</span>
          <strong>{v}</strong>
        </div>
      ))}
    </>
  );
}

// ---------- Small building blocks ----------

const CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/";

export function HeroImg({ id, size = "md" }: { id: number; size?: "lg" | "md" | "icon" }) {
  const hero = useLookup().heroes[id];
  if (!hero) return <span className={`hero-img ${size}`} />;
  const src = size === "icon" ? `${CDN}icons/${hero.name}.png` : `${CDN}${hero.name}.png`;
  return <img className={`hero-img ${size}`} src={src} alt="" loading="lazy" />;
}

export function PlayerChip({ accountId, children }: { accountId: number; children?: ReactNode }) {
  const member = useLookup().members.get(accountId);
  return (
    <span className="chip" style={playerStyle(member?.colorSlot ?? 0)}>
      <span className="dot" aria-hidden="true" />
      <span className="name">{member?.name ?? accountId}</span>
      {children}
    </span>
  );
}

/** Win rate as text plus a diverging bar centred on 50%. */
export function WinRate({ r, bar = true, muted = false }: { r: WinLoss; bar?: boolean; muted?: boolean }) {
  const v = winRate(r);
  const delta = v - 0.5;
  return (
    <span className="wr">
      <span className={`wr-value tabular${muted ? " small-sample" : ""}`}>{pct(v)}</span>
      {bar && (
        <span className="wr-track" aria-hidden="true">
          <span className={`wr-bar ${delta >= 0 ? "pos" : "neg"}`} style={{ width: `${Math.abs(delta) * 100}%` }} />
        </span>
      )}
    </span>
  );
}

export function GamesBar({ games, max }: { games: number; max: number }) {
  return (
    <span className="games">
      <span className="games-track" aria-hidden="true">
        <span className="games-bar" style={{ width: `${(games / Math.max(max, 1)) * 100}%` }} />
      </span>
      <span className="tabular">{games}</span>
    </span>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function recordTip(r: WinLoss) {
  return `${r.games} games · ${record(r)}`;
}
