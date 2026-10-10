import { POSITION_LABELS, type Abandons, type Filters, type Member, type Mode, type Queue } from "../../../shared/types.ts";
import { Segmented } from "./ui.tsx";

export function defaultFilters(memberCount: number, team: number): Filters {
  return {
    team,
    days: 0,
    queue: "all",
    mode: "all",
    stack: memberCount >= 2 ? 2 : 1,
    player: null,
    position: null,
    abandons: "exclude",
    min: 1,
  };
}

export function FilterBar({
  filters,
  members,
  onChange,
}: {
  filters: Filters;
  members: Member[];
  onChange: (f: Filters) => void;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const defaults = defaultFilters(members.length, filters.team);
  const isDefault = (Object.keys(defaults) as (keyof Filters)[]).every((k) => defaults[k] === filters[k]);

  return (
    <div className="filters">
      <div className="filter">
        <span className="filter-label">Time</span>
        <Segmented
          label="Time range"
          value={filters.days}
          onChange={(v) => set("days", v)}
          options={[
            { value: 0, label: "All" },
            { value: 365, label: "1y" },
            { value: 90, label: "90d" },
            { value: 30, label: "30d" },
          ]}
        />
      </div>
      <div className="filter">
        <span className="filter-label">Queue</span>
        <Segmented<Queue>
          label="Queue"
          value={filters.queue}
          onChange={(v) => set("queue", v)}
          options={[
            { value: "all", label: "All" },
            { value: "ranked", label: "Ranked" },
            { value: "unranked", label: "Unranked" },
          ]}
        />
      </div>
      <div className="filter">
        <span className="filter-label">Mode</span>
        <Segmented<Mode>
          label="Game mode"
          value={filters.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "all", label: "All" },
            { value: "normal", label: "No Turbo" },
            { value: "turbo", label: "Turbo" },
          ]}
        />
      </div>
      <div className="filter">
        <span className="filter-label">Party</span>
        <Segmented
          label="Minimum teammates in the game"
          value={filters.stack}
          onChange={(v) => set("stack", v)}
          options={[
            { value: 1, label: "All games" },
            { value: 2, label: "2+" },
            { value: 3, label: "3+" },
            { value: 4, label: "4+" },
            { value: 5, label: "5" },
          ]}
        />
      </div>
      <div className="filter">
        <label className="filter-label" htmlFor="filter-player">
          Player
        </label>
        <select
          id="filter-player"
          className="select"
          value={filters.player ?? ""}
          onChange={(e) => set("player", e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Whole team</option>
          {members.map((m) => (
            <option key={m.accountId} value={m.accountId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="filter">
        <label className="filter-label" htmlFor="filter-role">
          Role
        </label>
        <select
          id="filter-role"
          className="select"
          value={filters.position ?? ""}
          onChange={(e) => set("position", e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Any role</option>
          {Object.entries(POSITION_LABELS).map(([position, label]) => (
            <option key={position} value={position}>
              {position} · {label}
            </option>
          ))}
        </select>
      </div>
      <div className="filter">
        <span className="filter-label">Abandons</span>
        <Segmented<Abandons>
          label="Games where someone abandoned"
          value={filters.abandons}
          onChange={(v) => set("abandons", v)}
          options={[
            { value: "exclude", label: "Exclude" },
            { value: "include", label: "Include" },
          ]}
        />
      </div>
      <div className="filter">
        <label className="filter-label" htmlFor="filter-min">
          Min. games
        </label>
        <select id="filter-min" className="select" value={filters.min} onChange={(e) => set("min", Number(e.target.value))}>
          {[1, 2, 3, 5, 10, 20].map((n) => (
            <option key={n} value={n}>
              {n}+
            </option>
          ))}
        </select>
      </div>
      {!isDefault && (
        <button type="button" className="btn ghost small" onClick={() => onChange(defaults)}>
          Reset
        </button>
      )}
    </div>
  );
}
