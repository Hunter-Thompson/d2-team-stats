import { useState } from "react";
import type { LineupStat } from "../../../shared/types.ts";
import { confidentRate } from "../format.ts";
import { Card, PlayerChip, Segmented, WinRate } from "./ui.tsx";

const LIMIT = 10;

export function Lineups({ lineups }: { lineups: LineupStat[] }) {
  const [order, setOrder] = useState<"best" | "worst" | "played">("best");
  const score = (l: LineupStat) => confidentRate(l.wins, l.games);
  const lossScore = (l: LineupStat) => confidentRate(l.games - l.wins, l.games);
  const sorted = [...lineups].sort((a, b) =>
    order === "best" ? score(b) - score(a) : order === "worst" ? lossScore(b) - lossScore(a) : b.games - a.games,
  );

  return (
    <Card
      title="Lineups"
      subtitle="The exact group of team members in the game · best and worst account for sample size"
      actions={
        <Segmented
          label="Sort lineups"
          value={order}
          onChange={setOrder}
          options={[
            { value: "best", label: "Best" },
            { value: "worst", label: "Worst" },
            { value: "played", label: "Most played" },
          ]}
        />
      }
    >
      {sorted.length === 0 ? (
        <div className="empty-inline">No lineups with two or more of you yet.</div>
      ) : (
        <div className="rank-list">
          {sorted.slice(0, LIMIT).map((l) => (
            <div className="rank-row lineup-row" key={l.players.join("-")}>
              <div className="lineup-players">
                {l.players.map((p) => (
                  <PlayerChip key={p} accountId={p} />
                ))}
              </div>
              <span className="count tabular">{l.games} games</span>
              <WinRate r={l} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
