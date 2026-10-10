import { useState } from "react";
import type { ComboStat } from "../../../shared/types.ts";
import { confidentRate, winRate } from "../format.ts";
import { Card, HeroImg, Segmented, WinRate, heroName, useLookup } from "./ui.tsx";

const LIMIT = 10;

export function Combos({ combos, min }: { combos: ComboStat[]; min: number }) {
  const { heroes } = useLookup();
  const [order, setOrder] = useState<"best" | "played">("best");
  const sorted = [...combos].sort((a, b) =>
    order === "best"
      ? confidentRate(b.wins, b.games) - confidentRate(a.wins, a.games)
      : b.games - a.games || winRate(b) - winRate(a),
  );

  return (
    <Card
      title="Hero combos"
      subtitle={`Two of our heroes in the same game · at least ${Math.max(min, 2)} games together${
        order === "best" ? " · ranked by win rate and sample size" : ""
      }`}
      actions={
        <Segmented
          label="Sort combos"
          value={order}
          onChange={setOrder}
          options={[
            { value: "best", label: "Best" },
            { value: "played", label: "Most played" },
          ]}
        />
      }
    >
      {sorted.length === 0 ? (
        <div className="empty-inline">No hero pairs yet. Combos need two players from the team in the same game.</div>
      ) : (
        <div className="rank-list">
          {sorted.slice(0, LIMIT).map((c) => (
            <div className="rank-row" key={c.heroes.join("-")}>
              <div className="hero-pair">
                <HeroImg id={c.heroes[0]} size="md" />
                <HeroImg id={c.heroes[1]} size="md" />
              </div>
              <span className="label">
                {heroName(heroes, c.heroes[0])} + {heroName(heroes, c.heroes[1])}
              </span>
              <span className="count tabular">{c.games} games</span>
              <WinRate r={c} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
