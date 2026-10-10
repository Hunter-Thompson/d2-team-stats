import type { FactorAverages, Member, PlayerFactors } from "../../../shared/types.ts";
import { oneDecimal } from "../format.ts";
import { Card, PlayerChip } from "./ui.tsx";

const METRICS: { key: keyof FactorAverages; label: string; format: (n: number) => string }[] = [
  { key: "deaths", label: "Deaths", format: oneDecimal },
  { key: "kills", label: "Kills", format: oneDecimal },
  { key: "assists", label: "Assists", format: oneDecimal },
  { key: "gpm", label: "GPM", format: (n) => String(Math.round(n)) },
  { key: "lastHits", label: "Last hits", format: (n) => String(Math.round(n)) },
  { key: "heroDamage", label: "Hero damage", format: (n) => `${oneDecimal(n / 1000)}k` },
];

// Averages over a handful of games swing wildly, so players need this many wins and losses.
const MIN_GAMES = 5;

const change = (win: number | null, loss: number | null) =>
  win === null || loss === null || Math.max(win, loss) === 0 ? 0 : Math.abs(loss - win) / Math.max(win, loss);

export function Factors({ factors, members }: { factors: PlayerFactors[]; members: Member[] }) {
  const order = new Map(members.map((m, i) => [m.accountId, i]));
  const rows = [...factors]
    .filter((f) => f.wins.games >= MIN_GAMES && f.losses.games >= MIN_GAMES)
    .sort((a, b) => b.wins.games + b.losses.games - (a.wins.games + a.losses.games) || order.get(a.accountId)! - order.get(b.accountId)!);

  return (
    <Card
      title="What changes when we lose"
      subtitle={`Each player's average in wins → losses · the biggest swing per player is highlighted · players with at least ${MIN_GAMES} wins and ${MIN_GAMES} losses · hero damage only exists for recent games`}
    >
      {rows.length === 0 ? (
        <div className="empty-inline">Needs at least {MIN_GAMES} wins and {MIN_GAMES} losses per player in this view.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Player</th>
                {METRICS.map((m) => (
                  <th key={m.key} className="num">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const biggest = METRICS.reduce((best, m) =>
                  change(f.wins[m.key], f.losses[m.key]) > change(f.wins[best.key], f.losses[best.key]) ? m : best,
                );
                return (
                  <tr key={f.accountId}>
                    <td>
                      <PlayerChip accountId={f.accountId}>
                        <span className="muted tabular">
                          {f.wins.games}W {f.losses.games}L
                        </span>
                      </PlayerChip>
                    </td>
                    {METRICS.map((m) => {
                      const w = f.wins[m.key];
                      const l = f.losses[m.key];
                      return (
                        <td key={m.key} className="num">
                          {w === null || l === null ? (
                            <span className="muted">–</span>
                          ) : (
                            <span className={m === biggest ? "swing" : "secondary"}>
                              {m.format(w)} → {m.format(l)}
                            </span>
                          )}
                        </td>
                      );
                    })}
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
