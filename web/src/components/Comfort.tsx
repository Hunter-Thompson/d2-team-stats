import type { ComfortStat } from "../../../shared/types.ts";
import { winRate } from "../format.ts";
import { Card, HeroImg, PlayerChip, WinRate } from "./ui.tsx";

export function Comfort({ comfort }: { comfort: ComfortStat[] }) {
  const rows = [...comfort].sort((a, b) => b.comfort.games + b.other.games - (a.comfort.games + a.other.games));

  return (
    <Card title="Comfort picks" subtitle="Win rate on each player's 5 most played heroes vs everything else they play">
      {rows.length === 0 ? (
        <div className="empty-inline">Not enough heroes per player yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Player</th>
                <th>Top 5 heroes</th>
                <th className="num">Top 5</th>
                <th className="num">Others</th>
                <th className="num">Gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const gap = Math.round((winRate(c.comfort) - winRate(c.other)) * 100);
                return (
                  <tr key={c.accountId}>
                    <td>
                      <PlayerChip accountId={c.accountId} />
                    </td>
                    <td>
                      <div className="hero-pair">
                        {c.heroes.map((h) => (
                          <HeroImg key={h} id={h} size="icon" />
                        ))}
                      </div>
                    </td>
                    <td className="num">
                      <WinRate r={c.comfort} />
                      <div className="muted tabular small">{c.comfort.games} games</div>
                    </td>
                    <td className="num">
                      <WinRate r={c.other} />
                      <div className="muted tabular small">{c.other.games} games</div>
                    </td>
                    <td className="num secondary">
                      {gap > 0 ? "+" : ""}
                      {gap} pts
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
