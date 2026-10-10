import { useMemo, useState } from "react";
import { POSITION_LABELS, type HeroStat } from "../../../shared/types.ts";
import { kda, pct, record, winRate } from "../format.ts";
import { Card, GamesBar, HeroImg, PlayerChip, WinRate, heroName, useLookup } from "./ui.tsx";

type SortKey = "hero" | "games" | "winrate" | "kda" | "gpm";
const PAGE = 20;
const SMALL_SAMPLE = 3;

const kdaRatio = (h: HeroStat) => (h.kills + h.assists) / Math.max(h.deaths, 1);

function usualRole(h: HeroStat) {
  const total = h.positions.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const top = h.positions.indexOf(Math.max(...h.positions));
  return { label: POSITION_LABELS[top + 1], share: h.positions[top] / total };
}

export function HeroPool({ heroes, focusedPlayer }: { heroes: HeroStat[]; focusedPlayer: string | null }) {
  const lookup = useLookup();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "games", desc: true });
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const value = (h: HeroStat): number | string => {
      switch (sort.key) {
        case "hero":
          return heroName(lookup.heroes, h.heroId);
        case "games":
          return h.games;
        case "winrate":
          return winRate(h) + h.games / 1e6; // ties go to the hero with more games
        case "kda":
          return kdaRatio(h);
        case "gpm":
          return h.gpm;
      }
    };
    return [...heroes].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return sort.desc ? -cmp : cmp;
    });
  }, [heroes, sort, lookup.heroes]);

  const maxGames = Math.max(1, ...heroes.map((h) => h.games));
  const visible = showAll ? rows : rows.slice(0, PAGE);

  const header = (key: SortKey, label: string, numeric = true) => (
    <th
      className={numeric ? "num" : undefined}
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}
    >
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "hero" }))}
      >
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <Card
      title={focusedPlayer ? `${focusedPlayer}'s heroes` : "Hero pool"}
      subtitle={`${heroes.length} heroes · win rate bar is centred on 50% · grey values have fewer than ${SMALL_SAMPLE} games`}
    >
      {heroes.length === 0 ? (
        <div className="empty-inline">No heroes match these filters.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {header("hero", "Hero", false)}
                  {header("games", "Games")}
                  {header("winrate", "Win rate")}
                  <th className="num">Record</th>
                  <th>Usual role</th>
                  <th>Played by</th>
                  {header("kda", "K / D / A")}
                  {header("gpm", "GPM")}
                </tr>
              </thead>
              <tbody>
                {visible.map((h) => (
                  <tr key={h.heroId}>
                    <td>
                      <div className="hero-cell">
                        <HeroImg id={h.heroId} size="lg" />
                        {heroName(lookup.heroes, h.heroId)}
                      </div>
                    </td>
                    <td className="num">
                      <GamesBar games={h.games} max={maxGames} />
                    </td>
                    <td className="num">
                      <WinRate r={h} muted={h.games < SMALL_SAMPLE} />
                    </td>
                    <td className="num secondary">{record(h)}</td>
                    <td className="secondary">
                      {(() => {
                        const role = usualRole(h);
                        return role ? (
                          <>
                            {role.label} <span className="muted">{pct(role.share)}</span>
                          </>
                        ) : (
                          "–"
                        );
                      })()}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 12 }}>
                        {h.players.slice(0, 2).map((p) => (
                          <PlayerChip key={p.accountId} accountId={p.accountId}>
                            <span className="muted tabular">{p.games}</span>
                          </PlayerChip>
                        ))}
                        {h.players.length > 2 && <span className="muted">+{h.players.length - 2}</span>}
                      </div>
                    </td>
                    <td className="num secondary">{kda(h.kills, h.deaths, h.assists)}</td>
                    <td className="num secondary">{Math.round(h.gpm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PAGE && (
            <div className="table-foot">
              <button type="button" className="btn small" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${rows.length} heroes`}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
