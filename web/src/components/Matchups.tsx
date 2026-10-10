import type { MatchupStat } from "../../../shared/types.ts";
import { confidentRate } from "../format.ts";
import { Card, HeroImg, WinRate, heroName, useLookup } from "./ui.tsx";

const LIMIT = 8;

function List({ rows }: { rows: MatchupStat[] }) {
  const { heroes } = useLookup();
  if (rows.length === 0) return <div className="empty-inline">Not enough games yet.</div>;
  return (
    <div className="rank-list">
      {rows.map((m) => (
        <div className="rank-row" key={m.heroId}>
          <HeroImg id={m.heroId} size="md" />
          <span className="label">{heroName(heroes, m.heroId)}</span>
          <span className="count tabular">{m.games}g</span>
          <WinRate r={m} />
        </div>
      ))}
    </div>
  );
}

export function Matchups({ matchups, min }: { matchups: MatchupStat[]; min: number }) {
  const threshold = Math.max(min, 3);
  const eligible = matchups.filter((m) => m.games >= threshold);
  // Rank by confidence so a 0–3 record doesn't outrank 10–25.
  const losses = (m: MatchupStat) => confidentRate(m.games - m.wins, m.games);
  const wins = (m: MatchupStat) => confidentRate(m.wins, m.games);
  const hardest = [...eligible].sort((a, b) => losses(b) - losses(a)).slice(0, LIMIT);
  const easiest = [...eligible].sort((a, b) => wins(b) - wins(a)).slice(0, LIMIT);

  return (
    <Card
      title="Enemy heroes"
      subtitle={`Our win rate when the enemy picks a hero · at least ${threshold} games · ranked by win rate and sample size`}
    >
      <div className="split">
        <div>
          <h3>Toughest opponents</h3>
          <List rows={hardest} />
        </div>
        <div>
          <h3>Best matchups</h3>
          <List rows={easiest} />
        </div>
      </div>
    </Card>
  );
}
