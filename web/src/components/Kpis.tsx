import type { Dashboard } from "../../../shared/types.ts";
import { duration, pct, record, shortDate, winRate } from "../format.ts";
import { TipBody, useTip } from "./ui.tsx";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export function Kpis({ data }: { data: Dashboard }) {
  const tip = useTip();
  const { summary, heroes } = data;
  const formWins = summary.form.filter(Boolean).length;
  const streak = summary.streak;

  return (
    <div className="kpis">
      <div className="card kpi hero-kpi">
        <span className="kpi-label">Win rate</span>
        <div className="hero-kpi-row">
          <div>
            <span className="kpi-value">{summary.games ? pct(winRate(summary)) : "–"}</span>
            <div className="kpi-sub">
              {record(summary)} record
              {streak && streak.count > 1 ? ` · ${streak.won ? "won" : "lost"} last ${streak.count}` : ""}
            </div>
          </div>
          {summary.form.length > 0 && (
            <div>
              <div className="kpi-sub" style={{ textAlign: "right" }}>
                Last {summary.form.length}: {formWins}W {summary.form.length - formWins}L
              </div>
              <div className="form-strip" role="img" aria-label={`Last ${summary.form.length} games, newest last`}>
                {[...summary.form].reverse().map((won, i) => (
                  <span
                    key={i}
                    className={`form-tick ${won ? "win" : "loss"}`}
                    {...tip(() => (
                      <TipBody value={won ? "Win" : "Loss"} title={`${summary.form.length - i} games ago`} />
                    ))}
                    tabIndex={-1}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <Tile
        label="Games"
        value={summary.games.toLocaleString()}
        sub={summary.firstMatch ? `since ${shortDate(summary.firstMatch)}` : undefined}
      />
      <Tile
        label="Heroes played"
        value={String(heroes.length)}
        sub={data.filters.min > 1 ? `with ${data.filters.min}+ games` : "distinct heroes"}
      />
      <Tile
        label="Radiant · Dire"
        value={`${summary.radiant.games ? pct(winRate(summary.radiant)) : "–"} · ${summary.dire.games ? pct(winRate(summary.dire)) : "–"}`}
        sub={`${summary.radiant.games} · ${summary.dire.games} games`}
      />
      <Tile
        label="Avg. game length"
        value={summary.avgDuration ? duration(summary.avgDuration) : "–"}
        sub="minutes"
      />
    </div>
  );
}
